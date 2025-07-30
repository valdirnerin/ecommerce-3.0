const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener pedidos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/:id/status', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT payment_status, order_number FROM orders WHERE preference_id = $1',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    res.json({ status: rows[0].payment_status, numeroOrden: rows[0].order_number });
  } catch (error) {
    console.error('Error al obtener estado del pedido:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
