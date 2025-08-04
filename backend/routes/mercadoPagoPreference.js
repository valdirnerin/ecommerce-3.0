const express = require('express');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const router = express.Router();

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://ecommerce-3-0.onrender.com';

router.post('/crear-preferencia', async (req, res) => {
  const { carrito, usuario } = req.body || {};
  console.log('📥 body recibido:', req.body);

  try {
    if (!Array.isArray(carrito)) {
      return res.status(400).json({ error: 'carrito debe ser un array' });
    }

    const items = carrito.map(({ titulo, precio, cantidad }) => ({
      title: titulo,
      unit_price: Number(precio),
      quantity: Number(cantidad),
    }));

    const body = {
      items,
      payer: { email: usuario && usuario.email },
      back_urls: {
        success: `${PUBLIC_URL}/success`,
        failure: `${PUBLIC_URL}/failure`,
        pending: `${PUBLIC_URL}/pending`,
      },
      auto_return: 'approved',
    };

    const client = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
    const preference = new Preference(client);
    console.log('📦 preference.body:', body);
    const response = await preference.create({ body });
    console.log('📝 response.body:', response.body);

    const init_point = response && response.body && response.body.init_point;
    if (init_point) {
      return res.json({ init_point });
    }
    return res.status(500).json({ error: 'init_point no recibido' });
  } catch (error) {
    console.error('Error al crear preferencia:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
