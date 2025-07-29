const express = require('express');
const router = express.Router();
const db = require('../db');
const verifySignature = require('../middleware/verifySignature');
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
  '/webhook',
  requireHttps,
  webhookRateLimit,
  enforcePostJson,
  verifySignature,
  validateWebhook,
  async (req, res) => {
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

    let preferenceId = payment.external_reference;
    if (!preferenceId && payment.order && payment.order.id) {
      const orderInfo = await merchantClient.get({ id: payment.order.id });
      preferenceId = orderInfo.preference_id;
    }

    if (!preferenceId) {
      logger.error('No se pudo determinar preference_id para el pago');
      return res.status(400).json({ error: 'preference_id no encontrado' });
    }

    await db.query(
      'UPDATE orders SET payment_status = $1, payment_id = $2 WHERE preference_id = $3',
      [status, String(paymentId), preferenceId]
    );
    logger.info(
      `Pedido ${preferenceId} actualizado con estado ${status} y payment_id ${paymentId}`
    );

    res.json({ success: true });
  } catch (error) {
    logger.error(`Error al procesar webhook: ${error.message}`);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
