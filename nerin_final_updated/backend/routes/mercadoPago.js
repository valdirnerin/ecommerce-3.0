const fs = require('fs');
const path = require('path');
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const fetchFn =
  globalThis.fetch ||
  ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));

const logger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
};

function mapStatus(mpStatus) {
  const s = String(mpStatus || '').toLowerCase();
  if (s === 'approved') return 'pagado';
  if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(s))
    return 'rechazado';
  return 'pendiente';
}

function ordersPath() {
  return path.join(__dirname, '../../data/orders.json');
}

function getOrders() {
  try {
    const file = fs.readFileSync(ordersPath(), 'utf8');
    return JSON.parse(file).orders || [];
  } catch {
    return [];
  }
}

function saveOrders(orders) {
  fs.writeFileSync(ordersPath(), JSON.stringify({ orders }, null, 2), 'utf8');
}

function productsPath() {
  return path.join(__dirname, '../../data/products.json');
}

function getProducts() {
  try {
    const file = fs.readFileSync(productsPath(), 'utf8');
    return JSON.parse(file).products || [];
  } catch {
    return [];
  }
}

function saveProducts(products) {
  fs.writeFileSync(
    productsPath(),
    JSON.stringify({ products }, null, 2),
    'utf8'
  );
}

function wasProcessed(paymentId, statusRaw) {
  if (!paymentId) return false;
  const orders = getOrders();
  return orders.some(
    (o) =>
      String(o.payment_id) === String(paymentId) &&
      String(o.payment_status_raw || '') === String(statusRaw)
  );
}

async function upsertOrder({
  externalRef,
  prefId,
  status,
  statusRaw,
  paymentId,
  total,
}) {
  const identifier = prefId || externalRef;
  if (!identifier) return;
  const orders = getOrders();
  const idx = orders.findIndex(
    (o) =>
      o.id === identifier ||
      o.external_reference === identifier ||
      o.order_number === identifier ||
      String(o.preference_id) === String(identifier)
  );
  if (idx !== -1) {
    const row = orders[idx];
    if (paymentId != null) row.payment_id = String(paymentId);
    if (status) {
      row.payment_status = status;
      row.estado_pago = status;
    }
    if (statusRaw) row.payment_status_raw = statusRaw;
    if (total && !row.total) row.total = total;
    if (!row.created_at) row.created_at = new Date().toISOString();
    if (prefId != null) row.preference_id = prefId;
    if (externalRef != null) row.external_reference = externalRef;
  } else {
    const row = { id: externalRef || prefId };
    if (prefId != null) row.preference_id = prefId;
    if (externalRef != null) row.external_reference = externalRef;
    row.payment_status = status || 'pendiente';
    row.estado_pago = status || 'pendiente';
    if (statusRaw) row.payment_status_raw = statusRaw;
    if (paymentId != null) row.payment_id = String(paymentId);
    row.total = total || 0;
    row.created_at = new Date().toISOString();
    orders.push(row);
  }

  const row = orders[idx !== -1 ? idx : orders.length - 1];
  const items = row.productos || row.items || [];
  const identifierStr = row.id || row.external_reference || row.preference_id;

  if (statusRaw === 'approved') {
    if (!row.inventory_applied) {
      const products = getProducts();
      const logItems = [];
      let oversell = false;
      items.forEach((it) => {
        const pIdx = products.findIndex(
          (p) => String(p.id) === String(it.id) || p.sku === it.sku
        );
        if (pIdx !== -1) {
          const current = Number(products[pIdx].stock || 0);
          const qty = Number(it.quantity || 0);
          let next = current - qty;
          if (next < 0) {
            oversell = true;
            next = 0;
            products[pIdx].oversell = true;
          }
          products[pIdx].stock = next;
          logItems.push({ sku: products[pIdx].sku, qty });
        }
      });
      saveProducts(products);
      row.inventory_applied = true;
      row.inventory_applied_at = new Date().toISOString();
      if (oversell) row.oversell = true;
      logger.info('inventory apply OK', { order: identifierStr, items: logItems });
    } else {
      logger.info('inventory skipped (already applied)', {
        order: identifierStr,
      });
    }
  } else if (
    ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(statusRaw)
  ) {
    if (row.inventory_applied) {
      const products = getProducts();
      const logItems = [];
      items.forEach((it) => {
        const pIdx = products.findIndex(
          (p) => String(p.id) === String(it.id) || p.sku === it.sku
        );
        if (pIdx !== -1) {
          const qty = Number(it.quantity || 0);
          products[pIdx].stock = Number(products[pIdx].stock || 0) + qty;
          logItems.push({ sku: products[pIdx].sku, qty });
        }
      });
      saveProducts(products);
      row.inventory_applied = false;
      row.inventory_applied_at = null;
      logger.info('inventory revert OK', {
        order: identifierStr,
        items: logItems,
      });
    } else {
      logger.info('inventory skipped (not applied)', {
        order: identifierStr,
      });
    }
  }

  saveOrders(orders);
}

