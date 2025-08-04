const express = require('express');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const generarNumeroOrden = require('../utils/generarNumeroOrden');
const logger = require('../logger');

const router = express.Router();

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://ecommerce-3-0.onrender.com';

router.post('/crear-preferencia', async (req, res) => {
  const { carrito, usuario } = req.body || {};
  logger.info(`📥 body recibido: ${JSON.stringify(req.body)}`);

  if (!Array.isArray(carrito) || carrito.length === 0) {
    return res
      .status(400)
      .json({ error: 'carrito debe ser un array con al menos un item' });
  }

  if (!usuario || !usuario.email) {
    return res.status(400).json({ error: 'email requerido' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(usuario.email)) {
    return res.status(400).json({ error: 'email inválido' });
  }

  const items = carrito.map(({ titulo, precio, cantidad }) => ({
    title: titulo,
    unit_price: Number(precio),
    quantity: Number(cantidad),
  }));

  const numeroOrden = generarNumeroOrden();

  const body = {
    items,
    payer: { email: usuario.email },
    external_reference: numeroOrden,
    notification_url: `${PUBLIC_URL}/api/webhooks/mp`,
    back_urls: {
      success: `${PUBLIC_URL}/success`,
      failure: `${PUBLIC_URL}/failure`,
      pending: `${PUBLIC_URL}/pending`,
    },
    auto_return: 'approved',
  };

  try {
    const client = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
    const preference = new Preference(client);
    logger.info(`📦 preference.body: ${JSON.stringify(body)}`);
    const response = await preference.create({ body });
    logger.info(`📝 response.body: ${JSON.stringify(response.body)}`);

    const init_point = response && response.body && response.body.init_point;
    if (init_point) {
      return res.json({ init_point });
    }
    return res.status(500).json({ error: 'init_point no recibido' });
  } catch (error) {
    logger.error(`Error al crear preferencia: ${error.message}`);
    return res.status(500).json({ error: 'Error al crear preferencia' });
  }
});

module.exports = router;
