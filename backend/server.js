const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const db = require('./db');
const generarNumeroOrden = require('./utils/generarNumeroOrden');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const logger = require('./logger');
require('dotenv').config();

const webhookRoutes = require('./routes/mercadoPago');
const orderRoutes = require('./routes/orders');

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  throw new Error('MP_ACCESS_TOKEN no configurado');
}

const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
const client = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
const preferenceClient = new Preference(client);

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors());
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
    limit: '100kb',
  })
);

app.get('/success', (req, res) => {
  const { preference_id } = req.query;
  res.redirect(`/estado-pedido/${preference_id}`);
});
app.get('/failure', (req, res) => {
  const { preference_id } = req.query;
  res.redirect(`/estado-pedido/${preference_id}`);
});
app.get('/pending', (req, res) => {
  const { preference_id } = req.query;
  res.redirect(`/estado-pedido/${preference_id}`);
});

app.get('/estado-pedido/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/estado-pedido.html'));
});

app.post('/crear-preferencia', async (req, res) => {
  const { titulo, precio, cantidad, usuario } = req.body;
  const body = {
    items: [
      {
        title: titulo,
        unit_price: Number(precio),
        quantity: Number(cantidad),
      },
    ],
    back_urls: {
      success: `${PUBLIC_URL}/success`,
      failure: `${PUBLIC_URL}/failure`,
      pending: `${PUBLIC_URL}/pending`,
    },
    auto_return: 'approved',
    notification_url:
      'https://ecommerce-3-0.onrender.com/api/mercado-pago/webhook',
  };

  try {
    const result = await preferenceClient.create({ body });
    logger.info('Preferencia creada');

    const numeroOrden = generarNumeroOrden();
    logger.info('Guardando pedido en DB');
    await db.query(
      'INSERT INTO orders (order_number, preference_id, payment_status, product_title, unit_price, quantity, user_email, total_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        numeroOrden,
        result.id,
        'pending',
        titulo,
        precio,
        cantidad,
        usuario || null,
        Number(precio) * Number(cantidad),
      ]
    );

    res.json({ id: result.id, init_point: result.init_point, numeroOrden });
  } catch (error) {
    logger.error(`Error al crear preferencia: ${error.message}`);
    res.status(500).json({ error: 'No se pudo crear la preferencia' });
  }
});

app.use('/api/mercado-pago', webhookRoutes);
app.use('/api/orders', orderRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Servidor corriendo en http://localhost:${PORT}`);
});
