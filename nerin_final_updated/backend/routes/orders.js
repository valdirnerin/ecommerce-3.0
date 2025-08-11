const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../logger');

router.get('/', async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    logger.error(`Error al obtener pedidos: ${error.message}`);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/pending', async (_req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM orders WHERE payment_status = 'pendiente_transferencia' OR payment_status = 'pendiente_pago_local' ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (error) {
    logger.error(`Error al obtener pedidos pendientes: ${error.message}`);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/:id/status', async (req, res) => {
  try {
    let { rows } = await db.query(
      'SELECT payment_status, order_number FROM orders WHERE preference_id = $1',
      [req.params.id]
    );
    if (rows.length === 0) {
      rows = (
        await db.query(
          'SELECT payment_status, order_number FROM orders WHERE order_number = $1',
          [req.params.id]
        )
      ).rows;
    }
    if (rows.length === 0) {
      logger.info(`/api/orders/${req.params.id}/status -> pending`);
      return res.json({ status: 'pending', numeroOrden: null });
    }
    const status = rows[0].payment_status || 'pending';
    logger.info(`/api/orders/${req.params.id}/status -> ${status}`);
    res.json({ status, numeroOrden: rows[0].order_number });
  } catch (error) {
    logger.error(`Error al obtener estado del pedido: ${error.message}`);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.post('/:orderNumber/mark-paid', async (req, res) => {
  try {
    const { rows } = await db.query(
      'UPDATE orders SET payment_status = $1 WHERE order_number = $2 RETURNING user_email',
      ['pagado', req.params.orderNumber]
    );
    if (rows.length > 0) {
      const email = rows[0].user_email;
      if (email) {
        const sendEmail = require('../utils/sendEmail');
        await sendEmail(email, 'Pago confirmado', 'Tu pago fue confirmado y tu pedido está en preparación.');
      }
    }
    res.json({ success: true });
  } catch (error) {
    logger.error(`Error al actualizar pedido: ${error.message}`);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
