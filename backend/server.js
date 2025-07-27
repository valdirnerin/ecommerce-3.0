// Backend sencillo para generar preferencias de Mercado Pago
const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference } = require('mercadopago');

require('dotenv').config();

// Configuramos la SDK con la credencial del entorno
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
console.log('Access Token:', ACCESS_TOKEN);
if (!ACCESS_TOKEN) {
  throw new Error('MP_ACCESS_TOKEN no configurado');
}

const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
const client = new MercadoPagoConfig({
  accessToken: ACCESS_TOKEN,
});
const preferenceClient = new Preference(client);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/success', (_req, res) => {
  res.send('Pago completado');
});

app.get('/failure', (_req, res) => {
  res.send('Pago rechazado');
});

app.get('/pending', (_req, res) => {
  res.send('Pago pendiente');
});

// POST /crear-preferencia
// Recibe titulo, precio y cantidad y genera una preferencia
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
    back_urls: {
      success: `${PUBLIC_URL}/success`,
      failure: `${PUBLIC_URL}/failure`,
      pending: `${PUBLIC_URL}/pending`,
    },
    auto_return: 'approved',
  };

  try {
    const result = await preferenceClient.create({ body });
    // Mostramos el link en consola para pruebas manuales
    console.log('Preferencia creada:', result.init_point);
    res.json({ id: result.id, init_point: result.init_point });
  } catch (error) {
    console.error('Error al crear preferencia:', error);
    res.status(500).json({ error: 'No se pudo crear la preferencia' });
  }
});

// Usamos el puerto 3000 por defecto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

