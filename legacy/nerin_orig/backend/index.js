/*
 * Servidor backend básico para el sistema ERP + E‑commerce de NERIN.
 *
 * Este servidor utiliza Express para exponer una API sencilla y servir
 * los archivos estáticos del frontend y de las imágenes. Está pensado
 * como punto de partida y puede ampliarse según las necesidades.
 */

const path = require("path");
const fs = require("fs");
const express = require("express");
// Usar fetch nativo si está disponible; como fallback se importa dinámicamente node-fetch
const fetchFn =
  globalThis.fetch ||
  ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));
const { MercadoPagoConfig, Preference } = require("mercadopago");
const generarNumeroOrden = require("./utils/generarNumeroOrden");
let Resend;
try {
  ({ Resend } = require("resend"));
} catch {
  Resend = null;
}
require("dotenv").config();

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

const ORIGIN = process.env.PUBLIC_URL || '*';
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', ORIGIN);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  const reqHdr = req.headers['access-control-request-headers'];
  res.header('Access-Control-Allow-Headers', reqHdr || 'Accept, Content-Type, Authorization, X-Requested-With');
  // si en el futuro usamos cookies: res.header('Access-Control-Allow-Credentials','true');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
const PORT = process.env.PORT || 3000;

const MP_TOKEN = process.env.MP_ACCESS_TOKEN || "";
const mpClient = MP_TOKEN ? new MercadoPagoConfig({ accessToken: MP_TOKEN }) : null;
const mpPreference = mpClient ? new Preference(mpClient) : null;
const resendApiKey = process.env.RESEND_API_KEY || "";
const resend = Resend && resendApiKey ? new Resend(resendApiKey) : null;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const MP_NOTIFICATION_URL =
  process.env.MP_NOTIFICATION_URL ||
  `${PUBLIC_URL.replace(/\/$/, '')}/api/webhooks/mp`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const API_FORWARD_URL = process.env.API_FORWARD_URL || "";
const db = require("./db");
db.init().catch((e) => console.error("db init", e));
const productsRepo = require("./data/productsRepo");
const ordersRepo = require("./data/ordersRepo");
const { processNotification, processPayment, traceRef } = require("./routes/mercadoPago");
const verifySignature = require("./middleware/verifySignature");
const { mapMpStatus, MP_STATUS_MAP } = require("../frontend/js/mpStatusMap");
const logger = require("./logger");
const dataDir = require("./utils/dataDir");

const ordersFilePath = path.join(dataDir, "orders.json");
logger.info(
  `Startup paths cwd=${process.cwd()} ordersRepo=${require.resolve("./data/ordersRepo")} ordersFile=${ordersFilePath}`
);

let legacy;
try {
  legacy = require.resolve('../../backend/data/ordersRepo');
} catch {}
logger.info('ordersRepo resolved', {
  primary: require.resolve('./data/ordersRepo'),
  legacy,
});
if (legacy && legacy !== require.resolve('./data/ordersRepo')) {
  logger.warn('DUPLICATE ordersRepo detected', {
    primary: require.resolve('./data/ordersRepo'),
    legacy,
  });
}

let autoElevateCount = 0;

// Ruta para servir los archivos del frontend (HTML, CSS, JS)
app.use("/", express.static(path.join(__dirname, "../frontend")));

// Ruta para servir las imágenes de productos y otros activos
app.use("/assets", express.static(path.join(__dirname, "../assets")));

// Rutas de retorno de Mercado Pago
app.get("/success", (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/success.html"));
});
app.get("/failure", (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/failure.html"));
});
app.get("/pending", (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/pending.html"));
});
app.get(["/seguimiento", "/seguimiento-pedido"], (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/seguimiento.html"));
});

