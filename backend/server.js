// Minor change to trigger redeploy
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
const mercadoPagoPreferenceRoutes = require('./routes/mercadoPagoPreference');
const orderRoutes = require('./routes/orders');
const shippingRoutes = require('./routes/shipping');
const { getShippingCost } = require('./utils/shippingCosts');
const verifyEmail = require('./emailValidator');
const sendEmail = require('./utils/sendEmail');

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  throw new Error('MP_ACCESS_TOKEN no configurado');
}
if (ACCESS_TOKEN.startsWith('TEST-')) {
  console.warn(
    '⚠️ Advertencia: usando access_token de prueba de Mercado Pago'
  );
}

const MP_PROD_ACCESS_TOKEN =
  'APP_USR-6696027157843761-080316-77b4090779b15dbbbefe44f660e7eae5-462376008';

const PUBLIC_URL =
  process.env.PUBLIC_URL || 'https://ecommerce-3-0.onrender.com';

const app = express();
app.enable('trust proxy');
app.disable('x-powered-by');
app.use(helmet());
const allowedOrigins = ['https://nerinparts.com.ar'];
if (PUBLIC_URL) allowedOrigins.push(PUBLIC_URL);
app.use(
  cors({
    origin: allowedOrigins,
  })
);
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
  res.redirect(`/confirmacion/${preference_id}`);
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

app.get('/confirmacion/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/confirmacion.html'));
});

app.post('/create_preference', async (_req, res) => {
  const body = {
    items: [
      {
        title: 'Pantalla Samsung Service Pack',
        unit_price: 15000,
        currency_id: 'ARS',
        quantity: 1,
      },
    ],
    back_urls: {
      success: 'https://nerinparts.com.ar/success',
      failure: 'https://nerinparts.com.ar/failure',
      pending: 'https://nerinparts.com.ar/pending',
    },
    auto_return: 'approved',
  };

  try {
    if (MP_PROD_ACCESS_TOKEN.startsWith('TEST-')) {
      console.warn(
        '⚠️ Advertencia: usando access_token de prueba de Mercado Pago'
      );
    }
    const client = new MercadoPagoConfig({ accessToken: MP_PROD_ACCESS_TOKEN });
    const preference = new Preference(client);
    console.log('📦 preference.body:', body);
    const response = await preference.create({ body });
    console.log('📝 response.body:', response.body);
    console.log('🔗 response.body.init_point:', response?.body?.init_point);
    const result = response.body || response;
    if (!result.init_point || !result.init_point.includes('mercadopago')) {
      console.error(
        'Preferencia inválida: init_point no generado correctamente.'
      );
      return res.status(500).json({
        error: 'Preferencia inválida: init_point no generado correctamente.',
      });
    }
    return res.json({ init_point: result.init_point });
  } catch (error) {
    console.error('Error al crear preferencia', error);
    return res
      .status(500)
      .json({ error: 'No se pudo generar el link de pago' });
  }
});

app.get('/api/validate-email', async (req, res) => {
  const email = req.query.email || '';
  try {
    const valid = await verifyEmail(String(email).trim());
    res.json({ valid: !!valid });
  } catch (e) {
    logger.error(`Error validar email: ${e.message}`);
    res.status(500).json({ error: 'Error al validar' });
  }
});

