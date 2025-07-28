const express = require('express');
const router = express.Router();
const db = require('../db');
const verifySignature = require('../middleware/verifySignature');

router.post('/webhook', verifySignature, async (req, res) => {
  const paymentId =
    req.body.payment_id ||
    (req.body.data && req.body.data.id) ||
    req.body.id;
  if (!paymentId) {
    return res.status(400).json({ error: 'payment_id requerido' });
  }

  try {
    await db.query(
      'UPDATE orders SET payment_status = $1 WHERE payment_id = $2',
      ['aprobado', String(paymentId)]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error al procesar webhook:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
