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
const { envFlag } = require('../utils/envFlag');
const {
  applyInventoryForOrder,
  revertInventoryForOrder,
} = require('../services/inventory');
const { mapMpStatus } = require('../../frontend/js/mpStatusMap');

const TRACE_REF = process.env.TRACE_REF;
const NODE_ENV = process.env.NODE_ENV || 'production';
const MP_ENV = process.env.MP_ENV || 'production';
const rawSkip = envFlag('SKIP_MP_PAYMENT_FETCH');
const hasToken = !!ACCESS_TOKEN;
const effective_skip =
  hasToken && (NODE_ENV === 'production' || MP_ENV === 'production')
    ? false
    : rawSkip;
logger.info(
  `mp-webhook flags ${JSON.stringify({
    NODE_ENV,
    MP_ENV,
    raw_SKIP: process.env.SKIP_MP_PAYMENT_FETCH,
    effective_skip,
    has_token: hasToken,
  })}`
);
const SKIP_MP_PAYMENT_FETCH = effective_skip;
const ENABLE_MP_WEBHOOK_HEALTH = envFlag('ENABLE_MP_WEBHOOK_HEALTH');

function normalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

let skuMap = {};
try {
  skuMap = require('../config/skuMap.json');
} catch {}
const skuMapNorm = Object.fromEntries(
  Object.entries(skuMap).map(([k, v]) => [normalize(k), String(v)])
);