app.get("/health/db", async (_req, res) => {
  const pool = db.getPool();
  if (!pool) return res.status(503).json({ ok: false });
  try {
    await db.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

// Leer productos desde el archivo JSON
async function getProducts() {
  return productsRepo.getAll();
}

async function getOrders() {
  return ordersRepo.getAll();
}

async function saveOrders(orders) {
  return ordersRepo.saveAll(orders);
}

function sendOrderPaidEmail(order) {
  if (!resend || !order.cliente || !order.cliente.email) return;
  try {
  const tpl = path.join(__dirname, "../emails/orderPaid.html");
  let html = fs.readFileSync(tpl, "utf8");
  const url = `${PUBLIC_URL}/seguimiento?order=${encodeURIComponent(order.id)}&email=${encodeURIComponent(order.cliente.email || "")}`;
  html = html.replace("{{ORDER_URL}}", url).replace("{{ORDER_ID}}", order.id);
    const to = [order.cliente.email];
    if (ADMIN_EMAIL) to.push(ADMIN_EMAIL);
    resend.emails
      .send({ from: "no-reply@nerin.com", to, subject: "Confirmación de compra", html })
      .catch((e) => console.error("Email error", e));
  } catch (e) {
    console.error("send email failed", e);
  }
}

app.use('/api', (req, res, next) => {
  console.info('API', req.method, req.path, req.headers['content-type'] || '', req.body && Object.keys(req.body));
  next();
});

app.use('/api', async (req, res, next) => {
  if (!API_FORWARD_URL) return next();
  if (
    req.path === '/webhooks/mp' ||
    req.path === '/mercado-pago/webhook' ||
    /^\/orders(\/|$)/.test(req.path)
  )
    return next();
  try {
    const base = API_FORWARD_URL.replace(/\/$/, '');
    const target = base + req.originalUrl.replace(/^\/api/, '');
    const headers = { ...req.headers };
    delete headers.host;
    const opts = { method: req.method, headers };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      opts.body = req.rawBody?.length ? req.rawBody : JSON.stringify(req.body || {});
    }
    const r = await fetchFn(target, opts);
    const body = await r.text();
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);
    res.send(body);
  } catch (e) {
    console.error('API relay error', e);
    res.status(502).json({ error: 'API relay failed' });
  }
});

// API: obtener la lista de productos
app.get("/api/products", async (_req, res) => {
  try {
    const products = await getProducts();
    res.json({ products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudieron cargar los productos" });
  }
});

// API: obtener un producto por ID
app.get("/api/products/:id", async (req, res) => {
  try {
    const products = await getProducts();
    const product = products.find((p) => String(p.id) === String(req.params.id));
    if (!product) return res.status(404).json({ error: "Producto no encontrado" });
    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo cargar el producto" });
  }
});

// Crear un nuevo pedido y generar preferencia de Mercado Pago
app.post("/api/orders", async (req, res) => {
  try {
    const { cliente = {}, productos = [] } = req.body;
    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ error: "Carrito vacío" });
    }
    const id = generarNumeroOrden();
    const total = productos.reduce(
      (t, it) => t + Number(it.price) * Number(it.quantity),
      0,
    );

    let preferenceId = null;
    let initPoint = null;
    if (mpPreference) {
      try {
        const pref = {
          items: productos.map((p) => ({
            title: p.name,
            quantity: Number(p.quantity),
            unit_price: Number(p.price),
            currency_id: "ARS",
          })),
          back_urls: {
            success: `${PUBLIC_URL}/success`,
            failure: `${PUBLIC_URL}/failure`,
            pending: `${PUBLIC_URL}/pending`,
          },
          auto_return: "approved",
          external_reference: id,
          notification_url: MP_NOTIFICATION_URL,
        };
        const prefRes = await mpPreference.create({ body: pref });
        initPoint = prefRes.init_point;
        preferenceId = prefRes.id;
      } catch (e) {
        console.error("MP preference error", e);
      }
    }

    const order = {
      id,
      cliente,
      productos,
      estado_pago: "pendiente",
      estado_envio: "pendiente",
      fecha: new Date().toISOString(),
      total,
      preference_id: preferenceId,
      external_reference: id,
      inventoryApplied: false,
    };
    const orders = await getOrders();
    orders.push(order);
    await saveOrders(orders);

    return res.status(201).json({
      orderId: id,
      init_point: initPoint,
      preferenceId,
      nrn: id,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se pudo crear el pedido" });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const status = (req.query.payment_status || "all").toLowerCase();
    let orders = await getOrders();
    if (["pending", "approved", "rejected"].includes(status)) {
      orders = orders.filter((o) => {
        const ps = String(o.payment_status || o.estado_pago || "pending").toLowerCase();
        return ps === status;
      });
    }
    const rows = orders.map((o) => {
      const cliente = o.cliente || {};
      const direccion = cliente.direccion || {};
      return {
        ...o,
        order_number: o.order_number || o.id || o.external_reference || "",
        created_at: o.fecha || o.date || o.created_at || "",
        cliente,
        productos: o.productos || o.items || [],
        provincia_envio: o.provincia_envio || direccion.provincia || "",
        costo_envio: Number(o.costo_envio || 0),
        total_amount: Number(o.total_amount || o.total || 0),
        payment_status: o.payment_status || o.estado_pago || "pending",
        shipping_status: o.shipping_status || o.estado_envio || "pendiente",
        seguimiento: o.seguimiento || o.tracking || "",
        transportista: o.transportista || o.carrier || "",
      };
    });
    {
      const { ORDERS_FILE } = ordersRepo.getPaths();
      logger.info('admin_orders list', { ORDERS_FILE });
    }
    res.json({ orders: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudieron obtener los pedidos" });
  }
});

app.get('/api/debug/orders/paths', (_req, res) => {
  const paths = ordersRepo.getPaths();
  res.json({ cwd: process.cwd(), repo_file: paths.repo_file, paths });
});

app.get('/api/debug/orders/peek', async (_req, res) => {
  const orders = await ordersRepo.getAll();
  res.json({ count: orders?.length || 0, first: orders[0] || null });
});

async function getOrderStatus(id) {
  const orders = await getOrders();
  const order = orders.find(
    (o) =>
      String(o.id) === id ||
      String(o.external_reference) === id ||
      String(o.order_number) === id ||
      String(o.preference_id) === id,
  );
  if (!order) {
    console.log("status: pending (no row yet)");
    return { status: "pending", numeroOrden: null };
  }
  let raw = order.status || order.estado_pago || order.payment_status || "";
  let mapped = mapMpStatus(raw);
  if (
    mapped === "pendiente" &&
    order.payment_id &&
    order.last_mp_webhook?.status === "approved"
  ) {
    try {
      const info = await processPayment(
        order.payment_id,
        { externalRef: order.external_reference, prefId: order.preference_id },
        { topic: "status-fallback", id: order.payment_id, at: new Date().toISOString() },
      );
      if (info?.status) {
        raw = info.status;
        mapped = info.status;
        if (mapped === "aprobado") {
          autoElevateCount++;
          logger.info("order-status auto-elevated", {
            order: order.id || id,
            payment_id: order.payment_id,
            count: autoElevateCount,
          });
        }
      }
    } catch {}
  }
  let status = "pending";
  if (mapped === "aprobado") status = "approved";
  else if (mapped === "rechazado") status = "rejected";
  traceRef(
    order.external_reference || order.preference_id || order.order_number || id,
    "api_response_to_ui",
    { status: mapped },
  );
  return {
    status,
    numeroOrden: order.id || order.order_number || order.external_reference || null,
  };
}

app.get("/api/orders/test/:id/status", async (req, res) => {
  try {
    const info = await getOrderStatus(req.params.id);
    res.set(
      "Cache-Control",
      info.status === "pending" ? "no-store" : "public, max-age=60",
    );
    res.json(info);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener estado" });
  }
});

app.get("/api/orders/:id/status", async (req, res) => {
  try {
    const info = await getOrderStatus(req.params.id);
    res.set(
      "Cache-Control",
      info.status === "pending" ? "no-store" : "public, max-age=60",
    );
    res.json(info);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener estado" });
  }
});

app.get("/ops/order-status/:id", async (req, res) => {
  const secret = process.env.DIAG_SECRET;
  if (secret && req.query.secret !== secret) return res.sendStatus(403);
  try {
    const orders = await getOrders();
    const id = req.params.id;
    const order = orders.find(
      (o) =>
        String(o.id) === id ||
        String(o.external_reference) === id ||
        String(o.preference_id) === id ||
        String(o.order_number) === id,
    );
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    const db_status = mapMpStatus(
      order.status || order.estado_pago || order.payment_status || "",
    );
    const updated_at = order.updated_at || order.fecha || order.created_at || null;
    const last_webhook = order.last_mp_webhook || null;
    const payment_id = order.payment_id || null;
    const merchant_order_id = order.merchant_order_id || null;
    const preference_id = order.preference_id || null;
    let api_status = null;
    let api_headers = {};
    try {
      const r = await fetchFn(
        `http://127.0.0.1:${PORT}/api/orders/${encodeURIComponent(id)}/status`,
      );
      api_status = (await r.json()).status;
      api_headers = { "cache-control": r.headers.get("cache-control") };
    } catch {}
    res.set("Cache-Control", "no-store");
    res.json({
      db_status,
      updated_at,
      payment_id,
      merchant_order_id,
      preference_id,
      last_webhook,
      api_status,
      api_headers,
      mapping_used: MP_STATUS_MAP,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener estado" });
  }
});

// Obtener pedido por ID
app.get("/api/orders/:id", async (req, res) => {
  const orders = await getOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
  res.json({ order });
});

app.post("/api/webhooks/mp/test", (req, res) => {
  console.log("mp-webhook TEST", req.body);
  res.sendStatus(200);
});

app.post("/api/track-order", async (req, res) => {
  const { email, id } = req.body || {};
  const orders = await getOrders();
  const order = orders.find(
    (o) => o.id === id && (!o.cliente || o.cliente.email === email),
  );
  if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
  res.json({ order });
});

// Webhook de Mercado Pago: procesar localmente
app.post(
  ["/api/mercado-pago/webhook", "/api/webhooks/mp"],
  verifySignature,
  async (req, res) => {
    const isProbe = req.query.probe === '1' || req.headers['x-self-test'] === '1';
    if (!isProbe) {
      // ACK inmediato a MP
      res.sendStatus(200);
      if (!req.validSignature) return;
      try {
        await processNotification(req);
      } catch (e) {
        console.error("mp local process error", e);
      }
      return;
    }

    const result = { handler_200: true, signature_valid: !!req.validSignature };
    if (req.validSignature) {
      try {
        const info = await processNotification(req);
        result.mp_lookup_ok = !!info?.mp_lookup_ok;
        result.final_status = info?.status || null;
        result.stock_delta = info?.stockDelta || 0;
        result.idempotent = info ? !!info.idempotent : true;
      } catch (e) {
        result.mp_lookup_ok = false;
        result.final_status = null;
        result.stock_delta = 0;
        result.idempotent = true;
      }
    } else {
      result.mp_lookup_ok = false;
      result.final_status = null;
      result.stock_delta = 0;
      result.idempotent = true;
    }
    res.json(result);
  },
);

const ADMIN_PROBE_TOKEN = process.env.ADMIN_PROBE_TOKEN || '';
const ENABLE_MP_WEBHOOK_HEALTH = process.env.ENABLE_MP_WEBHOOK_HEALTH === '1';

async function runSelfProbe() {
  const crypto = require('crypto');
  const secret = process.env.MP_WEBHOOK_SECRET || '';
  const bodyObj = { type: 'self-test', id: Date.now() };
  const body = JSON.stringify(bodyObj);
  const sig = secret
    ? crypto.createHmac('sha256', secret).update(body).digest('hex')
    : '';
  const res = await fetchFn(
    `http://127.0.0.1:${PORT}/api/webhooks/mp?probe=1`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sig ? { 'x-signature': sig } : {}),
        'x-self-test': '1',
      },
      body,
    },
  );
  try {
    return await res.json();
  } catch {
    return { handler_200: res.ok };
  }
}

if (ENABLE_MP_WEBHOOK_HEALTH && ADMIN_PROBE_TOKEN) {
  app.get('/ops/health/mp-webhook', async (req, res) => {
    if (req.query.token !== ADMIN_PROBE_TOKEN) return res.status(403).end();
    try {
      const r = await runSelfProbe();
      res.json(r);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

// API: checkout / confirmar pedido
// Este endpoint recibe el contenido del carrito y devuelve un mensaje de éxito.
// En un ERP completo se podría almacenar el pedido en la base de datos,
// generar una factura o iniciar la integración de pago. Por ahora solo
// registra el pedido en la consola y devuelve un ok.
app.post("/api/checkout", (req, res) => {
  try {
    const { cart } = req.body;
    if (!Array.isArray(cart) || cart.length === 0) {
      return res
        .status(400)
        .json({ error: "El carrito está vacío o no es válido" });
    }
    console.log("Nuevo pedido recibido:");
    cart.forEach((item) => {
      console.log(
        `- ${item.name} x${item.quantity} (precio unitario: $${item.price})`,
      );
    });
    return res.json({ success: true, message: "Pedido registrado" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error al procesar el pedido" });
  }
});

// Usuarios de ejemplo para login
const USERS = [
  {
    email: "admin@nerin.com",
    password: "admin123",
    role: "admin",
    name: "Valdir",
  },
  {
    email: "mayorista@nerin.com",
    password: "clave123",
    role: "mayorista",
    name: "Cliente Mayorista",
  },
];

// === RUTAS ADICIONALES PARA PANEL DE ADMINISTRACIÓN ===

// Clientes: devolver todos los clientes y actualizar saldo/límite
const clientsRepo = require("./data/clientsRepo");
app.get("/api/clients", async (_req, res) => {
  try {
    const clients = await clientsRepo.getAll();
    res.json({ clients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudieron obtener los clientes" });
  }
});
app.put("/api/clients/:email", async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const update = req.body || {};
    const clients = await clientsRepo.getAll();
    const idx = clients.findIndex((c) => c.email === email);
    if (idx === -1) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    clients[idx] = { ...clients[idx], ...update };
    // guardamos de nuevo sobrescribiendo el archivo JSON
    const fs = require("fs/promises");
    const path = require("path");
    const filePath = path.join(process.env.DATA_DIR || require('./utils/dataDir'), "clients.json");
    await fs.writeFile(filePath, JSON.stringify({ clients }, null, 2), "utf8");
    res.json({ success: true, client: clients[idx] });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Solicitud inválida" });
  }
});

// Métricas básicas: pedidos totales, ventas por mes y top productos
app.get("/api/metrics", async (_req, res) => {
  try {
    const orders = await ordersRepo.getAll();
    const salesByMonth = {};
    const productTotals = {};
    orders.forEach((order) => {
      const date = new Date(order.created_at || order.fecha || order.date);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      (order.productos || order.items || []).forEach((item) => {
        const qty = Number(item.quantity || item.qty || 0);
        const price = Number(item.price || item.unit_price || 0);
        salesByMonth[key] = (salesByMonth[key] || 0) + qty * price;
        productTotals[item.name || item.title || ""] =
          (productTotals[item.name || item.title || ""] || 0) + qty;
      });
    });
    const topProducts = Object.entries(productTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, quantity]) => ({ name, quantity }));
    res.json({
      metrics: {
        totalOrders: orders.length,
        salesByMonth,
        topProducts,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudieron calcular las métricas" });
  }
});

// Devoluciones: devolver todas o filtrar por email; actualizar estado
const fsPromises = require("fs/promises");
const returnsFile = require("path").join(process.env.DATA_DIR || require('./utils/dataDir'), "returns.json");
app.get("/api/returns", async (req, res) => {
  try {
    const raw = await fsPromises.readFile(returnsFile, "utf8");
    const returns = JSON.parse(raw).returns || [];
    if (req.query.email) {
      const filtered = returns.filter((r) => r.customerEmail === req.query.email);
      return res.json({ returns: filtered });
    }
    res.json({ returns });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudieron obtener las devoluciones" });
  }
});
app.put("/api/returns/:id", async (req, res) => {
  try {
    const retId = req.params.id;
    const update = req.body || {};
    const raw = await fsPromises.readFile(returnsFile, "utf8");
    const data = JSON.parse(raw);
    const list = data.returns || [];
    const idx = list.findIndex((r) => r.id === retId);
    if (idx === -1) return res.status(404).json({ error: "Devolución no encontrada" });
    list[idx] = { ...list[idx], ...update };
    await fsPromises.writeFile(returnsFile, JSON.stringify({ returns: list }, null, 2), "utf8");
    res.json({ success: true, returnRequest: list[idx] });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Solicitud inválida" });
  }
});

// Configuración general: leer y guardar config.json
const configFile = require("path").join(process.env.DATA_DIR || require('./utils/dataDir'), "config.json");
app.get("/api/config", async (_req, res) => {
  try {
    const raw = await fsPromises.readFile(configFile, "utf8");
    const cfg = JSON.parse(raw);
    res.json(cfg);
  } catch {
    // Si no existe, devolvemos objeto vacío
    res.json({});
  }
});
app.put("/api/config", async (req, res) => {
  try {
    const update = req.body || {};
    let cfg = {};
    try {
      const raw = await fsPromises.readFile(configFile, "utf8");
      cfg = JSON.parse(raw);
    } catch {}
    const newCfg = { ...cfg, ...update };
    await fsPromises.writeFile(configFile, JSON.stringify(newCfg, null, 2), "utf8");
    res.json(newCfg);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Solicitud inválida" });
  }
});

// Tabla de envíos: devolver shipping.json (provincia y costo)
const shippingFile = require("path").join(process.env.DATA_DIR || require('./utils/dataDir'), "shipping.json");
app.get("/api/shipping-table", async (_req, res) => {
  try {
    const raw = await fsPromises.readFile(shippingFile, "utf8");
    const data = JSON.parse(raw);
    res.json({ costos: data.costos || [] });
  } catch {
    res.status(404).json({ error: "No se encontró la tabla de envíos" });
  }
});

// API: login de usuario
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const user = USERS.find((u) => u.email === email && u.password === password);
  if (user) {
    // Generar un token simple (no seguro, solo para demostración)
    const token = Buffer.from(`${user.email}:${Date.now()}`).toString("base64");
    res.json({ success: true, token, role: user.role, name: user.name });
  } else {
    res
      .status(401)
      .json({ success: false, message: "Credenciales incorrectas" });
  }
});

// Fallback para rutas del frontend (permite recargar en rutas relativas)
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.listen(PORT, () => {
  console.log(`Servidor de NERIN corriendo en http://localhost:${PORT}`);
});
