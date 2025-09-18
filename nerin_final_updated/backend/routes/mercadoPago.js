const ordersRepo = require('../data/ordersRepo');
const {
  STATUS_CODE_TO_ES: BASE_STATUS_CODE_TO_ES,
} = require('../utils/paymentStatus');
const {
  applyInventoryForOrder,
  revertInventoryForOrder,
} = require('../services/inventory');

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const fetchFn =
  globalThis.fetch ||
  ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const logger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

const STATUS_CODE_TO_ES = {
  ...BASE_STATUS_CODE_TO_ES,
  refunded: 'rechazado',
  charged_back: 'rechazado',
  cancelled: 'rechazado',
  canceled: 'rechazado',
};

const VALID_ACTIONS = new Set(['payment.created', 'payment.updated']);

function normalizeMpStatus(status = '') {
  const key = String(status).toLowerCase();
  if (key === 'approved') return 'approved';
  if (key === 'pending' || key === 'in_process' || key === 'in process') {
    return 'pending';
  }
  if (key === 'refunded') return 'refunded';
  if (key === 'charged_back' || key === 'charged-back' || key === 'chargeback') {
    return 'charged_back';
  }
  if (key === 'cancelled' || key === 'canceled' || key === 'rejected') {
    return 'rejected';
  }
  return 'pending';
}

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

  if (!payment) {
    logger.info('mp-webhook missing payment', { paymentId });
    return 'ignored';
  }

  const nextCode = normalizeMpStatus(payment.status);
  const nextEs = STATUS_CODE_TO_ES[nextCode] || 'pendiente';
  const amount = extractAmount(payment);
  const currency = extractCurrency(payment);
  const reference =
    payment.external_reference ||
    hints.external_reference ||
    payment.metadata?.order_id ||
    null;
  const preferenceId = payment.preference_id || hints.preference_id || null;

  try {
    const order = await ordersRepo.findByPaymentIdentifiers({
      payment_id: paymentId,
      preference_id: preferenceId,
      external_reference: reference,
    });

    if (!order) {
      logger.warn('mp-webhook order not found', {
        paymentId,
        reference,
        preferenceId,
      });
      return 'no-order';
    }

    const previousCode = normalizeMpStatus(
      order.payment_status_code || order.payment_status || order.estado_pago || ''
    );
    const wasApproved = previousCode === 'approved';
    const willBeApproved = nextCode === 'approved';

    const normalizedItems =
      typeof ordersRepo.getNormalizedItems === 'function'
        ? ordersRepo.getNormalizedItems(order)
        : Array.isArray(order.items)
        ? order.items
        : [];
    const orderForInventory =
      normalizedItems && normalizedItems.length
        ? { ...order, items: normalizedItems }
        : order;

    const inventoryAppliedPrev =
      order.inventoryApplied === true || order.inventory_applied === true;
    let inventoryAppliedNext = inventoryAppliedPrev;

    if (willBeApproved && !inventoryAppliedPrev && normalizedItems.length) {
      try {
        await applyInventoryForOrder(orderForInventory);
        inventoryAppliedNext = true;
      } catch (err) {
        logger.error('mp-webhook inventory apply failed', {
          paymentId,
          msg: err?.message,
        });
      }
    } else if (wasApproved && !willBeApproved && inventoryAppliedPrev) {
      try {
        await revertInventoryForOrder(orderForInventory);
        inventoryAppliedNext = false;
      } catch (err) {
        logger.error('mp-webhook inventory revert failed', {
          paymentId,
          msg: err?.message,
        });
      }
    }

    const now = new Date().toISOString();
    const patch = {
      payment_status_code: nextCode,
      payment_status: nextEs,
      estado_pago: nextEs,
      status: willBeApproved
        ? 'paid'
        : nextCode === 'pending'
        ? order.status || 'pending'
        : 'canceled',
      paid_at: willBeApproved ? now : order.paid_at ?? null,
      paid_amount: willBeApproved ? amount : order.paid_amount ?? null,
      paid_currency: willBeApproved ? currency : order.paid_currency ?? null,
      mp_payment: { id: paymentId, status: payment.status },
    };

    if (inventoryAppliedNext !== inventoryAppliedPrev) {
      patch.inventoryApplied = inventoryAppliedNext;
      patch.inventory_applied = inventoryAppliedNext;
      patch.inventory_applied_at = inventoryAppliedNext ? now : null;
    }

    const upsertArgs = {
      payment_id: paymentId,
      preference_id: preferenceId,
      external_reference: reference,
      patch,
    };

    if (willBeApproved) {
      if (typeof amount === 'number' && Number.isFinite(amount)) {
        upsertArgs.amount = amount;
      }
      if (currency) {
        upsertArgs.currency = currency;
      }
    }

    const updated = await ordersRepo.upsertByPayment(upsertArgs);
    if (!updated) {
      logger.warn('mp-webhook order not found', {
        paymentId,
        reference,
        preferenceId,
      });
      return 'no-order';
    }

    logger.info('mp-webhook order updated', {
      paymentId,
      reference,
      preferenceId,
      status: nextCode,
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
