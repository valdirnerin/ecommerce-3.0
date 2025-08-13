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
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const API_FORWARD_URL = process.env.API_FORWARD_URL || "";

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

// Leer productos desde el archivo JSON
function getProducts() {
  const dataPath = path.join(__dirname, "../data/products.json");
  const file = fs.readFileSync(dataPath, "utf8");
  return JSON.parse(file).products;
}

function getOrders() {
  const dataPath = path.join(__dirname, "../data/orders.json");
  try {
    const file = fs.readFileSync(dataPath, "utf8");
    return JSON.parse(file).orders || [];
  } catch {
    return [];
  }
}

function saveOrders(orders) {
  const dataPath = path.join(__dirname, "../data/orders.json");
  fs.writeFileSync(dataPath, JSON.stringify({ orders }, null, 2), "utf8");
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

async function mpWebhookRelay(req, res) {
  // 1) ACK rápido a MP
  res.sendStatus(200);

  try {
    const FORWARD_URL = process.env.MP_WEBHOOK_FORWARD_URL;
    if (!FORWARD_URL) {
      console.warn("MP_WEBHOOK_FORWARD_URL no seteada");
      return;
    }
    const qs = new URLSearchParams(req.query || {}).toString();
    const url = qs ? `${FORWARD_URL}?${qs}` : FORWARD_URL;

    // Reenviar body y algunos headers útiles
    await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": req.ip || "",
        "X-Source-Service": "nerin_final_updated",
      },
      body: req.rawBody?.length ? req.rawBody : JSON.stringify(req.body || {}),
    });
    console.info("mp-webhook relay OK →", url);
  } catch (e) {
    console.error("mp-webhook relay FAIL:", e?.message);
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
app.get("/api/products", (_req, res) => {
  try {
    const products = getProducts();
    res.json({ products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudieron cargar los productos" });
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
          notification_url: `https://nerinparts.com.ar/api/webhooks/mp`,
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
    };
    const orders = getOrders();
    orders.push(order);
    saveOrders(orders);

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

app.get("/api/orders", (req, res) => {
  try {
    const status = (req.query.payment_status || "all").toLowerCase();
    let orders = getOrders();
    if (["pending", "approved", "rejected"].includes(status)) {
      orders = orders.filter((o) => {
        const ps = String(o.payment_status || o.estado_pago || "pending").toLowerCase();
        return ps === status;
      });
    }
    const rows = orders.map((o) => ({
      order_number: o.order_number || o.id || o.external_reference || "",
      date: o.fecha || o.date || o.created_at || "",
      client: o.cliente?.nombre || o.cliente?.name || "",
      phone: o.cliente?.telefono || "",
      shipping_province: o.provincia_envio || "",
      payment_status: o.payment_status || o.estado_pago || "pending",
      total: o.total || 0,
    }));
    res.json({ orders: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudieron obtener los pedidos" });
  }
});

function getOrderStatus(id) {
  const orders = getOrders();
  let order;
  if (id && id.startsWith("pref_")) {
    order = orders.find((o) => String(o.preference_id) === id);
  } else {
    order = orders.find(
      (o) =>
        String(o.id) === id ||
        String(o.external_reference) === id ||
        String(o.order_number) === id,
    );
  }
  if (!order) {
    console.log("status: pending (no row yet)");
    return { status: "pending", numeroOrden: null };
  }
  const raw = String(order.estado_pago || order.payment_status || "").toLowerCase();
  let status = "pending";
  if (["approved", "aprobado", "pagado"].includes(raw)) status = "approved";
  else if (["rejected", "rechazado"].includes(raw)) status = "rejected";
  return {
    status,
    numeroOrden: order.id || order.order_number || order.external_reference || null,
  };
}

app.get("/api/orders/test/:id/status", (req, res) => {
  try {
    res.json(getOrderStatus(req.params.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener estado" });
  }
});

app.get("/api/orders/:id/status", (req, res) => {
  try {
    res.json(getOrderStatus(req.params.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener estado" });
  }
});

// Obtener pedido por ID
app.get("/api/orders/:id", (req, res) => {
  const orders = getOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
  res.json({ order });
});

app.post("/api/webhooks/mp/test", (req, res) => {
  console.log("mp-webhook TEST", req.body);
  res.sendStatus(200);
});

app.post("/api/track-order", (req, res) => {
  const { email, id } = req.body || {};
  const orders = getOrders();
  const order = orders.find(
    (o) => o.id === id && (!o.cliente || o.cliente.email === email),
  );
  if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
  res.json({ order });
});

// Webhook de Mercado Pago: relay al backend externo
app.post(["/api/mercado-pago/webhook", "/api/webhooks/mp"], mpWebhookRelay);

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
