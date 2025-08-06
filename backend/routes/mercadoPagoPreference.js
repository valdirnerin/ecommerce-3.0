const express = require('express');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const generarNumeroOrden = require('../utils/generarNumeroOrden');
const logger = require('../logger');

const router = express.Router();

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  throw new Error('MP_ACCESS_TOKEN no configurado');
}
if (ACCESS_TOKEN.startsWith('TEST-')) {
  logger.warn('⚠️ Advertencia: usando access_token de prueba de Mercado Pago');
}

// Determina la URL pública a utilizar. Si no está configurada la variable de
// entorno PUBLIC_URL (por ejemplo en entornos de producción con dominios
// personalizados), se usa el dominio de la propia petición.
function getPublicUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  return `${req.protocol}://${req.get('host')}`;
}

router.post('/crear-preferencia', async (req, res) => {
  logger.info(`➡️ ${req.method} ${req.originalUrl}`);
  const { carrito: carritoEs, cart, usuario: usuarioEs, customer } =
    req.body || {};
  const carrito = carritoEs || cart;
  const usuario = usuarioEs || customer;
  logger.info(`📥 body recibido: ${JSON.stringify(req.body)}`);

  if (!Array.isArray(carrito) || carrito.length === 0) {
    const payload = {
      error: 'carrito debe ser un array con al menos un item',
    };
    logger.info(`⬅️ 400 ${JSON.stringify(payload)}`);
    return res.status(400).json(payload);
  }

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

  const items = [];
  for (const [index, { titulo, precio, cantidad }] of carrito.entries()) {
    const title = String(titulo || '').trim();
    const unit_price = Number(precio);
    const quantity = Number(cantidad);
    if (!title || isNaN(unit_price) || unit_price <= 0 || isNaN(quantity) || quantity <= 0) {
      const payload = { error: `item inválido en posición ${index}` };
      logger.info(`⬅️ 400 ${JSON.stringify(payload)}`);
      return res.status(400).json(payload);
    }
    items.push({ title, unit_price, quantity, currency_id: 'ARS' });
  }

  const numeroOrden = generarNumeroOrden();

  const PUBLIC_URL = getPublicUrl(req);
  const body = {
    items,
    payer: { email: usuario.email },
    external_reference: numeroOrden,
    notification_url: `${PUBLIC_URL}/api/mercado-pago/webhook`,
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
      const payload = { init_point };
      logger.info(`⬅️ 200 ${JSON.stringify(payload)}`);
      return res.json(payload);
    }
    const payload = { error: 'init_point no recibido' };
    logger.info(`⬅️ 500 ${JSON.stringify(payload)}`);
    return res.status(500).json(payload);
  } catch (error) {
    logger.error(`Error al crear preferencia: ${error.message}`);
    const status = error && error.status && Number(error.status) < 600 ? error.status : 500;
    const payload = { error: error.message || 'Error al crear preferencia' };
    logger.info(`⬅️ ${status} ${JSON.stringify(payload)}`);
    return res.status(status).json(payload);
  }
});

module.exports = router;
