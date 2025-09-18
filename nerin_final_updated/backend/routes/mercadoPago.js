const db = require('../db');
const ordersRepo = require('../data/ordersRepo');

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const fetchFn =
  globalThis.fetch ||
  ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const logger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

const VALID_ACTIONS = new Set(['payment.created', 'payment.updated']);

function getMpClient() {
  if (!ACCESS_TOKEN) {
    throw new Error('MP_ACCESS_TOKEN not configured');
  }
  return {
    payment: {
      findById: async (id) => {
        const res = await fetchFn(`https://api.mercadopago.com/v1/payments/${id}`, {
          headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        });
        if (!res.ok) {
          const error = new Error(`payment fetch failed (${res.status})`);
          error.status = res.status;
          throw error;
        }
        return res.json();
      },
    },
  };
}

function normalizePaymentResponse(res) {
  if (res && res.body && typeof res.body === 'object') return res.body;
  return res;
}

function extractAmount(payment) {
  if (!payment) return null;
  const rawAmount =
    payment.transaction_amount ??
    payment.transaction_details?.total_paid_amount ??
    payment.amount ??
    null;
  if (rawAmount == null) return null;
  const amount = Number(rawAmount);
  return Number.isFinite(amount) ? amount : null;
}

function extractCurrency(payment) {
  if (!payment) return null;
  return (
    payment.currency_id ||
    payment.currency ||
    payment.transaction_details?.currency_id ||
    null
  );
}

function extractIdFromResource(resource) {
  try {
    const last = String(resource)
      .split('?')[0]
      .split('/')
      .filter(Boolean)
      .pop();
    return last && /^\d+$/.test(last) ? last : null;
  } catch {
    return null;
  }
}

function extractPaymentEvent(req = {}) {
  const b = req.body || {};
  const q = req.query || {};
  const resUrl = b.resource || q.resource || null;
  let type = b.type || b.topic || q.type || q.topic || null;
  const action = b.action || b.event || null;
  let id =
    (b.data && (b.data.id || b.data.payment_id)) ||
    b.payment_id ||
    b.id ||
    q.id ||
    null;
  if (!id && resUrl) {
    id = extractIdFromResource(resUrl);
  }
  if (!type && id) {
    type = 'payment';
  }
  return { type, action, id };
}

async function handlePayment(paymentId, hints = {}) {
  if (!paymentId) return 'ignored';
  let payment;
  try {
    const client = getMpClient();
    const res = await client.payment.findById(paymentId);
    payment = normalizePaymentResponse(res);
  } catch (error) {
    logger.warn('mp-webhook payment fetch failed', {
      paymentId,
      msg: error?.message,
    });
    return 'error';
  }

  if (!payment || payment.status !== 'approved') {
    logger.info('mp-webhook ignored (status)', {
      paymentId,
      status: payment?.status,
    });
    return 'ignored';
  }

  const amount = extractAmount(payment);
  const currency = extractCurrency(payment);
  const reference =
    payment.external_reference ||
    hints.external_reference ||
    payment.metadata?.order_id ||
    null;
  const preferenceId = payment.preference_id || hints.preference_id || null;

  try {
    const updated = await ordersRepo.upsertByPayment({
      payment_id: paymentId,
      preference_id: preferenceId,
      external_reference: reference,
      amount,
      currency,
      patch: {
        status: 'paid',
        payment_status: 'approved',
        estado_pago: 'pagado',
        paid_at: new Date().toISOString(),
        paid_amount: amount,
        paid_currency: currency,
        mp_payment: { id: paymentId, status: payment.status },
      },
    });
    if (!updated) {
      logger.warn('mp-webhook order not found', {
        paymentId,
        reference,
        preferenceId,
      });
      return 'no-order';
    }

    // En modo archivo, asegurarnos de aplicar inventario si aún no se hizo.
    if (!db.getPool()) {
      const inventoryApplied =
        updated.inventoryApplied === true ||
        updated.inventory_applied === true;
      if (!inventoryApplied && Array.isArray(updated.items) && updated.items.length) {
        try {
          const { applyInventoryForOrder } = require('../services/inventory');
          await applyInventoryForOrder(updated);
        } catch (err) {
          logger.error('mp-webhook inventory apply failed', {
            paymentId,
            msg: err?.message,
          });
        }
      }
    }

    logger.info('mp-webhook order updated', {
      paymentId,
      reference,
      preferenceId,
    });
    return 'ok';
  } catch (error) {
    if (error && error.code === 'AMOUNT_MISMATCH') {
      logger.warn('mp-webhook amount mismatch', {
        paymentId,
        amount,
      });
      return 'amount-mismatch';
    }
    if (error && error.code === 'CURRENCY_MISMATCH') {
      logger.warn('mp-webhook currency mismatch', {
        paymentId,
        currency,
      });
      return 'currency-mismatch';
    }
    if (error && error.message === 'ORDER_WITHOUT_ITEMS') {
      logger.warn('mp-webhook missing items', { paymentId });
      return 'no-order';
    }
    logger.error('mp-webhook unexpected error', {
      paymentId,
      msg: error?.message,
    });
    throw error;
  }
}

function extractFromBody(body = {}, query = {}) {
  const { type, action, id } = extractPaymentEvent({ body, query });
  const data = body.data || {};
  const paymentId =
    id ||
    data.id ||
    data.payment_id ||
    body.payment_id ||
    body.id ||
    query.id ||
    null;
  const external_reference = data.external_reference || body.external_reference || null;
  const preference_id = data.preference_id || body.preference_id || null;
  return { type, action, paymentId, external_reference, preference_id };
}

async function processNotification(reqOrTopic, maybeId) {
  if (reqOrTopic && typeof reqOrTopic === 'object' && 'body' in reqOrTopic) {
    const { body = {}, query = {} } = reqOrTopic;
    const { type, action, paymentId, external_reference, preference_id } =
      extractFromBody(body, query);
    if (type !== 'payment') {
      logger.info('mp-webhook ignored', { type, action });
      return 'ignored';
    }
    const effectiveAction = action || 'payment.updated';
    if (!VALID_ACTIONS.has(effectiveAction)) {
      logger.info('mp-webhook ignored', { type, action: effectiveAction });
      return 'ignored';
    }
    if (!paymentId) {
      logger.warn('mp-webhook missing payment id');
      return 'ignored';
    }
    return handlePayment(paymentId, {
      external_reference,
      preference_id,
    });
  }

  const topic = typeof reqOrTopic === 'string' ? reqOrTopic : null;
  const paymentId = maybeId || (topic && /^[0-9]+$/.test(topic) ? topic : null);
  if (topic && topic !== 'payment') {
    logger.info('mp-webhook ignored legacy call', { topic });
    return 'ignored';
  }
  if (!paymentId) {
    logger.warn('mp-webhook legacy call without id');
    return 'ignored';
  }
  return handlePayment(paymentId);
}

module.exports = { processNotification, getMpClient };
