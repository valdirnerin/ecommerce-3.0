const express = require('express');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const generarNumeroOrden = require('../utils/generarNumeroOrden');
const logger = require('../logger');
const db = require('../db');

const router = express.Router();

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL || '';

router.post('/crear-preferencia', async (req, res) => {
  logger.info(`➡️ ${req.method} ${req.originalUrl}`);
  const { carrito, usuario } = req.body || {};
  logger.info(`📥 body recibido: ${JSON.stringify(req.body)}`);

  if (!usuario || !usuario.email) {
    const payload = { error: 'email requerido' };
    logger.info(`⬅️ 400 ${JSON.stringify(payload)}`);
    return res.status(400).json(payload);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(usuario.email)) {
    const payload = { error: 'email inválido' };
    logger.info(`⬅️ 400 ${JSON.stringify(payload)}`);
    return res.status(400).json(payload);
  }

  const hasValidItems =
    Array.isArray(carrito) &&
    carrito.length > 0 &&
    carrito.every((i) => {
      return (
        i &&
        typeof i.titulo === 'string' &&
        i.titulo.trim() !== '' &&
        !isNaN(Number(i.precio)) &&
        Number(i.precio) > 0 &&
        Number.isInteger(Number(i.cantidad)) &&
        Number(i.cantidad) > 0 &&
        (typeof i.currency_id === 'undefined' || typeof i.currency_id === 'string')
      );
    });

  if (!hasValidItems) {
    const payload = {
      error:
        'Faltan datos en los ítems del carrito. Verificá que todos los productos tengan título, precio y cantidad.',
    };
    logger.info(`⬅️ 400 ${JSON.stringify(payload)}`);
    return res.status(400).json(payload);
  }

  const items = carrito.map(({ titulo, precio, cantidad, currency_id }) => ({
    title: String(titulo),
    unit_price: Number(precio),
    quantity: Number(cantidad),
    currency_id: currency_id || 'ARS',
  }));

  const numeroOrden = generarNumeroOrden();

  const body = {
    items,
    payer: { email: usuario.email },
    external_reference: String(numeroOrden),
    notification_url: `${PUBLIC_URL}/api/mercado-pago/webhook`,
    back_urls: {
      success: `${PUBLIC_URL}/estado-pedido`,
      failure: `${PUBLIC_URL}/estado-pedido`,
      pending: `${PUBLIC_URL}/estado-pedido`,
    },
    auto_return: 'approved',
  };

  try {
    const client = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
    const preference = new Preference(client);
    logger.info(`📦 preference.body: ${JSON.stringify(body)}`);
    const response = await preference.create({ body });
    const prefId = response?.body?.id || response?.id || response?.preference_id;
    if (prefId) {
      await db.query('UPDATE orders SET preference_id = $1 WHERE order_number = $2', [String(prefId), String(numeroOrden)]);
    }
    console.info('mp-preference', { numeroOrden, prefId });
    const { id, init_point } = response.body || {};
    if (init_point) {
      const payload = { id, init_point };
      logger.info(`⬅️ 200 ${JSON.stringify(payload)}`);
      return res.json(payload);
    }
    const payload = { error: 'init_point no recibido' };
    logger.info(`⬅️ 500 ${JSON.stringify(payload)}`);
    return res.status(500).json(payload);
  } catch (error) {
    logger.error(`Error al crear preferencia: ${error.message}`);
    const payload = { error: 'Error al crear preferencia' };
    logger.info(`⬅️ 500 ${JSON.stringify(payload)}`);
    return res.status(500).json(payload);
  }
});

module.exports = router;
