const fs = require('fs');
const path = require('path');
const { MercadoPagoConfig, Payment, MerchantOrder } = require('mercadopago');

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const mpClient = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
const paymentClient = new Payment(mpClient);
const merchantClient = new MerchantOrder(mpClient);

const logger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
};

function mapStatus(mpStatus) {
  return mpStatus === 'approved'
    ? 'approved'
    : mpStatus === 'rejected'
    ? 'rejected'
    : 'pending';
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

async function upsertOrder({ externalRef, prefId, status, paymentId }) {
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
    row.payment_id = paymentId ? String(paymentId) : row.payment_id;
    row.payment_status = status || row.payment_status;
    row.estado_pago = status || row.estado_pago;
    row.preference_id = prefId || row.preference_id;
    row.external_reference = externalRef || row.external_reference;
  } else {
    orders.push({
      id: externalRef || prefId,
      preference_id: prefId || null,
      external_reference: externalRef || null,
      payment_status: status || 'pending',
      estado_pago: status || 'pending',
      payment_id: paymentId ? String(paymentId) : null,
    });
  }
  saveOrders(orders);
}

async function processNotification(input, maybeId) {
  const body = input?.body || {};
  const query = input?.query || {};
  const topic = query.topic || query.type || body.type || input?.topic || input;
  const rawId =
    query.id ||
    (body.data && body.data.id) ||
    body.id ||
    input?.id ||
    maybeId;
  const resource = query.resource || body.resource || input?.resource;

  logger.info('mp-webhook recibido', { topic, id: rawId });

  let externalRef = input?.externalRef || null;
  let prefId = input?.prefId || null;
  let paymentId = null;

  try {
    if (resource) {
      const res = await fetch(resource, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      });
      const data = await res.json();
      if (data.payments) {
        const mo = data;
        paymentId = mo.payments?.[0]?.id || null;
        prefId = mo.preference_id || null;
        externalRef = mo.external_reference || null;
        if (!paymentId) {
          await upsertOrder({ externalRef, prefId, status: 'pending' });
          logger.info('mp-webhook merchant_order sin payment', {
            externalRef,
            prefId,
          });
          return;
        }
      } else if (data.status && data.external_reference) {
        const p = data;
        const status = mapStatus(p.status);
        externalRef = p.external_reference || externalRef;
        prefId = p.preference_id || prefId;
        await upsertOrder({
          externalRef,
          prefId,
          status,
          paymentId: p.id,
        });
        logger.info('mp-webhook OK', {
          topic: 'payment',
          paymentId: p.id,
          externalRef,
          prefId,
          status,
        });
        return;
      }
    }

    if (topic === 'merchant_order') {
      const mo = await merchantClient.get({ id: rawId });
      paymentId = mo.payments?.[0]?.id || null;
      prefId = mo.preference_id || prefId || null;
      externalRef = mo.external_reference || externalRef || null;
      if (!paymentId) {
        await upsertOrder({ externalRef, prefId, status: 'pending' });
        logger.info('mp-webhook merchant_order sin payment', {
          externalRef,
          prefId,
        });
        return;
      }
    }

    if (topic === 'payment' || paymentId) {
      const p = await paymentClient.get({ id: paymentId || rawId });
      const status = mapStatus(p.status);
      externalRef = p.external_reference || externalRef;
      prefId = p.preference_id || prefId;
      await upsertOrder({
        externalRef,
        prefId,
        status,
        paymentId: p.id,
      });
      logger.info('mp-webhook OK', {
        topic: 'payment',
        paymentId: p.id,
        externalRef,
        prefId,
        status,
      });
      return;
    }

    if (externalRef || prefId) {
      await upsertOrder({ externalRef, prefId, status: 'pending' });
    } else {
      logger.warn('mp-webhook sin referencias', { body, query });
    }
  } catch (error) {
    logger.error(`Error al procesar webhook: ${error.message}`);
  }
}

module.exports = { processNotification };

