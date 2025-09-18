const fs = require('fs');
const path = require('path');
const db = require('../db');
const productsRepo = require('./productsRepo');
const { DATA_DIR: dataDir } = require('../utils/dataDir');

const filePath = path.join(dataDir, 'orders.json');

async function getAll() {
  const pool = db.getPool();
  if (!pool) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')).orders || [];
    } catch {
      return [];
    }
  }
  const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
  return rows;
}

async function getById(id) {
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    return orders.find((o) => String(o.id) === String(id)) || null;
  }
  const { rows } = await pool.query('SELECT * FROM orders WHERE id=$1', [id]);
  if (!rows[0]) return null;
  const order = rows[0];
  const items = await pool.query(
    'SELECT product_id, qty, price FROM order_items WHERE order_id=$1',
    [id]
  );
  order.items = items.rows;
  return order;
}

async function saveAll(orders) {
  const pool = db.getPool();
  if (!pool) {
    fs.writeFileSync(filePath, JSON.stringify({ orders }, null, 2), 'utf8');
    return;
  }
  await pool.query('BEGIN');
  try {
    for (const o of orders) {
      await pool.query(
        `INSERT INTO orders (id, created_at, customer_email, status, total)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           customer_email=EXCLUDED.customer_email,
           status=EXCLUDED.status,
           total=EXCLUDED.total`,
        [o.id, o.created_at || new Date(), o.customer_email || null, o.status || 'pendiente', o.total || 0]
      );
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

function validateOrder(order) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    throw new Error('ORDER_WITHOUT_ITEMS');
  }
}

async function create(order) {
  validateOrder(order);
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    orders.push(order);
    await saveAll(orders);
    return order;
  }
  await pool.query('BEGIN');
  try {
    await pool.query(
      'INSERT INTO orders (id, created_at, customer_email, status, total) VALUES ($1, now(), $2, $3, $4)',
      [order.id, order.customer_email || null, order.status || 'pendiente', order.total || 0]
    );
    for (const it of order.items || []) {
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, qty, price) VALUES ($1,$2,$3,$4)',
        [order.id, it.product_id, it.qty, it.price]
      );
    }
    await pool.query('COMMIT');
    return order;
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function update(order) {
  validateOrder(order);
  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    const idx = orders.findIndex((o) => String(o.id) === String(order.id));
    if (idx === -1) throw new Error('ORDER_NOT_FOUND');
    const items = Array.isArray(order.items)
      ? order.items.map((it) => ({ ...it }))
      : [];
    const next = { ...orders[idx], ...order, items };
    orders[idx] = next;
    await saveAll(orders);
    return next;
  }
  await pool.query('BEGIN');
  try {
    await pool.query(
      'UPDATE orders SET customer_email=$2, status=$3, total=$4 WHERE id=$1',
      [order.id, order.customer_email || null, order.status || 'pendiente', order.total || 0]
    );
    await pool.query('DELETE FROM order_items WHERE order_id=$1', [order.id]);
    for (const it of order.items) {
      const pid = it.product_id || it.id || it.productId;
      const qty = Number(it.qty || it.quantity || it.cantidad || 0);
      if (!pid || !qty) continue;
      const price = Number(it.price || it.unit_price || 0);
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, qty, price) VALUES ($1,$2,$3,$4)',
        [order.id, pid, qty, price]
      );
    }
    await pool.query('COMMIT');
    return order;
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

function normalizeKey(value) {
  if (value == null) return null;
  const str = String(value).trim();
  return str ? str : null;
}

function orderMatches(order, candidate) {
  if (!order || !candidate) return false;
  const values = [
    order.id,
    order.order_id,
    order.orderId,
    order.order_number,
    order.orderNumber,
    order.external_reference,
    order.externalReference,
    order.preference_id,
    order.preferenceId,
    order.payment_id,
    order.paymentId,
    order.metadata?.order_id,
  ];
  return values.some((val) => normalizeKey(val) === candidate);
}

async function findByKey(key, identifiers = {}) {
  const candidates = new Set();
  const keys = [
    key,
    identifiers.payment_id,
    identifiers.preference_id,
    identifiers.external_reference,
  ];
  for (const value of keys) {
    const normalized = normalizeKey(value);
    if (normalized) candidates.add(normalized);
  }
  if (!candidates.size) return null;

  const pool = db.getPool();
  if (!pool) {
    const orders = await getAll();
    for (const candidate of candidates) {
      const match = orders.find((o) => orderMatches(o, candidate));
      if (match) return match;
    }
    return null;
  }

  for (const candidate of candidates) {
    const found = await getById(candidate);
    if (found) return found;
  }
  return null;
}

function computeOrderTotal(order) {
  const total = Number(order?.total);
  if (!Number.isFinite(total) || total <= 0) {
    if (Array.isArray(order?.items)) {
      return order.items.reduce((acc, it) => {
        const price = Number(it.price || it.unit_price || 0);
        const qty = Number(it.qty || it.quantity || it.cantidad || 0);
        return acc + price * qty;
      }, 0);
    }
    return 0;
  }
  return total;
}

function getOrderCurrency(order) {
  if (!order) return null;
  const itemWithCurrency = Array.isArray(order.items)
    ? order.items.find((it) => it.currency || it.currency_id)
    : null;
  return (
    order.currency ||
    order.currency_id ||
    order.currencyId ||
    order.moneda ||
    order.paid_currency ||
    (itemWithCurrency ? itemWithCurrency.currency || itemWithCurrency.currency_id : null)
  );
}

