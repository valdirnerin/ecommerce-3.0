const fs = require('fs');
const path = require('path');
const dataDir = require('../utils/dataDir');
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const fetchFn =
  globalThis.fetch ||
  ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));
const db = require('../db');
const ordersRepo = require('../data/ordersRepo');
const productsRepo = require('../data/productsRepo');
const logger = require('../logger');
const {
  applyInventoryForOrder,
  revertInventoryForOrder,
} = require('../services/inventory');
const { mapMpStatus } = require('../../frontend/js/mpStatusMap');

function ordersPath() {
  return path.join(dataDir, 'orders.json');
}

async function getOrders() {
  if (db.getPool()) return ordersRepo.getAll();
  try {
    const file = fs.readFileSync(ordersPath(), 'utf8');
    return JSON.parse(file).orders || [];
  } catch {
    return [];
  }
}

async function saveOrders(orders) {
  if (db.getPool()) return ordersRepo.saveAll(orders);
  await fs.promises.writeFile(
    ordersPath(),
    JSON.stringify({ orders }, null, 2),
    'utf8'
  );
}

function productsPath() {
  return path.join(dataDir, 'products.json');
}

async function getProducts() {
  if (db.getPool()) return productsRepo.getAll();
  try {
    const file = fs.readFileSync(productsPath(), 'utf8');
    return JSON.parse(file).products || [];
  } catch {
    return [];
  }
}

async function saveProducts(products) {
  if (db.getPool()) return productsRepo.saveAll(products);
  await fs.promises.writeFile(
    productsPath(),
    JSON.stringify({ products }, null, 2),
    'utf8'
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
  const orders = await getOrders();
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
  const inventoryApplied = row.inventoryApplied || row.inventory_applied;

  await saveOrders(orders);

  let stockDelta = 0;
  if (statusRaw === 'approved') {
    if (db.getPool()) {
      await ordersRepo.createOrder({
        id: row.external_reference || row.id,
        customer_email: row.cliente?.email || null,
        items: row.productos || row.items || [],
      });
    } else if (!inventoryApplied) {
      const qty = await applyInventoryForOrder(row);
      if (qty) stockDelta -= qty;
    }
  } else if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(statusRaw)) {
    if (db.getPool()) {
      const oid = row.external_reference || row.id;
      if (oid) {
        const dbOrder = await ordersRepo.getById(oid);
        if (dbOrder && dbOrder.inventory_applied) {
          const qty = await revertInventoryForOrder(dbOrder);
          if (qty) stockDelta += qty;
        }
      }
    } else if (inventoryApplied) {
      const qty = await revertInventoryForOrder(row);
      if (qty) stockDelta += qty;
    }
  }

  return { stockDelta };
}

async function processPayment(id, hints = {}) {
  try {
    const res = await fetchFn(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    const p = await res.json();
    const statusRaw = p.status;
    const mapped = mapMpStatus(statusRaw);
    const externalRef = p.external_reference || hints.externalRef || null;
    const prefId = p.preference_id || hints.prefId || null;
    const total = Number(
      p.transaction_amount ||
        p.transaction_details?.total_paid_amount ||
        p.amount ||
        0
    );
    const { stockDelta } = await upsertOrder({
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
      stock_delta: stockDelta,
    });

    return {
      mp_lookup_ok: true,
      status: mapped,
      stockDelta,
      idempotent: stockDelta === 0,
    };
  } catch (e) {
    logger.warn('mp-webhook payment fetch omitido', {
      paymentId: id,
      msg: e?.message,
    });
    return {
      mp_lookup_ok: false,
      status: null,
      stockDelta: 0,
      idempotent: true,
    };
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
    body?.payment_id ||
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
            return { mp_lookup_ok: true, status: 'pendiente', stockDelta: 0, idempotent: true };
          }
          return await processPayment(paymentId, { externalRef, prefId });
        }
        if (data?.status && data?.external_reference) {
          return await processPayment(data.id, {
            externalRef: data.external_reference,
            prefId: data.preference_id,
          });
        }
      } catch (e) {
        logger.warn('mp-webhook resource fetch omitido', {
          resource,
          msg: e?.message,
        });
        return { mp_lookup_ok: false, status: null, stockDelta: 0, idempotent: true };
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
          return { mp_lookup_ok: true, status: 'pendiente', stockDelta: 0, idempotent: true };
        }
        return await processPayment(paymentId, { externalRef, prefId });
      } catch (e) {
        logger.info('mp-webhook merchant_order fetch omitido', {
          moId,
          msg: e?.message,
        });
        return { mp_lookup_ok: false, status: null, stockDelta: 0, idempotent: true };
      }
    }

    if (topic === 'payment' || /^[0-9]+$/.test(String(rawId))) {
      return await processPayment(rawId);
    }
  } catch (error) {
    logger.error(`mp-webhook error inesperado: ${error.message}`);
  }
}

module.exports = { processNotification };