app.post('/crear-preferencia', async (req, res) => {
  logger.info(`Crear preferencia body: ${JSON.stringify(req.body)}`);
  logger.debug(`crear-preferencia req.body ${JSON.stringify(req.body)}`);
  const { titulo, precio, cantidad, usuario, datos, envio } = req.body;

  if (datos && datos.email) {
    try {
      const valid = await verifyEmail(String(datos.email).trim());
      if (!valid) {
        return res
          .status(400)
          .json({ error: 'El email ingresado no es válido' });
      }
    } catch (e) {
      logger.error(`Error al verificar email: ${e.message}`);
      return res.status(500).json({ error: 'Error al verificar email' });
    }
  }
  const numeroOrden = generarNumeroOrden();
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
    external_reference: numeroOrden,
  };

  try {
    const client = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
    const preferenceClient = new Preference(client);
    console.log('📦 preference.body:', body);
    const response = await preferenceClient.create({ body });
    console.log('📝 response.body:', response.body);
    console.log('🔗 response.body.init_point:', response?.body?.init_point);
    const result = response.body || response;
    if (!result.init_point || !result.init_point.includes('mercadopago')) {
      console.error(
        'Preferencia inválida: init_point no generado correctamente.'
      );
      return res.status(500).json({
        error: 'Preferencia inválida: init_point no generado correctamente.',
      });
    }
    logger.debug(`Preferencia creada: ${JSON.stringify(result, null, 2)}`);
    logger.info('Preferencia creada');

    logger.info('Guardando pedido en DB');
    const costoEnvio = getShippingCost(envio && envio.provincia);
    await db.query(
      'INSERT INTO orders (order_number, preference_id, payment_status, product_title, unit_price, quantity, user_email, first_name, last_name, phone, shipping_province, shipping_city, shipping_address, shipping_zip, shipping_method, shipping_cost, total_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
      [
        numeroOrden,
        result.id,
        'pending',
        titulo,
        precio,
        cantidad,
        (datos && datos.email) || usuario || null,
        datos && datos.nombre ? datos.nombre : null,
        datos && datos.apellido ? datos.apellido : null,
        datos && datos.telefono ? datos.telefono : null,
        envio && envio.provincia ? envio.provincia : null,
        envio && envio.localidad ? envio.localidad : null,
        envio && envio.direccion ? envio.direccion : null,
        envio && envio.cp ? envio.cp : null,
        envio && envio.metodo ? envio.metodo : null,
        costoEnvio,
        Number(precio) * Number(cantidad) + costoEnvio,
      ]
    );

    const url = result.init_point;
    if (!url) {
      throw new Error('No se generó init_point');
    }
    console.log('✅ MP init_point:', url);

    res.json({ id: result.id, init_point: url, numeroOrden });
  } catch (error) {
    logger.error(`Error al crear preferencia: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

app.post('/orden-manual', async (req, res) => {
  logger.info(`Orden manual body: ${JSON.stringify(req.body)}`);
  logger.debug(`orden-manual req.body ${JSON.stringify(req.body)}`);
  const { titulo, precio, cantidad, datos, envio, metodo } = req.body;
  if (datos && datos.email) {
    try {
      const valid = await verifyEmail(String(datos.email).trim());
      if (!valid) {
        return res.status(400).json({ error: 'El email ingresado no es válido' });
      }
    } catch (e) {
      logger.error(`Error al verificar email: ${e.message}`);
      return res.status(500).json({ error: 'Error al verificar email' });
    }
  }
  const numeroOrden = generarNumeroOrden();
  const costoEnvio = getShippingCost(envio && envio.provincia);
  const status = metodo === 'transferencia' ? 'pendiente_transferencia' : 'pendiente_pago_local';
  try {
    await db.query(
      'INSERT INTO orders (order_number, preference_id, payment_status, product_title, unit_price, quantity, user_email, first_name, last_name, phone, shipping_province, shipping_city, shipping_address, shipping_zip, shipping_method, shipping_cost, total_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
      [
        numeroOrden,
        numeroOrden,
        status,
        titulo,
        precio,
        cantidad,
        datos && datos.email ? datos.email : null,
        datos && datos.nombre ? datos.nombre : null,
        datos && datos.apellido ? datos.apellido : null,
        datos && datos.telefono ? datos.telefono : null,
        envio && envio.provincia ? envio.provincia : null,
        envio && envio.localidad ? envio.localidad : null,
        envio && envio.direccion ? envio.direccion : null,
        envio && envio.cp ? envio.cp : null,
        envio && envio.metodo ? envio.metodo : null,
        costoEnvio,
        Number(precio) * Number(cantidad) + costoEnvio,
      ]
    );
    await sendEmail(
      datos.email,
      'Pedido recibido',
      'Tu pedido fue registrado. Está pendiente de pago. Una vez confirmado, recibirás el aviso de preparación/envío.'
    );
    res.json({ numeroOrden });
  } catch (error) {
    logger.error(`Error al crear orden manual: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

app.use('/api/webhooks/mp', webhookRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api', shippingRoutes);
app.use('/api/mercado-pago', mercadoPagoPreferenceRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Servidor corriendo en http://localhost:${PORT}`);
});
