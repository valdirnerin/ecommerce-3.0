const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../logger');

const ARG_TIMEZONE = 'America/Argentina/Buenos_Aires';

function normalizeDateParam(raw) {
  if (!raw && raw !== 0) return null;
  const value = String(raw).trim();
  if (!value) return null;
  const slashMatch = /^([0-9]{2})\/([0-9]{2})\/([0-9]{4})$/.exec(value);
  let candidate = value;
  if (slashMatch) {
    candidate = `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  }
  const isoMatch = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(candidate);
  if (!isoMatch) return null;
  const year = Number(isoMatch[1]);
  const month = Number(isoMatch[2]);
  const day = Number(isoMatch[3]);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime())) return null;
  return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
}

function todayInArgentinaIso() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ARG_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function getPaymentCategory(status) {
  const value = String(status || '').toLowerCase();
  if (!value) return 'pending';
  if (
    value === 'pagado' ||
    value === 'paid' ||
    value === 'approved' ||
    value === 'acreditado' ||
    value === 'accredited'
  ) {
    return 'paid';
  }
  if (
    value === 'rechazado' ||
    value === 'rejected' ||
    value === 'cancelado' ||
    value === 'canceled' ||
    value === 'cancelled' ||
    value === 'refunded'
  ) {
    return 'canceled';
  }
  return 'pending';
}

function normalizeOrderRow(row) {
  if (!row || typeof row !== 'object') return row;
  const firstName = row.first_name || row.customer_first_name || '';
  const lastName = row.last_name || row.customer_last_name || '';
  const name = [firstName, lastName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  const customer = {
    name: row.customer_name || (name ? name : null) || null,
    email: row.customer_email || row.user_email || null,
    phone: row.customer_phone || row.phone || null,
  };
  Object.keys(customer).forEach((key) => {
    if (customer[key] == null) {
      customer[key] = null;
      return;
    }
    const trimmed = String(customer[key]).trim();
    customer[key] = trimmed ? trimmed : null;
  });
  const shipping = {
    street: row.shipping_address || row.address || null,
    city: row.shipping_city || row.city || null,
    province: row.shipping_province || row.province || null,
    zip: row.shipping_zip || row.zip || null,
    method: row.shipping_method || row.shipping || null,
  };
  Object.keys(shipping).forEach((key) => {
    if (shipping[key] == null) {
      shipping[key] = null;
      return;
    }
    const trimmed = String(shipping[key]).trim();
    shipping[key] = trimmed ? trimmed : null;
  });
  const rawItems = Array.isArray(row.items) ? row.items : [];
  const fallbackItems = [];
  if (rawItems.length === 0 && (row.product_title || row.product_name)) {
    fallbackItems.push({
      title: row.product_title || row.product_name,
      name: row.product_title || row.product_name,
      quantity:
        row.quantity != null
          ? Number(row.quantity)
          : row.items_count != null
            ? Number(row.items_count)
            : 0,
      unit_price:
        row.unit_price != null
          ? Number(row.unit_price)
          : row.price != null
            ? Number(row.price)
            : null,
      price:
        row.unit_price != null
          ? Number(row.unit_price)
          : row.price != null
            ? Number(row.price)
            : null,
    });
  }
  const items = rawItems.length > 0 ? rawItems : fallbackItems;
  const itemsTotal = items.reduce((total, item) => {
    const qty = Number(item?.quantity ?? item?.qty ?? 0);
    const price = Number(item?.unit_price ?? item?.price ?? 0);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return total;
    return total + qty * price;
  }, 0);
  const shippingCost = Number(row.shipping_cost ?? row.shipping_total ?? 0) || 0;
  const grandTotal =
    Number(row.total_amount ?? row.total ?? row.grand_total ?? 0) ||
    itemsTotal + shippingCost;
  const computedItemsCount = items.reduce(
    (count, item) => count + Number(item?.quantity ?? item?.qty ?? 0),
    0,
  );
  const itemsSummary =
    row.items_summary ||
    (typeof row.items_count === 'number'
      ? `${row.items_count} ítems`
      : items
          .map((item) => {
            const label = item?.name || item?.title || 'item';
            const qty = item?.quantity ?? item?.qty ?? 0;
            return `${label} x${qty}`;
          })
          .join(', '));
  const normalized = {
    ...row,
    customer,
    shipping_address: shipping,
    items,
    items_summary: itemsSummary || null,
    totals: {
      ...(row.totals && typeof row.totals === 'object' ? row.totals : {}),
      items_total: itemsTotal,
      shipping: shippingCost,
      grand_total: grandTotal,
      total: grandTotal,
    },
  };
  if (normalized.items_count == null) {
    normalized.items_count = computedItemsCount || (items.length ? items.length : 0);
  }
  if (!Object.prototype.hasOwnProperty.call(normalized, 'deleted_at')) {
    normalized.deleted_at = null;
  }
  return normalized;
}

function computeSummary(orders, dateIso) {
  let paid = 0;
  let pending = 0;
  let canceled = 0;
  orders.forEach((order) => {
    const category = getPaymentCategory(order.payment_status || order.status);
    if (category === 'paid') paid += 1;
    else if (category === 'canceled') canceled += 1;
    else pending += 1;
  });
  return {
    date: dateIso,
    total: orders.length,
    paid,
    pending,
    canceled,
  };
}

function normalizeStatusFilter(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'all' || normalized === 'todos') return 'all';
  if (
    normalized === 'pagado' ||
    normalized === 'paid' ||
    normalized === 'approved' ||
    normalized === 'acreditado'
  ) {
    return 'paid';
  }
  if (
    normalized === 'rechazado' ||
    normalized === 'rejected' ||
    normalized === 'cancelado' ||
    normalized === 'canceled' ||
    normalized === 'cancelled'
  ) {
    return 'canceled';
  }
  if (normalized === 'pendiente' || normalized === 'pending') {
    return 'pending';
  }
  return normalized;
}

router.get('/', async (req, res) => {
  try {
    const { date: rawDate, status: rawStatus = 'all', q = '', includeDeleted } =
      req.query || {};
    const normalizedDate = normalizeDateParam(rawDate) || todayInArgentinaIso();
    const includeDeletedFlag =
      includeDeleted === '1' ||
      includeDeleted === 'true' ||
      includeDeleted === 'yes';
    const statusFilter = normalizeStatusFilter(rawStatus);
    const searchTerm = String(q || '').trim().toLowerCase();

    const { rows } = await db.query(
      `
        SELECT *,
               DATE(created_at AT TIME ZONE '${ARG_TIMEZONE}') AS order_date
          FROM orders
         WHERE DATE(created_at AT TIME ZONE '${ARG_TIMEZONE}') = $1
         ORDER BY created_at DESC
      `,
      [normalizedDate],
    );

    let orders = rows.map((row) => normalizeOrderRow(row));

    if (!includeDeletedFlag) {
      orders = orders.filter((order) => !order.deleted_at);
    }

    if (statusFilter && statusFilter !== 'all') {
      orders = orders.filter(
        (order) => getPaymentCategory(order.payment_status) === statusFilter,
      );
    }

    if (searchTerm) {
      orders = orders.filter((order) => {
        const haystack = [
          order.order_number,
          order.number,
          order.id,
          order.customer?.name,
          order.customer?.email,
          order.customer?.phone,
          order.phone,
          order.shipping_address?.street,
          order.shipping_address?.city,
        ]
          .map((value) => String(value || '').toLowerCase())
          .filter(Boolean);
        return haystack.some((value) => value.includes(searchTerm));
      });
    }

    const summary = computeSummary(orders, normalizedDate);
    res.json({
      summary,
      items: orders,
      orders,
      total: summary.total,
    });
  } catch (error) {
    logger.error(`Error al obtener pedidos: ${error.message}`);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/pending', async (_req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM orders WHERE payment_status = 'pendiente_transferencia' OR payment_status = 'pendiente_pago_local' ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (error) {
    logger.error(`Error al obtener pedidos pendientes: ${error.message}`);
    res.status(500).json({ error: 'Error interno' });
  }
});

async function findOrder(id) {
  if (id.startsWith('pref_')) {
    return (
      await db.query(
        'SELECT payment_status, order_number FROM orders WHERE preference_id = $1',
        [id]
      )
    ).rows;
  }
  if (id.startsWith('NRN-')) {
    return (
      await db.query(
        'SELECT payment_status, order_number FROM orders WHERE order_number = $1',
        [id]
      )
    ).rows;
  }
  let rows = (
    await db.query(
      'SELECT payment_status, order_number FROM orders WHERE preference_id = $1',
      [id]
    )
  ).rows;
  if (rows.length === 0) {
    rows = (
      await db.query(
        'SELECT payment_status, order_number FROM orders WHERE order_number = $1',
        [id]
      )
    ).rows;
  }
  return rows;
}

router.get('/test/:id/status', async (req, res) => {
  try {
    const rows = await findOrder(req.params.id);
    if (rows.length === 0) {
      return res.json({ status: 'pending', numeroOrden: null });
    }
    res.json({ status: rows[0].payment_status, numeroOrden: rows[0].order_number });
  } catch (error) {
    logger.error(`Error al obtener estado del pedido (test): ${error.message}`);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/:id/status', async (req, res) => {
  try {
    const rows = await findOrder(req.params.id);
    if (rows.length === 0) {
      return res.json({ status: 'pending', numeroOrden: null });
    }
    res.json({ status: rows[0].payment_status, numeroOrden: rows[0].order_number });
  } catch (error) {
    logger.error(`Error al obtener estado del pedido: ${error.message}`);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/:orderNumber/mark-paid', async (req, res) => {
  try {
    const { rows } = await db.query(
      'UPDATE orders SET payment_status = $1 WHERE order_number = $2 RETURNING user_email',
      ['pagado', req.params.orderNumber]
    );
    if (rows.length > 0) {
      const email = rows[0].user_email;
      if (email) {
        const sendEmail = require('../utils/sendEmail');
        await sendEmail(email, 'Pago confirmado', 'Tu pago fue confirmado y tu pedido está en preparación.');
      }
    }
    res.json({ success: true });
  } catch (error) {
    logger.error(`Error al actualizar pedido: ${error.message}`);
    res.status(500).json({ error: 'Error interno' });
  }
});

async function updateOrder(whereClause, values, updates) {
  if (!updates.sets.length) {
    throw new Error('NO_FIELDS');
  }
  const { rows } = await db.query(
    `UPDATE orders
        SET ${updates.sets.join(', ')}
      WHERE ${whereClause}
      RETURNING *`,
    [...updates.values, ...values],
  );
  return rows;
}

function buildUpdateSet(payload = {}) {
  const allowed = [
    'payment_status',
    'shipping_status',
    'tracking',
    'carrier',
    'shipping_note',
  ];
  const sets = [];
  const values = [];
  allowed.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      let value = payload[key];
      if (typeof value === 'string') {
        value = value.trim();
        if (value === '') value = null;
      }
      if (value === undefined) value = null;
      sets.push(`${key} = $${sets.length + 1}`);
      values.push(value);
    }
  });
  return { sets, values };
}

router.put('/:id', async (req, res) => {
  const identifier = String(req.params.id || '').trim();
  if (!identifier) {
    return res.status(400).json({ error: 'Identificador inválido' });
  }
  try {
    const updates = buildUpdateSet(req.body || {});
    if (!updates.sets.length) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    const attempts = [];
    const numericId = Number(identifier);
    if (Number.isInteger(numericId) && numericId > 0) {
      attempts.push({ clause: 'id = $' + (updates.values.length + 1), values: [numericId] });
    }
    attempts.push({ clause: 'order_number = $' + (updates.values.length + 1), values: [identifier] });
    attempts.push({ clause: 'preference_id = $' + (updates.values.length + 1), values: [identifier] });

    let updatedRows = [];
    for (const attempt of attempts) {
      // eslint-disable-next-line no-await-in-loop
      updatedRows = await updateOrder(attempt.clause, attempt.values, updates);
      if (updatedRows.length) break;
    }

    if (!updatedRows.length) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const normalized = normalizeOrderRow(updatedRows[0]);
    res.json({ success: true, order: normalized });
  } catch (error) {
    if (error.message === 'NO_FIELDS') {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }
    logger.error(`Error al actualizar pedido ${req.params.id}: ${error.message}`);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