async function resolveItems(items) {
  const products = await getProducts();
  const matched = [];
  const unmatched = [];
  for (const it of items || []) {
    const quantity = Number(it.quantity || it.qty || 0);
    const unit_price = Number(it.unit_price || it.price || 0);
    const title = it.title || it.name || '';
    const rawId = it.id || it.product_id || it.productId || null;
    const sku = it.sku || null;
    let product = null;
    if (rawId != null) {
      product = products.find((p) => String(p.id) === String(rawId));
    }
    if (!product && sku) {
      product = products.find((p) => normalize(p.sku) === normalize(sku));
    }
    if (!product) {
      const mapped = skuMapNorm[normalize(title)];
      if (mapped) {
        product = products.find(
          (p) =>
            String(p.id) === String(mapped) ||
            normalize(p.sku) === normalize(mapped)
        );
      }
    }
    if (!product && title) {
      product = products.find((p) => normalize(p.name) === normalize(title));
    }
    if (product) {
      matched.push({
        productId: product.id,
        sku: product.sku,
        title,
        quantity,
        unit_price,
      });
    } else {
      unmatched.push({ title, id: rawId || sku, reason: 'not_found' });
    }
  }
  return { matched, unmatched };
}

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
  items,
  rawData,
}) {
  let keyUsed = null;
  let identifier = null;
  if (externalRef) {
    identifier = externalRef;
    keyUsed = 'external_reference';
  } else if (prefId) {
    identifier = prefId;
    keyUsed = 'preference_id';
  } else if (paymentId) {
    identifier = String(paymentId);
    keyUsed = 'payment_id';
  } else if (merchantOrderId) {
    identifier = String(merchantOrderId);
    keyUsed = 'merchant_order_id';
  } else {
    identifier = `stub_${Date.now()}`;
    keyUsed = 'stub';
  }
  const orders = await getOrders();
  let idx = orders.findIndex(
    (o) =>
      o.id === identifier ||
      o.external_reference === identifier ||
      o.order_number === identifier ||
      String(o.preference_id) === String(identifier)
  );
  if (idx === -1 && paymentId) {
    idx = orders.findIndex((o) => String(o.payment_id) === String(paymentId));
    if (idx !== -1) keyUsed = 'payment_id';
  }
  let row;
  let createdStub = false;
  if (idx === -1) {
    if (keyUsed === 'stub') {
      createdStub = true;
      logger.warn('mp-webhook order_stub_created', {
        paymentId,
        merchantOrderId,
      });
    } else {
      logger.warn('mp-webhook order_not_found', {
        externalRef,
        prefId,
        paymentId,
      });
    }
    row = {
      id: identifier,
      external_reference: externalRef || prefId || identifier,
      preference_id: prefId,
      payment_id: paymentId ? String(paymentId) : undefined,
      merchant_order_id: merchantOrderId ? String(merchantOrderId) : undefined,
      total,
      productos: Array.isArray(items) ? items : [],
      items: Array.isArray(items) ? items : [],
      payment_status: status,
      estado_pago: status,
      status,
      payment_status_raw: statusRaw,
      created_at: new Date().toISOString(),
      last_mp_webhook: lastWebhook,
    };
    orders.push(row);
  } else {
    row = orders[idx];
    if (externalRef && row.id === String(paymentId)) row.id = externalRef;
    if (paymentId != null) row.payment_id = String(paymentId);
    if (merchantOrderId != null) row.merchant_order_id = String(merchantOrderId);
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
  }
  let matchResult = { matched: 0, unmatched: 0, details: [] };
  if (Array.isArray(items) && items.length) {
    const { matched, unmatched } = await resolveItems(items);
    row.productos = matched;
    row.items = matched;
    row.unmatched_items = unmatched;
    matchResult = {
      matched: matched.length,
      unmatched: unmatched.length,
      details: unmatched,
    };
  }

  row.updated_at = new Date().toISOString();

  const rowItems = row.productos || row.items || [];
  if (!Array.isArray(rowItems) || rowItems.length === 0) {
    await saveOrders(orders);
    logger.warn('mp-webhook items_missing', {
      orderId: row.id,
      paymentId,
      reason: 'no_items',
      raw: rawData,
    });
    logger.info(`match_result ${JSON.stringify(matchResult)}`);
    logger.info(
      `order_resolution ${JSON.stringify({
        key_used: keyUsed,
        orderId: row.id,
        preferenceId: row.preference_id || prefId || null,
        externalRef: row.external_reference || externalRef || null,
      })}`,
    );
    return {
      stockDelta: 0,
      idempotent: false,
      itemsChanged: [],
      orderId: row.id,
      keyUsed,
      matchResult,
    };
  }

  const inventoryApplied = row.inventoryApplied || row.inventory_applied;
  await saveOrders(orders);
  let stockDelta = 0;
  let idempotent = false;
  let itemsChanged = [];
  if (statusRaw === 'approved') {
    if (db.getPool()) {
      const res = await ordersRepo.createOrder({
        id: row.external_reference || row.id,
        customer_email: row.cliente?.email || null,
        items: row.productos || row.items || [],
      });
      if (res) {
        if (!res.alreadyApplied && res.totalQty) stockDelta -= res.totalQty;
        itemsChanged = (res.itemsChanged || []).map((it) => ({
          productId: it.sku,
          qty_before: it.before,
          qty_after: it.after,
        }));
        idempotent = res.alreadyApplied;
      }
    } else if (!inventoryApplied) {
      const res = await applyInventoryForOrder(row);
      if (res?.total) stockDelta -= res.total;
      itemsChanged = res?.items || [];
      row.inventoryApplied = true;
      row.inventory_applied = true;
      row.inventory_applied_at = new Date().toISOString();
    } else {
      idempotent = true;
    }
  } else if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(statusRaw)) {
    if (db.getPool()) {
      const oid = row.external_reference || row.id;
      if (oid) {
        const dbOrder = await ordersRepo.getById(oid);
        if (dbOrder && dbOrder.inventory_applied) {
          const res = await revertInventoryForOrder(dbOrder);
          if (res?.total) stockDelta += res.total;
          itemsChanged = (res?.items || []).map((it) => ({
            productId: it.productId || it.sku,
            qty_before: it.qty_before || it.before,
            qty_after: it.qty_after || it.after,
          }));
        }
      }
    } else if (inventoryApplied) {
      const res = await revertInventoryForOrder(row);
      if (res?.total) stockDelta += res.total;
      itemsChanged = res?.items || [];
      row.inventoryApplied = false;
      row.inventory_applied = false;
    }
  }

  if (!idempotent && inventoryApplied && stockDelta === 0) {
    idempotent = true;
  }

  row.items_changed = itemsChanged;
  row.updated_at = new Date().toISOString();
  await saveOrders(orders);

  logger.info(`match_result ${JSON.stringify(matchResult)}`);

  logger.info(
    `order_resolution ${JSON.stringify({
      key_used: keyUsed,
      orderId: row.id,
      preferenceId: row.preference_id || prefId || null,
      externalRef: row.external_reference || externalRef || null,
    })}`,
  );
  return {
    stockDelta,
    idempotent,
    itemsChanged,
    orderId: row.id,
    keyUsed,
    matchResult,
  };
}

