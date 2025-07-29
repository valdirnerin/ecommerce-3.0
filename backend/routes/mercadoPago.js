const express = require('express');
const router = express.Router();
const db = require('../db');
const verifySignature = require('../middleware/verifySignature');
const { MercadoPagoConfig, Payment, MerchantOrder } = require('mercadopago');
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const mpClient = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
const paymentClient = new Payment(mpClient);
const merchantClient = new MerchantOrder(mpClient);

router.post('/webhook', verifySignature, async (req, res) => {
  console.log('Webhook recibida:', req.body);
  const paymentId =
    req.body.payment_id ||
    (req.body.data && req.body.data.id) ||
    req.body.id;
  if (!paymentId) {
    return res.status(400).json({ error: 'payment_id requerido' });
  }

  try {
    const payment = await paymentClient.get({ id: paymentId });
    console.log('Datos de pago:', payment);
    const status = payment.status;
    const statusMap = {
      approved: 'aprobado',
      rejected: 'rechazado',
      pending: 'pendiente',
      in_process: 'pendiente',
    };
    const mappedStatus = statusMap[status] || status;

    let preferenceId = payment.external_reference;
    if (!preferenceId && payment.order && payment.order.id) {
      const orderInfo = await merchantClient.get({ id: payment.order.id });
      preferenceId = orderInfo.preference_id;
    }

    if (!preferenceId) {
      console.error('No se pudo determinar preference_id para el pago');
      return res.status(400).json({ error: 'preference_id no encontrado' });
    }

    console.log('Actualizando pedido', preferenceId, 'con estado', mappedStatus);
    await db.query(
      'UPDATE orders SET payment_status = $1, payment_id = $2 WHERE preference_id = $3',
      [mappedStatus, String(paymentId), preferenceId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error al procesar webhook:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
