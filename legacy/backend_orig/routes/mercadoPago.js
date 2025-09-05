const express = require('express');
const router = express.Router();
const db = require('../db');
//co/st verifySignature = require('../middleware/verifySignature');
const validateWebhook = require('../middleware/validateWebhook');
const webhookRateLimit = require('../middleware/webhookRateLimit');
const enforcePostJson = require('../middleware/enforcePostJson');
const requireHttps = require('../middleware/requireHttps');
const logger = require('../logger');
const { MercadoPagoConfig, Payment, MerchantOrder } = require('mercadopago');
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const mpClient = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
const paymentClient = new Payment(mpClient);
const merchantClient = new MerchantOrder(mpClient);

router.post('/test', (req, res) => {
  console.log('📥 mp-webhook test:', req.body);
  logger.info(`mp-webhook test: ${JSON.stringify(req.body)}`);
  res.sendStatus(200);
});

function mapStatus(mpStatus) {
  switch (mpStatus) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
    case 'refunded':
    case 'charged_back':
      return 'cancelled';
    default:
      return 'pending';
  }
}

async function processNotification(topic, id) {
  try {
    let paymentId = null;
    let merchantOrder;
    let preferenceId = null;
    let externalRef = null;
    let status = 'pending';

    if (topic && topic.startsWith('merchant_order')) {
      merchantOrder = await merchantClient.get({ id });
      const payments = merchantOrder.payments || [];
      preferenceId = merchantOrder.preference_id || null;
      externalRef = merchantOrder.external_reference || null;
      if (!payments.length) {
        const identifier = preferenceId || externalRef;
        if (identifier) {
          const whereField = preferenceId ? 'preference_id' : 'order_number';
          const existing = await db.query(
            `SELECT id FROM orders WHERE ${whereField} = $1`,
            [identifier]
          );
          if (existing.rowCount > 0) {
            await db.query(
              `UPDATE orders SET payment_status = $1 WHERE ${whereField} = $2`,
              ['pending', identifier]
            );
          } else {
            await db.query(
              `INSERT INTO orders (${whereField}, payment_status) VALUES ($1,$2)`,
              [identifier, 'pending']
            );
          }
        }
        logger.info(
          `mp-webhook OK paymentId=null externalRef=${externalRef} prefId=${preferenceId} status=pending`
        );
        return;
      }
      paymentId = payments[0].id;
    } else {
      paymentId = id;
    }

    const payment = await paymentClient.get({ id: paymentId });
    status = mapStatus(payment.status);
    externalRef = payment.external_reference || externalRef;

    if (payment.order && payment.order.id) {
      merchantOrder = await merchantClient.get({ id: payment.order.id });
      preferenceId = merchantOrder.preference_id || preferenceId;
      externalRef = externalRef || merchantOrder.external_reference || null;
    }

    const identifier = preferenceId || externalRef;
    if (!identifier) {
      logger.error('No se pudieron determinar identificadores del pago');
      return;
    }
    const whereField = preferenceId ? 'preference_id' : 'order_number';
    const existing = await db.query(
      `SELECT id FROM orders WHERE ${whereField} = $1`,
      [identifier]
    );

    if (existing.rowCount > 0) {
      await db.query(
        `UPDATE orders SET payment_status = $1, payment_id = $2 WHERE ${whereField} = $3`,
        [status, String(paymentId), identifier]
      );
    } else {
      const item = merchantOrder?.items?.[0] || {};
      const payer = payment.payer || {};
      const shipment = merchantOrder?.shipments?.[0] || {};
      const address = shipment.receiver_address || {};
      const shippingOption = shipment.shipping_option || {};
      const shippingCost = shippingOption.cost || shipment.shipping_cost || 0;
      const shippingMethod =
        shippingOption.name || shipment.shipping_mode || null;
      const totalAmount =
        merchantOrder?.total_amount ||
        (payment.transaction_amount + shippingCost);

      await db.query(
        'INSERT INTO orders (order_number, preference_id, payment_status, payment_id, product_title, unit_price, quantity, user_email, first_name, last_name, phone, shipping_province, shipping_city, shipping_address, shipping_zip, shipping_method, shipping_cost, total_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          externalRef,
          preferenceId,
          status,
          String(paymentId),
          item.title || null,
          item.unit_price || null,
          item.quantity || null,
          payer.email || null,
          payer.first_name || null,
          payer.last_name || null,
          (payer.phone && payer.phone.number) || null,
          address.state_name || null,
          address.city_name || null,
          address.street_name || null,
          address.zip_code || null,
          shippingMethod,
          shippingCost,
          totalAmount,
        ]
      );
    }

    logger.info(
      `mp-webhook OK paymentId=${paymentId} externalRef=${externalRef} prefId=${preferenceId} status=${status}`
    );
  } catch (error) {
    logger.error(`Error al procesar webhook: ${error.message}`);
  }
}

router.post(
  '/',
  requireHttps,
  webhookRateLimit,
  enforcePostJson,

  validateWebhook,
  (req, res) => {
    const topic = req.query.topic || req.body.topic || req.body.type;
    const resource = req.query.resource || req.body.resource;
    const id =
      req.query.id ||
      req.body.payment_id ||
      (req.body.data && req.body.data.id) ||
      req.body.id ||
      (resource && String(resource).split('/').pop());

    console.log('📥 mp-webhook recibido:', { topic, id });
    logger.info(`mp-webhook recibido: ${JSON.stringify({ topic, id })}`);

    res.sendStatus(200);

    if (!id) {
      logger.warn('id requerido');
      return;
    }

    processNotification(topic, id);
  }
);

module.exports = router;
module.exports.mapStatus = mapStatus;