async function processPayment(id, hints = {}, webhookInfo = null) {
  if (SKIP_MP_PAYMENT_FETCH) {
    logger.warn('mp-webhook payment fetch omitido (flag)', { paymentId: id });
    return {
      mp_lookup_ok: false,
      status: null,
      stockDelta: 0,
      idempotent: false,
    };
  }
  try {
    const res = await fetchFn(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    const p = await res.json();
    const statusRaw = p.status;
    const mapped = mapMpStatus(statusRaw);
    const prefId = p.preference_id || hints.prefId || null;
    const merchantOrderId = p.order?.id || hints.merchantOrderId || null;
    let mo = null;
    let items = [];
    let itemsSource = 'none';
    if (merchantOrderId) {
      try {
        const moRes = await fetchFn(
          `https://api.mercadopago.com/merchant_orders/${merchantOrderId}`,
          { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
        );
        mo = await moRes.json();
        const moItems = mo.order_items || mo.items || [];
        if (Array.isArray(moItems) && moItems.length) {
          items = moItems.map((it) => ({
            id: it.item?.id || it.id,
            product_id: it.item?.id || it.id,
            quantity: it.quantity || it.item?.quantity || it.qty || 0,
            price: it.unit_price || it.item?.unit_price || it.price || 0,
            title: it.item?.title || it.title,
            sku: it.sku || it.item?.sku || it.item?.id || it.id,
          }));
          itemsSource = 'merchant_order';
        }
      } catch (e) {
        logger.debug('mp-webhook merchant_order items fetch error', {
          merchantOrderId,
          msg: e?.message,
        });
      }
    }
    if (!items.length) {
      const payItems = p.additional_info?.items || p.order?.items || [];
      if (Array.isArray(payItems) && payItems.length) {
        items = payItems.map((it) => ({
          id: it.id || it.sku || it.productId || it.product_id,
          product_id: it.product_id || it.productId || it.id || it.sku,
          quantity: it.quantity || it.qty || 0,
          price: it.unit_price || it.price || 0,
          title: it.title || it.name,
          sku: it.sku || it.id,
        }));
        itemsSource = 'payment';
      }
    }
    if (!items.length && prefId) {
      try {
        const prefRes = await fetchFn(
          `https://api.mercadopago.com/checkout/preferences/${prefId}`,
          { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
        );
        const pref = await prefRes.json();
        const prefItems = pref.items || [];
        if (Array.isArray(prefItems) && prefItems.length) {
          items = prefItems.map((it) => ({
            id: it.id || it.sku || it.productId || it.product_id,
            product_id: it.product_id || it.productId || it.id || it.sku,
            quantity: it.quantity || it.qty || 0,
            price: it.unit_price || it.price || 0,
            title: it.title || it.name,
            sku: it.sku || it.id,
          }));
          itemsSource = 'preference';
        }
      } catch (e) {
        logger.debug('mp-webhook preference items fetch error', {
          prefId,
          msg: e?.message,
        });
      }
    }
    if (!items.length) itemsSource = 'none';
    logger.info(
      `items_source ${JSON.stringify({ from: itemsSource, count: items.length })}`,
    );

    const externalRef =
      p.additional_info?.external_reference ||
      mo?.external_reference ||
      prefId;
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

    const { stockDelta, idempotent, itemsChanged } = await upsertOrder({
      externalRef,
      prefId,
      status: mapped,
      statusRaw,
      paymentId: p.id,
      merchantOrderId,
      total,
      lastWebhook,
      items,
      rawData: { payment: p, merchant_order: mo },
    });

    const persistInfo = {
      status: mapped,
      stock_delta: stockDelta,
      idempotent,
    };
    traceRef(traceId, 'order_persisted', persistInfo);

    logger.info(
      `apply_stock ${JSON.stringify({
        paymentId: p.id,
        items_changed: itemsChanged,
        stock_delta: stockDelta,
        idempotent,
      })}`,
    );

    logger.info(
      `mp-webhook OK ${JSON.stringify({
        orderId: externalRef || prefId,
        externalRef,
        paymentId: p.id,
        final_status: mapped,
        items_changed: itemsChanged,
        stock_delta: stockDelta,
        idempotent,
      })}`,
    );

    return { mp_lookup_ok: true, status: mapped, stockDelta, idempotent };
  } catch (e) {
    logger.error('mp-webhook payment fetch omitido', {
      paymentId: id,
      msg: e?.message,
    });
    return {
      mp_lookup_ok: false,
      status: null,
      stockDelta: 0,
      idempotent: false,
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
    body?.payment_id ||
    body?.data?.id ||
    body?.id ||
    query.id ||
    (typeof reqOrTopic === 'string' ? maybeId : undefined) ||
    maybeId;
  const resource = query.resource || body?.resource;
  const receivedAt = new Date().toISOString();

  logger.info(
    `mp-webhook flags ${JSON.stringify({
      effective_skip: SKIP_MP_PAYMENT_FETCH,
      has_token: hasToken,
      topic,
    })}`,
  );

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
              items: data.items || [],
              rawData: { resource: data },
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
            items: mo.items || [],
            rawData: { merchant_order: mo },
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

