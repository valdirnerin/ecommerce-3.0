const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { MercadoPagoConfig, Preference } = require('mercadopago');
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
app.use(cors());
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
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
  const { titulo, precio, cantidad } = req.body;
  const body = {
    items: [
      {
        title: titulo,
        unit_price: Number(precio),
        quantity: Number(cantidad),
      },
    ],
    notification_url: `${PUBLIC_URL}/api/mercado-pago/webhook`,
    back_urls: {
      success: `${PUBLIC_URL}/success`,
      failure: `${PUBLIC_URL}/failure`,
      pending: `${PUBLIC_URL}/pending`,
    },
    auto_return: 'approved',
  };

  try {
    const result = await preferenceClient.create({ body });
    console.log('Preferencia creada:', result.init_point);

    await db.query(
      'INSERT INTO orders (preference_id, payment_status, product_title, unit_price, quantity) VALUES ($1, $2, $3, $4, $5)',
      [result.id, 'pendiente', titulo, precio, cantidad]
    );
    console.log('Pedido guardado con ID de preferencia', result.id);

    res.json({ id: result.id, init_point: result.init_point });
  } catch (error) {
    console.error('Error al crear preferencia:', error);
    res.status(500).json({ error: 'No se pudo crear la preferencia' });
  }
});

app.use('/api/mercado-pago', webhookRoutes);
app.use('/api/orders', orderRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