async function upsertByPayment({
  payment_id,
  preference_id,
  external_reference,
  patch = {},
  amount,
  currency,
}) {
  const normalizedPaymentId = normalizeKey(payment_id);
  const normalizedPreferenceId = normalizeKey(preference_id);
  const normalizedExternalRef = normalizeKey(external_reference);
  const key = normalizedPaymentId || normalizedPreferenceId || normalizedExternalRef;
  if (!key) return null;

  const existing = await findByKey(key, {
    payment_id: normalizedPaymentId,
    preference_id: normalizedPreferenceId,
    external_reference: normalizedExternalRef,
  });
  if (!existing) return null;

  if (
    normalizedPaymentId &&
    existing.payment_id &&
    normalizeKey(existing.payment_id) === normalizedPaymentId
  ) {
    return existing;
  }

  if (typeof amount === 'number' && Number.isFinite(amount)) {
    const total = computeOrderTotal(existing);
    if (Number.isFinite(total) && Math.abs(total - amount) > 0.01) {
      const err = new Error('AMOUNT_MISMATCH');
      err.code = 'AMOUNT_MISMATCH';
      throw err;
    }
  }

  if (currency) {
    const orderCurrency = getOrderCurrency(existing);
    if (orderCurrency && String(orderCurrency) !== String(currency)) {
      const err = new Error('CURRENCY_MISMATCH');
      err.code = 'CURRENCY_MISMATCH';
      throw err;
    }
  }

  const merged = {
    ...existing,
    ...patch,
  };
  if (normalizedPaymentId) merged.payment_id = normalizedPaymentId;
  if (normalizedPreferenceId) merged.preference_id = normalizedPreferenceId;
  if (normalizedExternalRef) {
    merged.external_reference = normalizedExternalRef;
    if (!merged.id) merged.id = normalizedExternalRef;
  }
  if (!Array.isArray(merged.items) || merged.items.length === 0) {
    merged.items = existing.items;
  }

  return update(merged);
}

async function createOrder({ id, customer_email, items }) {
  const pool = db.getPool();
  const total = (items || []).reduce(
    (t, it) => t + Number(it.price) * Number(it.qty || it.quantity || 0),
    0
  );
  if (!pool) {
    const orders = await getAll();
    const existing = orders.find((o) => String(o.id) === String(id));
    if (existing) return existing;
    const order = {
      id,
      customer_email,
      status: 'approved',
      total,
      created_at: new Date().toISOString(),
      items,
    };
    orders.push(order);
    await saveAll(orders);
    for (const it of items || []) {
      const pid = it.product_id || it.id || it.productId;
      const qty = Number(it.qty || it.quantity || 0);
      if (pid && qty) {
        await productsRepo.adjustStock(pid, -qty, 'order', id);
      }
    }
    return order;
  }
  await pool.query('BEGIN');
  try {
    // Upsert primero, para evitar doble inserción en concurrencia
    await pool.query(
      'INSERT INTO orders (id, created_at, customer_email, status, total, inventory_applied) ' +
      'VALUES ($1, now(), $2, $3, $4, false) ' +
      'ON CONFLICT (id) DO NOTHING',
      [id, customer_email || null, 'approved', total]
    );
    // Ahora si: tomar lock de la fila
    const { rows } = await pool.query(
      'SELECT inventory_applied FROM orders WHERE id=$1 FOR UPDATE',
      [id]
    );
    const alreadyApplied = !!(rows[0] && rows[0].inventory_applied);
    if (alreadyApplied) {
      await pool.query(
        'UPDATE orders SET customer_email=COALESCE($2, customer_email), total=$3 WHERE id=$1',
        [id, customer_email || null, total]
      );
      await pool.query('COMMIT');
      return { id, customer_email, status: 'approved', total };
    }
    for (const it of items || []) {
      const pid = it.product_id || it.id || it.productId;
      const qty = Number(it.qty || it.quantity || 0);
      const price = Number(it.price || 0);
      if (!pid || !qty) continue;
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, qty, price) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id, product_id) DO NOTHING',
        [id, pid, qty, price]
      );
      await pool.query(
        'UPDATE products SET stock = GREATEST(stock - $1, 0), updated_at=now() WHERE id=$2',
        [qty, pid]
      );
      await pool.query(
        'INSERT INTO stock_movements(product_id, delta, reason, ref_id) VALUES ($1,$2,$3,$4)',
        [pid, -qty, 'order', id]
      );
    }
    await pool.query(
      'UPDATE orders SET inventory_applied=true, customer_email=COALESCE($2, customer_email), total=$3 WHERE id=$1',
      [id, customer_email || null, total]
    );
    await pool.query('COMMIT');
    return { id, customer_email, status: 'approved', total };
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function markInventoryApplied(id) {
  const pool = db.getPool();
  if (!pool) return; // JSON mode not used
  await pool.query('UPDATE orders SET inventory_applied = true WHERE id=$1', [id]);
}

async function clearInventoryApplied(id) {
  const pool = db.getPool();
  if (!pool) return;
  await pool.query('UPDATE orders SET inventory_applied=false WHERE id=$1', [id]);
}

module.exports = {
  getAll,
  getById,
  saveAll,
  create,
  update,
  createOrder,
  markInventoryApplied,
  clearInventoryApplied,
  upsertByPayment,
};
