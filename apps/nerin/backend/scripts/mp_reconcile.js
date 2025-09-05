#!/usr/bin/env node
require('dotenv').config();
const { processNotification } = require('../routes/mercadoPago');
const ordersRepo = require('../data/ordersRepo');
const fetchFn =
  globalThis.fetch ||
  ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));

async function reconcileRecent(hours = 24) {
  const orders = await ordersRepo.getAll();
  const cutoff = Date.now() - hours * 3600 * 1000;
  for (const o of orders) {
    const created = new Date(o.created_at || o.fecha || 0).getTime();
    if (created && created < cutoff) continue;
    const status = String(o.payment_status || o.estado_pago || '').toLowerCase();
    if (['aprobado', 'rechazado'].includes(status)) continue;
    const id = o.payment_id || o.preference_id || o.external_reference;
    if (!id) continue;
    const topic = o.payment_id ? 'payment' : 'merchant_order';
    try {
      await processNotification(topic, id);
      console.log('reconciled', topic, id);
    } catch (e) {
      console.error('reconcile failed', topic, id, e.message);
    }
  }
}

async function reconcileOne(opts) {
  const { payment, order } = opts;
  if (!payment && !order) {
    console.error('Usage: mp:reconcile -- --payment <id>|--order <external_ref>');
    process.exit(1);
  }
  try {
    if (payment) {
      await processNotification('payment', payment);
    } else {
      let moId = order;
      if (!/^\d+$/.test(String(order))) {
        const res = await fetchFn(
          `https://api.mercadopago.com/merchant_orders/search?external_reference=${encodeURIComponent(
            order,
          )}`,
          { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN || ''}` } },
        );
        const data = await res.json();
        moId = data?.elements?.[0]?.id;
        if (!moId) throw new Error('order not found');
      }
      await processNotification('merchant_order', moId);
    }
    console.log('reconciled');
  } catch (e) {
    console.error('reconcile failed', e.message);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let payment = null;
  let order = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--payment' || a === '-p') && args[i + 1]) {
      payment = args[++i];
    } else if ((a === '--order' || a === '-o') && args[i + 1]) {
      order = args[++i];
    }
  }
  if (payment || order) await reconcileOne({ payment, order });
  else await reconcileRecent();
}

main();
