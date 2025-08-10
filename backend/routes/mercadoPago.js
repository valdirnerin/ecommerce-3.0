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

router.post(
  '/',
  requireHttps,
  webhookRateLimit,
  enforcePostJson,
  
  validateWebhook,
  async (req, res) => {
    console.log('📥 Webhook recibido:', req.body);
    logger.info('Webhook recibido');
    const paymentId =
      req.body.payment_id ||
      (req.body.data && req.body.data.id) ||
      req.body.id;
    if (!paymentId) {
      return res.status(400).json({ error: 'payment_id requerido' });
    }

  try {
    const payment = await paymentClient.get({ id: paymentId });
    const status = payment.status;
    const orderNumber = payment.external_reference;

    let merchantOrder;
    if (payment.order && payment.order.id) {
      merchantOrder = await merchantClient.get({ id: payment.order.id });
    }

    const preferenceId = merchantOrder?.preference_id;

    if (!preferenceId && !orderNumber) {
      logger.error('No se pudieron determinar identificadores del pago');
      return res
        .status(400)
        .json({ error: 'Identificador de orden no encontrado' });
    }
    const identifier = preferenceId || orderNumber;
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
      const item =
        (merchantOrder && merchantOrder.items && merchantOrder.items[0]) || {};
      const payer = payment.payer || {};
      const shipment =
        (merchantOrder && merchantOrder.shipments && merchantOrder.shipments[0]) || {};
      const address = shipment.receiver_address || {};
      const shippingOption = shipment.shipping_option || {};
      const shippingCost = shippingOption.cost || shipment.shipping_cost || 0;
      const shippingMethod =
        shippingOption.name || shipment.shipping_mode || null;
      const totalAmount =
        (merchantOrder && merchantOrder.total_amount) ||
        (payment.transaction_amount + shippingCost);

      await db.query(
        'INSERT INTO orders (order_number, preference_id, payment_status, payment_id, product_title, unit_price, quantity, user_email, first_name, last_name, phone, shipping_province, shipping_city, shipping_address, shipping_zip, shipping_method, shipping_cost, total_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          orderNumber,
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
      `Pedido ${(orderNumber || preferenceId)} actualizado con estado ${status} y payment_id ${paymentId}`
    );

    res.sendStatus(200);
  } catch (error) {
    logger.error(`Error al procesar webhook: ${error.message}`);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
