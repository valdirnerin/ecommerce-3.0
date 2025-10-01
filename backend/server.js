const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');
const db = require('./db');
const generarNumeroOrden = require('./utils/generarNumeroOrden');
const logger = require('./logger');
require('dotenv').config();

const webhookRoutes = require('./routes/mercadoPago');
const mercadoPagoPreferenceRoutes = require('./routes/mercadoPagoPreference');
const orderRoutes = require('./routes/orders');
const shippingRoutes = require('./routes/shipping');
const productRoutes = require('./routes/products');
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

const PUBLIC_URL =
  process.env.PUBLIC_URL || 'http://localhost:3000';

const BUILD_ID = (() => {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  const ENV_KEYS = [
    'SOURCE_VERSION',
    'VERCEL_GIT_COMMIT_SHA',
    'VERCEL_GIT_COMMIT_REF',
    'GIT_COMMIT',
    'COMMIT_SHA',
    'RENDER_GIT_COMMIT',
    'HEROKU_SLUG_COMMIT',
  ];
  for (const key of ENV_KEYS) {
    if (process.env[key]) return process.env[key];
  }
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch (error) {
    return `dev-${new Date().toISOString().slice(0, 10)}`;
  }
})();

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
app.use(express.urlencoded({ extended: false }));
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

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    logger.info(`[API] ${req.method} ${req.path}`);
  }
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'backend', ts: Date.now() });
});

app.get('/api/version', (req, res) => {
  res.json({ build: BUILD_ID });
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
// Specific Mercado Pago routes before generic /api routes
app.use('/api/mercado-pago', mercadoPagoPreferenceRoutes);
app.use('/api', productRoutes);
app.use('/api', shippingRoutes);
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const assetRoots = [
  path.join(__dirname, '../nerin_final_updated/assets'),
  path.join(__dirname, '../assets'),
];

for (const dir of assetRoots) {
  if (fs.existsSync(dir)) {
    app.use('/assets', express.static(dir));
    break;
  }
}

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Servidor corriendo en http://localhost:${PORT}`);
});
