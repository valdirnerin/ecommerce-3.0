const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../logger');

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const API_BASE = 'https://api.mercadopago.com';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`mp fetch failed ${res.status}`);
  return res.json();
}

router.post('/', async (req, res) => {
  try {
    const eventType = req.body?.type || req.query?.topic;
    const id = req.body?.data?.id || req.query?.id;
    if (!eventType || !id) {
      return res.status(400).json({ error: 'type/id required' });
    }

    let paymentId = id;
    let status;
    let external_reference;
    let preference_id;

    if (eventType === 'payment') {
      const payment = await fetchJson(`${API_BASE}/v1/payments/${id}`);
      status = payment.status;
      external_reference = payment.external_reference;
      preference_id = payment.preference_id;
    } else if (eventType === 'merchant_order') {
      const mo = await fetchJson(`${API_BASE}/merchant_orders/${id}`);
      preference_id = mo.preference_id;
      if (mo.payments && mo.payments[0] && mo.payments[0].id) {
        paymentId = mo.payments[0].id;
        const payment = await fetchJson(`${API_BASE}/v1/payments/${paymentId}`);
        status = payment.status;
        external_reference = payment.external_reference;
        if (!preference_id) preference_id = payment.preference_id;
      }
    } else {
      return res.sendStatus(200);
    }

    const map = {
      approved: 'paid',
      rejected: 'rejected',
      in_process: 'pending',
      pending: 'pending',
    };
    const mapped = map[status] || 'pending';

    let updated = 0;
    if (preference_id) {
      const r = await db.query(
        'UPDATE orders SET payment_status = $1, payment_id = $2 WHERE preference_id = $3',
        [mapped, String(paymentId), String(preference_id)]
      );
      updated = r.rowCount;
    }
    if (updated === 0 && external_reference) {
      const r = await db.query(
        'UPDATE orders SET payment_status = $1, payment_id = $2 WHERE order_number = $3',
        [mapped, String(paymentId), String(external_reference)]
      );
      updated = r.rowCount;
    }
    if (updated === 0) {
      await db.query(
        'INSERT INTO orders (order_number, preference_id, payment_status, payment_id) VALUES ($1,$2,$3,$4)',
        [String(external_reference || ''), String(preference_id || ''), mapped, String(paymentId)]
      );
    }

    logger.info('mp-webhook', {
      eventType,
      paymentId: String(paymentId),
      status: mapped,
      external_reference,
      preference_id,
      updatedRows: updated,
    });

    res.sendStatus(200);
  } catch (err) {
    logger.error(`Error webhook MP: ${err.message}`);
    res.sendStatus(500);
  }
});

module.exports = router;