async function processPayment(id, hints = {}) {
  try {
    const res = await fetchFn(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    const p = await res.json();
    const statusRaw = p.status;
    const mapped = mapStatus(statusRaw);
    const externalRef = p.external_reference || hints.externalRef || null;
    const prefId = p.preference_id || hints.prefId || null;
    const total = Number(
      p.transaction_amount ||
        p.transaction_details?.total_paid_amount ||
        p.amount ||
        0
    );

    if (await wasProcessed(p.id, statusRaw)) {
      logger.info('mp-webhook payment idempotente (ya procesado)', {
        paymentId: p.id,
        status: statusRaw,
      });
      return;
    }

    await upsertOrder({
      externalRef,
      prefId,
      status: mapped,
      statusRaw,
      paymentId: p.id,
      total,
    });

    logger.info('mp-webhook OK', {
      topic: 'payment',
      paymentId: p.id,
      externalRef,
      prefId,
      status: mapped,
    });
  } catch (e) {
    logger.warn('mp-webhook payment fetch omitido', {
      paymentId: id,
      msg: e?.message,
    });
  }
}

async function processNotification(reqOrTopic, maybeId) {
  const body = reqOrTopic?.body || {};
  const query = reqOrTopic?.query || {};
  const topic =
    query.topic ||
    query.type ||
    body.type ||
    body.topic ||
    (typeof reqOrTopic === 'string' ? reqOrTopic : undefined);
  const rawId =
    query.id ||
    body?.data?.id ||
    body?.id ||
    (typeof reqOrTopic === 'string' ? maybeId : undefined) ||
    maybeId;
  const resource = query.resource || body?.resource;

  logger.info('mp-webhook recibido', { topic, id: rawId });

  try {
    if (resource) {
      try {
        const res = await fetchFn(resource, {
          headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        });
        const data = await res.json();
        if (data?.payments) {
          const paymentId = data.payments?.[0]?.id || null;
          const prefId = data.preference_id || null;
          const externalRef = data.external_reference || null;
          if (!paymentId) {
            await upsertOrder({ externalRef, prefId, status: 'pending' });
            logger.info('mp-webhook merchant_order sin payment (pending)', {
              externalRef,
              prefId,
            });
            return;
          }
          await processPayment(paymentId, { externalRef, prefId });
          return;
        }
        if (data?.status && data?.external_reference) {
          await processPayment(data.id, {
            externalRef: data.external_reference,
            prefId: data.preference_id,
          });
          return;
        }
      } catch (e) {
        logger.warn('mp-webhook resource fetch omitido', {
          resource,
          msg: e?.message,
        });
        return;
      }
    }

    if (topic === 'merchant_order') {
      const moId = Number(rawId) || rawId;
      try {
        const res = await fetchFn(
          `https://api.mercadopago.com/merchant_orders/${moId}`,
          { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
        );
        const mo = await res.json();
        const paymentId = mo?.payments?.[0]?.id || null;
        const prefId = mo?.preference_id || null;
        const externalRef = mo?.external_reference || null;
        if (!paymentId) {
          await upsertOrder({ externalRef, prefId, status: 'pending' });
          logger.info('mp-webhook merchant_order sin payment (pending)', {
            externalRef,
            prefId,
          });
          return;
        }
        await processPayment(paymentId, { externalRef, prefId });
        return;
      } catch (e) {
        logger.info('mp-webhook merchant_order fetch omitido', {
          moId,
          msg: e?.message,
        });
        return;
      }
    }

    if (topic === 'payment' || /^[0-9]+$/.test(String(rawId))) {
      await processPayment(rawId);
      return;
    }
  } catch (error) {
    logger.error(`mp-webhook error inesperado: ${error.message}`);
  }
}

module.exports = { processNotification };

