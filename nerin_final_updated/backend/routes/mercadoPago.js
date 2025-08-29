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

const TRACE_REF = process.env.TRACE_REF;
function traceRef(ref, step, info) {
  if (TRACE_REF && String(ref) === String(TRACE_REF)) {
    logger.info(`trace ${step} ${JSON.stringify(info)}`);
  }
}

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
  merchantOrderId,
  total,
  lastWebhook,
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
    if (merchantOrderId != null)
      row.merchant_order_id = String(merchantOrderId);
    if (status) {
      row.payment_status = status;
      row.estado_pago = status;
      row.status = status;
    }
    if (statusRaw) row.payment_status_raw = statusRaw;
    if (total && !row.total) row.total = total;
    if (!row.created_at) row.created_at = new Date().toISOString();
    if (prefId != null) row.preference_id = prefId;
    if (externalRef != null) row.external_reference = externalRef;
    if (lastWebhook) row.last_mp_webhook = lastWebhook;
    row.updated_at = new Date().toISOString();
  } else {
    const row = { id: externalRef || prefId };
    if (prefId != null) row.preference_id = prefId;
    if (externalRef != null) row.external_reference = externalRef;
    row.payment_status = status || 'pendiente';
    row.estado_pago = status || 'pendiente';
    row.status = status || 'pendiente';
    if (statusRaw) row.payment_status_raw = statusRaw;
    if (paymentId != null) row.payment_id = String(paymentId);
    if (merchantOrderId != null)
      row.merchant_order_id = String(merchantOrderId);
    row.total = total || 0;
    row.created_at = new Date().toISOString();
    row.updated_at = row.created_at;
    if (lastWebhook) row.last_mp_webhook = lastWebhook;
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

async function processPayment(id, hints = {}, webhookInfo = null) {
  try {
    const res = await fetchFn(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    const p = await res.json();
    const statusRaw = p.status;
    const mapped = mapMpStatus(statusRaw);
    const externalRef = p.external_reference || hints.externalRef || null;
    const prefId = p.preference_id || hints.prefId || null;
    const merchantOrderId = p.order?.id || hints.merchantOrderId || null;
    const total = Number(
      p.transaction_amount ||
        p.transaction_details?.total_paid_amount ||
        p.amount ||
        0
    );
    const lastWebhook = {
      topic: webhookInfo?.topic || 'payment',
      id: webhookInfo?.id || p.id,
      status: statusRaw,
      at: webhookInfo?.at || new Date().toISOString(),
    };
    const traceId = externalRef || prefId;
    traceRef(traceId, 'webhook_received', webhookInfo || {});
    traceRef(traceId, 'mp_lookup', {
      status_raw: statusRaw,
      payment_id: p.id,
      merchant_order_id: merchantOrderId,
    });
    traceRef(traceId, 'mapped_status', { mapped });

    const { stockDelta } = await upsertOrder({
      externalRef,
      prefId,
      status: mapped,
      statusRaw,
      paymentId: p.id,
      merchantOrderId,
      total,
      lastWebhook,
    });

    const persistInfo = {
      status: mapped,
      stock_delta: stockDelta,
      idempotent: stockDelta === 0,
    };
    traceRef(traceId, 'order_persisted', persistInfo);

    logger.info(
      `mp-webhook OK ${JSON.stringify({
        topic: 'payment',
        paymentId: p.id,
        externalRef,
        prefId,
        status: mapped,
        stock_delta: stockDelta,
        idempotent: stockDelta === 0,
      })}`,
    );

    return { mp_lookup_ok: true, status: mapped, stockDelta, idempotent: stockDelta === 0 };
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
  const receivedAt = new Date().toISOString();

  logger.info(
    `mp-webhook recibido ${JSON.stringify({ topic, id: rawId })}`,
  );

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
          const merchantOrderId = data.id || null;
          if (!paymentId) {
            await upsertOrder({
              externalRef,
              prefId,
              status: 'pendiente',
              statusRaw: 'pending',
              lastWebhook: { topic, id: rawId, status: 'pending', at: receivedAt },
            });
            logger.info('mp-webhook merchant_order sin payment (pending)', {
              externalRef,
              prefId,
            });
            return { mp_lookup_ok: true, status: 'pendiente', stockDelta: 0, idempotent: true };
          }
          return await processPayment(
            paymentId,
            { externalRef, prefId, merchantOrderId },
            { topic, id: paymentId, at: receivedAt },
          );
        }
        if (data?.status && data?.external_reference) {
          return await processPayment(
            data.id,
            {
              externalRef: data.external_reference,
              prefId: data.preference_id,
              merchantOrderId: data.order_id || data.id,
            },
            { topic, id: data.id, at: receivedAt },
          );
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
        const merchantOrderId = mo?.id || null;
        if (!paymentId) {
          await upsertOrder({
            externalRef,
            prefId,
            status: 'pendiente',
            statusRaw: 'pending',
            lastWebhook: { topic, id: rawId, status: 'pending', at: receivedAt },
          });
          logger.info('mp-webhook merchant_order sin payment (pending)', {
            externalRef,
            prefId,
          });
          return { mp_lookup_ok: true, status: 'pendiente', stockDelta: 0, idempotent: true };
        }
        return await processPayment(
          paymentId,
          { externalRef, prefId, merchantOrderId },
          { topic, id: paymentId, at: receivedAt },
        );
      } catch (e) {
        logger.info('mp-webhook merchant_order fetch omitido', {
          moId,
          msg: e?.message,
        });
        return { mp_lookup_ok: false, status: null, stockDelta: 0, idempotent: true };
      }
    }

    if (topic === 'payment' || /^[0-9]+$/.test(String(rawId))) {
      return await processPayment(rawId, {}, { topic, id: rawId, at: receivedAt });
    }
  } catch (error) {
    logger.error(`mp-webhook error inesperado: ${error.message}`);
  }
}

module.exports = { processNotification, processPayment, traceRef };

