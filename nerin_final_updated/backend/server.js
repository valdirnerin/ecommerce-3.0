/*
 * Servidor Node sin dependencias externas para el sistema ERP + E‑commerce de NERIN.
 *
 * Este servidor expone una API sencilla y sirve los archivos estáticos del
 * frontend. Está diseñado para funcionar sin necesidad de instalar paquetes
 * adicionales (`npm install`), de modo que puedas ejecutar la aplicación
 * inmediatamente con `node backend/server.js`. Para ampliar funcionalidades
 * (bases de datos, autenticación robusta, facturación, etc.) se recomienda
 * utilizar frameworks como Express y bibliotecas adecuadas.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { DATA_DIR: dataDir, dataPath } = require("./utils/dataDir");
const {
  STATUS_ES_TO_CODE,
  mapPaymentStatusCode,
  localizePaymentStatus,
} = require("./utils/paymentStatus");
const {
  mapShippingStatusCode,
  localizeShippingStatus,
} = require("./utils/shippingStatus");
const ordersRepo = require("./data/ordersRepo");

let buildInfo = {};
try {
  const infoPath = path.join(__dirname, "../frontend/build-info.json");
  buildInfo = JSON.parse(fs.readFileSync(infoPath, "utf8"));
} catch (err) {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.NODE_ENV !== "test"
  ) {
    console.warn("build-info.json no disponible", err?.message || err);
  }
}

const BUILD_ID =
  process.env.BUILD_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.RENDER_GIT_COMMIT ||
  process.env.GIT_COMMIT_SHA ||
  process.env.HEROKU_RELEASE_VERSION ||
  (typeof buildInfo === "object" && buildInfo !== null && buildInfo.build
    ? buildInfo.build
    : null) ||
  "dev";

// ENV > utils/dataDir > fallback local
const DATA_DIR = process.env.DATA_DIR || dataDir || path.join(__dirname, 'data');
const BASE_URL = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
const PRODUCTS_TTL = parseInt(process.env.PRODUCTS_TTL_MS, 10) || 60000;

let _cache = { t: 0, data: null };
async function loadProducts() {
  const now = Date.now();
  if (_cache.data && now - _cache.t < PRODUCTS_TTL) return _cache.data;
  const p = typeof dataPath === 'function'
    ? dataPath('products.json')
    : path.join(DATA_DIR, 'products.json');
  try {
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(json?.products) ? json.products : json;
    _cache = { t: now, data: arr };
    return arr;
  } catch {
    _cache = { t: now, data: [] };
    return _cache.data;
  }
}

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escapa JSON para contexto <script> evitando cierre e inyección
function safeJsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// === Directorios persistentes para archivos subidos ===
// UPLOADS_DIR guarda archivos genéricos
// INVOICES_DIR guarda facturas y comprobantes
// PRODUCT_UPLOADS_DIR guarda imágenes de productos
const UPLOADS_DIR = path.join(dataDir, 'uploads');
const INVOICES_DIR = path.join(dataDir, 'invoices');
const PRODUCT_UPLOADS_DIR = path.join(UPLOADS_DIR, 'products');
// Crear directorios si no existen (modo persistente)
try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(INVOICES_DIR, { recursive: true });
  fs.mkdirSync(PRODUCT_UPLOADS_DIR, { recursive: true });
} catch (e) {
  // En entornos donde no haya permisos, los directorios se crearán al primer uso
}
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const { Afip } = require("afip.ts");
const { Resend } = require("resend");
const multer = require("multer");
const generarNumeroOrden = require("./utils/generarNumeroOrden");
const verifyEmail = require("./emailValidator");
const validateWebhook = require("./middleware/validateWebhook");
const { processNotification } = require("./routes/mercadoPago");
require("dotenv").config();
const CONFIG = getConfig();
const APP_PORT = process.env.PORT || 3000;
// Dominio público para redirecciones de Mercado Pago
// configurable mediante la variable de entorno PUBLIC_URL
const DOMAIN = process.env.PUBLIC_URL || "http://localhost:3000";
const resend = CONFIG.resendApiKey ? new Resend(CONFIG.resendApiKey) : null;
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
let mpPreference = null;
let paymentClient = null;
let mpClient = null;
const db = require("./db");
db.init().catch((e) => console.error("db init", e));
if (MP_TOKEN) {
  mpClient = new MercadoPagoConfig({ accessToken: MP_TOKEN });
  mpPreference = new Preference(mpClient);
  paymentClient = new Payment(mpClient);
}

// CORS origin configurado
const ORIGIN = process.env.PUBLIC_URL || "*";

// Polyfill de fetch
const fetchFn =
  globalThis.fetch ||
  ((...a) => import("node-fetch").then(({ default: f }) => f(...a)));

const FOOTER_FILE = dataPath("footer.json");
const DEFAULT_FOOTER = {
  brand: "NERIN PARTS",
  slogan: "Samsung Service Pack Original",
  cta: {
    enabled: true,
    text: "¿Sos técnico o mayorista?",
    buttonLabel: "Acceso mayoristas",
    href: "/mayoristas",
  },
  columns: [],
  contact: { whatsapp: "", email: "", address: "" },
  social: { instagram: "", linkedin: "", youtube: "" },
  badges: {
    mercadoPago: true,
    ssl: true,
    andreani: true,
    oca: true,
    dhl: false,
    authenticity: true,
  },
  newsletter: { enabled: false, placeholder: "", successMsg: "" },
  legal: { cuit: "", iibb: "", terms: "", privacy: "" },
  show: {
    cta: true,
    branding: true,
    columns: true,
    contact: true,
    social: true,
    badges: true,
    newsletter: false,
    legal: true,
  },
  theme: {
    accentFrom: "#FFD54F",
    accentTo: "#FFC107",
    border: "rgba(255,255,255,.08)",
    bg: "#0B0B0C",
    fg: "#EDEDEF",
    muted: "#B8B8BC",
  },
};

// Parsear cuerpo de la request guardando rawBody
function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      req.rawBody = buf;
      const type = req.headers["content-type"] || "";
      const str = buf.toString();
      if (type.includes("application/json")) {
        try {
          req.body = JSON.parse(str);
        } catch {
          req.body = {};
        }
      } else if (type.includes("application/x-www-form-urlencoded")) {
        req.body = Object.fromEntries(new URLSearchParams(str));
      } else {
        req.body = str;
      }
      resolve();
    });
  });
}

async function mpWebhookRelay(req, res, parsedUrl) {
  await parseBody(req);
  res.writeHead(200, {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Accept, Content-Type, Authorization, X-Requested-With",
  });
  res.end();

  setImmediate(async () => {
    try {
      const fwd = process.env.MP_WEBHOOK_FORWARD_URL;
      if (fwd) {
        const qs = new URLSearchParams(parsedUrl.query || {}).toString();
        const url = qs ? `${fwd}?${qs}` : fwd;
        fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Source-Service": "nerin",
          },
          body: req.rawBody?.length
            ? req.rawBody
            : JSON.stringify(req.body || {}),
        }).catch((e) => console.error("mp-webhook relay FAIL", e?.message));
        console.info("mp-webhook relay →", url);
      }

      // TODO: verificar firma HMAC de Mercado Pago
      const payload = req.body || {};
      const paymentId =
        payload.data?.id || payload.data?.payment_id || payload.id || null;
      let info = payload;
      if (paymentClient && paymentId) {
        try {
          info = await paymentClient.get({ id: paymentId });
        } catch (e) {
          console.error("mp get payment fail", e?.message);
        }
      }
      const extRef =
        info.external_reference || payload.external_reference || null;
      const prefId = info.preference_id || payload.data?.preference_id || null;
      const status = (
        info.status ||
        payload.data?.status ||
        payload.type ||
        ""
      ).toLowerCase();
      if (!extRef && !prefId) return;

      const orders = getOrders();
      let idx = -1;
      if (extRef) {
        idx = orders.findIndex(
          (o) =>
            o.id === extRef ||
            o.external_reference === extRef ||
            o.order_number === extRef,
        );
      }
      if (idx === -1 && prefId) {
        idx = orders.findIndex(
          (o) => String(o.preference_id) === String(prefId),
        );
      }
      if (idx !== -1) {
        const row = orders[idx];
        row.payment_id = paymentId || row.payment_id;
        const normalizedStatus = mapPaymentStatusCode(status);
        row.payment_status_code = normalizedStatus;
        const localizedStatus = localizePaymentStatus(status);
        row.payment_status = localizedStatus;
        row.estado_pago = localizedStatus;
        if (
          normalizedStatus === "approved" &&
          !row.inventoryApplied &&
          !row.inventory_applied
        ) {
          const products = getProducts();
          (row.productos || row.items || []).forEach((it) => {
            const pIdx = products.findIndex(
              (p) => String(p.id) === String(it.id) || p.sku === it.sku,
            );
            if (pIdx !== -1) {
              products[pIdx].stock =
                Number(products[pIdx].stock || 0) - Number(it.quantity || 0);
            }
          });
          saveProducts(products);
          row.inventoryApplied = true;
          row.inventory_applied = true;
          console.log(`inventory applied for ${row.id || row.order_number}`);
        }
        if (
          normalizedStatus === "rejected" &&
          (row.inventoryApplied || row.inventory_applied)
        ) {
          // TODO: revertir stock si el pago fue rechazado luego de aprobarse
        }
        saveOrders(orders);
        console.log("mp-webhook updated", extRef || prefId, status);
      } else {
        console.log("mp-webhook order not found", extRef, prefId);
      }
    } catch (e) {
      console.error("mp-webhook process error", e?.message);
    }
  });
}

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
  // Usuario vendedor que puede gestionar productos y pedidos pero no ver métricas ni clientes
  {
    email: "vendedor@nerin.com",
    password: "vendedor123",
    role: "vendedor",
    name: "Vendedor",
  },
  // Cliente VIP con acceso a productos exclusivos y descuentos especiales
  {
    email: "vip@nerin.com",
    password: "vip123",
    role: "vip",
    name: "Cliente VIP",
  },
];

// ------------------------ Gestión de usuarios registrados ------------------------

/**
 * Leer usuarios registrados desde el archivo JSON. Retorna un array de objetos
 * { email, password, role, name }. Si no existe, devuelve un array vacío.
 */
function getUsers() {
  const filePath = dataPath("users.json");
  try {
    const file = fs.readFileSync(filePath, "utf8");
    return JSON.parse(file).users || [];
  } catch (e) {
    return [];
  }
}

/**
 * Guardar usuarios registrados. Se almacena bajo la clave "users".
 */
function saveUsers(users) {
  const filePath = dataPath("users.json");
  fs.writeFileSync(filePath, JSON.stringify({ users }, null, 2), "utf8");
}

// ========================= NUEVAS UTILIDADES PARA MÓDULOS AVANZADOS =========================

/**
 * Leer proveedores desde el archivo JSON. Cada proveedor contiene al menos un ID,
 * nombre, contacto y condiciones de pago. Se puede ampliar con información
 * adicional como dirección, email y tiempo de entrega.
 */
function getSuppliers() {
  const filePath = dataPath("suppliers.json");
  try {
    const file = fs.readFileSync(filePath, "utf8");
    return JSON.parse(file).suppliers;
  } catch (e) {
    // Si el archivo no existe, devolver lista vacía
    return [];
  }
}

/**
 * Guardar la lista de proveedores. La estructura del archivo es
 * { "suppliers": [ ... ] } para que sea similar a otros ficheros del sistema.
 */
function saveSuppliers(suppliers) {
  const filePath = dataPath("suppliers.json");
  fs.writeFileSync(filePath, JSON.stringify({ suppliers }, null, 2), "utf8");
}

/**
 * Leer órdenes de compra (Purchase Orders) del archivo JSON. Cada orden
 * contiene un ID, proveedor, lista de ítems (SKU, cantidad, coste), fecha de
 * creación, estado (pendiente, aprobada, recibida) y fecha estimada de llegada.
 */
function getPurchaseOrders() {
  const filePath = dataPath("purchase_orders.json");
  try {
    const file = fs.readFileSync(filePath, "utf8");
    return JSON.parse(file).purchaseOrders;
  } catch (e) {
    return [];
  }
}

/**
 * Guardar órdenes de compra en el archivo JSON.
 */
function savePurchaseOrders(purchaseOrders) {
  const filePath = dataPath("purchase_orders.json");
  fs.writeFileSync(
    filePath,
    JSON.stringify({ purchaseOrders }, null, 2),
    "utf8",
  );
}

/**
 * Calcular métricas avanzadas a partir de pedidos, devoluciones y productos. Devuelve
 * un objeto que agrega ventas por categoría, ventas totales por producto, tasa de
 * devoluciones y clientes principales. Estas métricas pueden utilizarse para
 * gráficos y análisis de negocio.
 */
function calculateDetailedAnalytics() {
  const orders = getOrders();
  const returns = getReturns();
  const products = getProducts();
  const salesByCategory = {};
  const salesByProduct = {};
  const returnsByProduct = {};
  const customerTotals = {};
  const monthlySales = {};
  let totalSales = 0;
  let totalUnitsSold = 0;
  let totalReturns = 0;
  orders.forEach((order) => {
    totalSales += order.total || 0;
    // Agrupar ventas por mes
    if (order.date) {
      const month = order.date.slice(0, 7); // YYYY-MM
      monthlySales[month] = (monthlySales[month] || 0) + (order.total || 0);
    }
    (order.productos || []).forEach((item) => {
      const prod = products.find((p) => p.id === item.id);
      if (prod) {
        // Categoría
        const cat = prod.category || "Sin categoría";
        salesByCategory[cat] =
          (salesByCategory[cat] || 0) +
          item.quantity * (item.price || prod.price_minorista);
        // Producto
        salesByProduct[prod.name] =
          (salesByProduct[prod.name] || 0) + item.quantity;
      }
      totalUnitsSold += item.quantity;
    });
    // Total por cliente
    if (order.cliente && order.cliente.email) {
      const email = order.cliente.email;
      customerTotals[email] = (customerTotals[email] || 0) + order.total;
    }
  });
  // Devoluciones
  returns.forEach((ret) => {
    ret.items.forEach((item) => {
      const prod = products.find((p) => p.id === item.id);
      if (prod) {
        returnsByProduct[prod.name] =
          (returnsByProduct[prod.name] || 0) + item.quantity;
      }
      totalReturns += item.quantity;
    });
  });
  // Top clientes
  const topCustomers = Object.entries(customerTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([email, total]) => ({ email, total }));
  const averageOrderValue = orders.length ? totalSales / orders.length : 0;
  const returnRate = totalUnitsSold > 0 ? totalReturns / totalUnitsSold : 0;
  const mostReturnedEntry = Object.entries(returnsByProduct).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const mostReturnedProduct = mostReturnedEntry ? mostReturnedEntry[0] : null;
  return {
    salesByCategory,
    salesByProduct,
    returnsByProduct,
    topCustomers,
    monthlySales,
    averageOrderValue,
    returnRate,
    mostReturnedProduct,
  };
}

// Leer productos desde el archivo JSON
function getProducts() {
  const filePath = dataPath("products.json");
  const file = fs.readFileSync(filePath, "utf8");
  return JSON.parse(file).products;
}

// Guardar productos en el archivo JSON
function saveProducts(products) {
  const filePath = dataPath("products.json");
  fs.writeFileSync(filePath, JSON.stringify({ products }, null, 2), "utf8");
}

// Leer pedidos desde el archivo JSON
function getOrders() {
  const filePath = dataPath("orders.json");
  const file = fs.readFileSync(filePath, "utf8");
  return JSON.parse(file).orders;
}

// Guardar pedidos en el archivo JSON
function saveOrders(orders) {
  const filePath = dataPath("orders.json");
  fs.writeFileSync(filePath, JSON.stringify({ orders }, null, 2), "utf8");
}

// Leer líneas de pedidos
function getOrderItems() {
  const filePath = dataPath("order_items.json");
  try {
    const file = fs.readFileSync(filePath, "utf8");
    return JSON.parse(file).order_items || [];
  } catch {
    return [];
  }
}

// Guardar líneas de pedidos
function saveOrderItems(items) {
  const filePath = dataPath("order_items.json");
  fs.writeFileSync(
    filePath,
    JSON.stringify({ order_items: items }, null, 2),
    "utf8",
  );
}

function normalizeOrder(o) {
  const orderNum = o.order_number || o.id || o.external_reference || "";
  const created = o.created_at || o.fecha || o.date || "";
  const cliente = o.cliente || {};
  const dir = cliente.direccion || {};
  const phone = cliente.telefono || cliente.phone || "";
  const address = dir.calle
    ? `${dir.calle} ${dir.numero || ""}${dir.localidad ? ", " + dir.localidad : ""}${dir.provincia ? ", " + dir.provincia : ""} ${dir.cp || ""}`.trim()
    : "";
  const province = o.provincia_envio || dir.provincia || "";
  const shippingCost = Number(o.costo_envio || 0);
  const items = o.productos || o.items || [];
  const itemsSummary = items
    .map(
      (it) =>
        `${
          it.name || it.title || it.titulo || it.id || "item"
        } x${it.quantity || it.qty || it.cantidad || 0}`,
    )
    .join(", ");
  const total = Number(o.total || o.total_amount || 0);
  const statusSource = o.payment_status || o.estado_pago || o.payment_status_code;
  const paymentCode = mapPaymentStatusCode(statusSource);
  const payment = localizePaymentStatus(statusSource);
  const shipping = o.shipping_status || o.estado_envio || "pendiente";
  const tracking = o.tracking || o.seguimiento || "";
  const carrier = o.carrier || o.transportista || "";
  return {
    ...o,
    order_number: orderNum,
    orderNumber: orderNum,
    created_at: created,
    createdAt: created,
    user_email: o.user_email || cliente.email || "",
    phone,
    address,
    province,
    // El costo de envío se expone tanto como "shipping_cost" (en inglés) como
    // "costo_envio" (en español) para compatibilidad con el frontend existente.
    shipping_cost: shippingCost,
    costo_envio: shippingCost,
    items_summary: itemsSummary,
    total_amount: total,
    total,
    payment_status_code: paymentCode,
    paymentStatusCode: paymentCode,
    payment_status: payment,
    paymentStatus: payment,
    shipping_status: shipping,
    shippingStatus: shipping,
    tracking,
    carrier,
    productos: items,
    cliente,
  };
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function firstFiniteNumber(values, fallback = 0) {
  for (const value of values) {
    if (value == null) continue;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return fallback;
}

function computeTotalsSnapshot(order = {}) {
  const totals =
    order && typeof order.totals === "object" && order.totals
      ? { ...order.totals }
      : {};
  const normalizedItems = ordersRepo.getNormalizedItems(order);
  const itemsTotal = firstFiniteNumber(
    [
      totals.items_total,
      totals.subtotal,
      order.items_total,
      order.subtotal,
    ],
    normalizedItems.reduce(
      (acc, it) =>
        acc + Number(it.total || Number(it.price || 0) * Number(it.qty || 0)),
      0,
    ),
  );
  const shippingTotal = firstFiniteNumber(
    [
      totals.shipping_total,
      totals.shipping,
      order.shipping_total,
      order.shipping_cost,
      order.costo_envio,
      order.envio?.costo,
      order.customer?.costo,
      order.customer?.costo_envio,
    ],
    0,
  );
  const grandTotal = firstFiniteNumber(
    [
      totals.grand_total,
      totals.total,
      order.total,
      order.total_amount,
      itemsTotal + shippingTotal,
    ],
    itemsTotal + shippingTotal,
  );
  return {
    ...totals,
    items_total: itemsTotal,
    shipping_total: shippingTotal,
    grand_total: grandTotal,
  };
}

function getOrderStatus(id) {
  const orders = getOrders();
  let order = null;
  if (id && /^NRN-/i.test(id)) {
    order = orders.find(
      (o) =>
        o.id === id || o.external_reference === id || o.order_number === id,
    );
  } else {
    order = orders.find((o) => String(o.preference_id) === String(id));
    if (!order) {
      order = orders.find(
        (o) =>
          o.id === id || o.external_reference === id || o.order_number === id,
      );
    }
  }
  if (!order) {
    console.log("status: pending (no row yet)");
    return { status: "pending", numeroOrden: null };
  }
  const status = mapPaymentStatusCode(
    order.estado_pago || order.payment_status || order.payment_status_code || order.status || "",
  );
  return {
    status,
    numeroOrden:
      order.id || order.order_number || order.external_reference || null,
  };
}

// Leer clientes desde el archivo JSON
function getClients() {
  const filePath = dataPath("clients.json");
  const file = fs.readFileSync(filePath, "utf8");
  return JSON.parse(file).clients;
}

// Guardar clientes en el archivo JSON
function saveClients(clients) {
  const filePath = dataPath("clients.json");
  fs.writeFileSync(filePath, JSON.stringify({ clients }, null, 2), "utf8");
}

// Leer facturas desde el archivo JSON
function getInvoices() {
  const filePath = dataPath("invoices.json");
  const file = fs.readFileSync(filePath, "utf8");
  return JSON.parse(file).invoices;
}

// Leer configuración general (ID de Google Analytics, Meta Pixel, WhatsApp, etc.)
function getConfig() {
  const filePath = dataPath("config.json");
  try {
    const file = fs.readFileSync(filePath, "utf8");
    return JSON.parse(file);
  } catch (e) {
    // Si el archivo no existe o está corrupto, devolver configuración vacía
    return {};
  }
}

// Guardar configuración general
function saveConfig(cfg) {
  const filePath = dataPath("config.json");
  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2), "utf8");
}

// Leer devoluciones desde el archivo JSON
function getReturns() {
  const filePath = dataPath("returns.json");
  const file = fs.readFileSync(filePath, "utf8");
  return JSON.parse(file).returns;
}

// Guardar devoluciones en el archivo JSON
function saveReturns(returns) {
  const filePath = dataPath("returns.json");
  fs.writeFileSync(filePath, JSON.stringify({ returns }, null, 2), "utf8");
}

// Guardar facturas en el archivo JSON
function saveInvoices(invoices) {
  const filePath = dataPath("invoices.json");
  fs.writeFileSync(filePath, JSON.stringify({ invoices }, null, 2), "utf8");
}

// Leer registros de archivos de factura
function getInvoiceUploads() {
  const filePath = dataPath("invoice_uploads.json");
  try {
    const file = fs.readFileSync(filePath, "utf8");
    return JSON.parse(file).uploads || [];
  } catch {
    return [];
  }
}

// Guardar registros de archivos de factura
function saveInvoiceUploads(uploads) {
  const filePath = dataPath("invoice_uploads.json");
  fs.writeFileSync(filePath, JSON.stringify({ uploads }, null, 2), "utf8");
}

// Obtener el siguiente número de factura (persistente)
function getNextInvoiceNumber() {
  const filePath = dataPath("invoice_counter.txt");
  let counter = 0;
  try {
    counter = parseInt(fs.readFileSync(filePath, "utf8"), 10);
  } catch (e) {
    counter = 0;
  }
  counter += 1;
  fs.writeFileSync(filePath, String(counter), "utf8");
  // Formato: 0000001, 0000002, ...
  return counter.toString().padStart(7, "0");
}

// Helper para enviar respuestas JSON con CORS y cabeceras básicas
function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Accept, Content-Type, Authorization, X-Requested-With",
  });
  res.end(json);
}

// Enviar email de confirmación cuando un pedido se marca como pagado
function sendOrderPaidEmail(order) {
  if (!resend || !order.cliente || !order.cliente.email) return;
  try {
    const tplPath = path.join(__dirname, "../emails/orderPaid.html");
    let html = fs.readFileSync(tplPath, "utf8");
    const urlBase = CONFIG.publicUrl || `http://localhost:${APP_PORT}`;
    const orderUrl = `${urlBase}/seguimiento?order=${encodeURIComponent(order.id)}&email=${encodeURIComponent(order.cliente.email || "")}`;
    html = html
      .replace("{{ORDER_URL}}", orderUrl)
      .replace("{{ORDER_ID}}", order.id);
    resend.emails
      .send({
        from: "no-reply@nerin.com",
        to: order.cliente.email,
        subject: "Confirmación de compra",
        html,
      })
      .catch((e) => console.error("Email error", e));
  } catch (e) {
    console.error("send email failed", e);
  }
}
// Leer y guardar configuración de footer
function readFooter() {
  try {
    const txt = fs.readFileSync(FOOTER_FILE, "utf8");
    return JSON.parse(txt);
  } catch {
    try {
      fs.writeFileSync(FOOTER_FILE, JSON.stringify(DEFAULT_FOOTER, null, 2));
    } catch (e) {
      console.error("Cannot write default footer", e);
    }
    return { ...DEFAULT_FOOTER };
  }
}

function saveFooter(cfg) {
  try {
    fs.writeFileSync(FOOTER_FILE, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error("Cannot save footer", e);
  }
}

function normalizeFooter(data) {
  const base = readFooter();
  const out = { ...base };
  out.brand = typeof data.brand === "string" ? data.brand.trim() : base.brand;
  out.slogan =
    typeof data.slogan === "string" ? data.slogan.trim() : base.slogan;
  out.cta = {
    enabled: Boolean(data?.cta?.enabled),
    text: String(data?.cta?.text || ""),
    buttonLabel: String(data?.cta?.buttonLabel || ""),
    href: String(data?.cta?.href || ""),
  };
  out.columns = Array.isArray(data.columns) ? data.columns : base.columns;
  out.contact = {
    whatsapp: String(data?.contact?.whatsapp || ""),
    email: String(data?.contact?.email || ""),
    address: String(data?.contact?.address || ""),
  };
  out.social = {
    instagram: String(data?.social?.instagram || ""),
    linkedin: String(data?.social?.linkedin || ""),
    youtube: String(data?.social?.youtube || ""),
  };
  out.badges = {
    mercadoPago: Boolean(data?.badges?.mercadoPago),
    ssl: Boolean(data?.badges?.ssl),
    andreani: Boolean(data?.badges?.andreani),
    oca: Boolean(data?.badges?.oca),
    dhl: Boolean(data?.badges?.dhl),
    authenticity: Boolean(data?.badges?.authenticity),
  };
  out.newsletter = {
    enabled: Boolean(data?.newsletter?.enabled),
    placeholder: String(data?.newsletter?.placeholder || ""),
    successMsg: String(data?.newsletter?.successMsg || ""),
  };
  out.legal = {
    cuit: String(data?.legal?.cuit || ""),
    iibb: String(data?.legal?.iibb || ""),
    terms: String(data?.legal?.terms || ""),
    privacy: String(data?.legal?.privacy || ""),
  };
  out.show = {
    cta: Boolean(data?.show?.cta),
    branding: Boolean(data?.show?.branding),
    columns: Boolean(data?.show?.columns),
    contact: Boolean(data?.show?.contact),
    social: Boolean(data?.show?.social),
    badges: Boolean(data?.show?.badges),
    newsletter: Boolean(data?.show?.newsletter),
    legal: Boolean(data?.show?.legal),
  };
  out.theme = {
    accentFrom: String(data?.theme?.accentFrom || base.theme.accentFrom),
    accentTo: String(data?.theme?.accentTo || base.theme.accentTo),
    border: String(data?.theme?.border || base.theme.border),
    bg: String(data?.theme?.bg || base.theme.bg),
    fg: String(data?.theme?.fg || base.theme.fg),
    muted: String(data?.theme?.muted || base.theme.muted),
  };
  return out;
}

// Leer tabla de costos de envío por provincia
function getShippingTable() {
  const filePath = dataPath("shipping.json");
  try {
    const file = fs.readFileSync(filePath, "utf8");
    return JSON.parse(file);
  } catch (e) {
    return { costos: [] };
  }
}

function saveShippingTable(table) {
  const filePath = dataPath("shipping.json");
  fs.writeFileSync(filePath, JSON.stringify(table, null, 2), "utf8");
}

function validateShippingTable(table) {
  return (
    table &&
    Array.isArray(table.costos) &&
    table.costos.every(
      (c) =>
        typeof c.provincia === "string" &&
        typeof c.costo === "number" &&
        !Number.isNaN(c.costo),
    )
  );
}

// Obtener costo de envío para una provincia (retorna 0 si no se encuentra)
function getShippingCost(provincia) {
  const table = getShippingTable();
  const match = table.costos.find(
    (c) => c.provincia.toLowerCase() === String(provincia || "").toLowerCase(),
  );
  if (match) return match.costo;
  const other = table.costos.find((c) => c.provincia === "Otras");
  return other ? other.costo : 0;
}

// Enviar email cuando el pedido se despacha
function sendOrderShippedEmail(order) {
  if (!resend || !order.cliente || !order.cliente.email) return;
  try {
    const subject = "Tu pedido fue enviado";
    const body = `Seguimiento: ${order.seguimiento || ""}`;
    resend.emails
      .send({
        from: "no-reply@nerin.com",
        to: order.cliente.email,
        subject,
        html: `<p>${body}</p>`,
      })
      .catch((e) => console.error("Email error", e));
  } catch (e) {
    console.error("send email failed", e);
  }
}

// Configuración de subida de imágenes de productos
// Las imágenes se guardan en PRODUCT_UPLOADS_DIR para que persistan entre deploys
const productImagesDir = PRODUCT_UPLOADS_DIR;
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(productImagesDir, { recursive: true });
      cb(null, productImagesDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const sku = decodeURIComponent((req.params && req.params.sku) || "img");
      cb(null, `${sku}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".jpg", ".jpeg", ".png"].includes(ext)) cb(null, true);
    else cb(new Error("Formato no permitido"));
  },
});

// Subida genérica de archivos al directorio UPLOADS_DIR
const generalUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Servir archivos estáticos (HTML, CSS, JS, imágenes)
function serveStatic(filePath, res, headers = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } else {
      res.writeHead(200, { "Content-Type": contentType, ...headers });
      res.end(data);
    }
  });
}

// Crear servidor HTTP
async function requestHandler(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Accept, Content-Type, Authorization, X-Requested-With",
  );

  // Soportar solicitudes OPTIONS para CORS
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Accept, Content-Type, Authorization, X-Requested-With",
    });
    return res.end();
  }

  if (pathname === "/api/version" && req.method === "GET") {
    return sendJson(res, 200, { build: BUILD_ID });
  }

  if (pathname === "/health/db") {
    (async () => {
      const pool = db.getPool();
      if (!pool) return sendJson(res, 503, { ok: false });
      try {
        await db.query("SELECT 1");
        return sendJson(res, 200, { ok: true });
      } catch {
        return sendJson(res, 500, { ok: false });
      }
    })();
    return;
  }

  // API: obtener productos
  if (pathname === "/api/products" && req.method === "GET") {
    try {
      const products = getProducts();
      return sendJson(res, 200, { products });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron cargar los productos",
      });
    }
  }

  // API: obtener un producto por ID
  if (pathname.startsWith("/api/products/") && req.method === "GET") {
    const id = pathname.split("/").pop();
    try {
      const products = getProducts();
      const product = products.find((p) => p.id === id);
      if (!product) {
        return sendJson(res, 404, { error: "Producto no encontrado" });
      }
      return sendJson(res, 200, product);
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "No se pudo cargar el producto" });
    }
  }

  // API: login
  if (pathname === "/api/login" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const { email, password } = JSON.parse(body || "{}");
        // Buscar en usuarios de ejemplo y usuarios registrados
        let user = USERS.find(
          (u) => u.email === email && u.password === password,
        );
        if (!user) {
          const regUsers = getUsers();
          user = regUsers.find(
            (u) => u.email === email && u.password === password,
          );
        }
        if (user) {
          // Generar token simple (base64) para demostración
          const token = Buffer.from(`${user.email}:${Date.now()}`).toString(
            "base64",
          );
          return sendJson(res, 200, {
            success: true,
            token,
            role: user.role || "mayorista",
            name: user.name || "Cliente",
          });
        } else {
          return sendJson(res, 401, {
            success: false,
            message: "Credenciales incorrectas",
          });
        }
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: err.message });
      }
    });
    return;
  }

  // API: subir imagen de producto
  // Ruta: /api/product-image/{sku} (POST)
  if (pathname.startsWith("/api/product-image/") && req.method === "POST") {
    const sku = decodeURIComponent(pathname.split("/").pop());
    req.params = { sku };
    upload.single("image")(req, res, (err) => {
      if (err) {
        console.error(err);
        return sendJson(res, 400, { error: err.message });
      }
      if (!req.file) {
        return sendJson(res, 400, { error: "No se recibió archivo" });
      }
      const fileName = req.file.filename;
      const urlBase = `/assets/uploads/products/${encodeURIComponent(fileName)}`;
      return sendJson(res, 201, {
        success: true,
        file: fileName,
        path: urlBase,
      });
    });
    return;
  }

  // API: subida genérica de archivos
  // Ruta: /api/upload (POST)
  if (pathname === "/api/upload" && req.method === "POST") {
    generalUpload.single("file")(req, res, (err) => {
      if (err) {
        console.error(err);
        return sendJson(res, 400, { error: err.message });
      }
      if (!req.file) {
        return sendJson(res, 400, { error: "No se recibió archivo" });
      }
      return sendJson(res, 201, { filename: req.file.filename });
    });
    return;
  }

  // API: registro de un nuevo usuario (clientes)
  if (pathname === "/api/register" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { email, password, name, role } = JSON.parse(body || "{}");
        if (!email || !password) {
          return sendJson(res, 400, {
            error: "Correo y contraseña son obligatorios",
          });
        }
        // Verificar si ya existe el usuario (solo en usuarios predefinidos o registrados)
        const inPredefined = USERS.some((u) => u.email === email);
        const regUsers = getUsers();
        const inRegistered = regUsers.some((u) => u.email === email);
        if (inPredefined || inRegistered) {
          return sendJson(res, 409, {
            error: "Ya existe una cuenta con ese correo",
          });
        }
        const clients = getClients();

        const userRole = role === "minorista" ? "minorista" : "mayorista";

        // Agregar a usuarios registrados
        const newUser = { email, password, role: userRole, name: name || "" };
        regUsers.push(newUser);
        saveUsers(regUsers);

        // Actualizar cliente existente o crearlo si no existe
        const clientIdx = clients.findIndex((c) => c.email === email);
        if (clientIdx === -1) {
          clients.push({
            email,
            name: name || "Cliente",
            cuit: "",
            condicion_iva: "",
            balance: 0,
            limit: 100000,
          });
        } else {
          clients[clientIdx].name =
            name || clients[clientIdx].name || "Cliente";
        }
        saveClients(clients);
        // Generar token
        const token = Buffer.from(`${email}:${Date.now()}`).toString("base64");
        return sendJson(res, 201, {
          success: true,
          token,
          role: userRole,
          name: name || "Cliente",
        });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: checkout / confirmar pedido
  if (pathname === "/api/checkout" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const cart = parsed.cart;
        const customer = parsed.customer;
        if (!Array.isArray(cart) || cart.length === 0) {
          return sendJson(res, 400, {
            error: "El carrito está vacío o no es válido",
          });
        }
        console.log("Nuevo pedido recibido:");
        cart.forEach((item) => {
          console.log(
            `- ${item.name} x${item.quantity} (precio unitario: $${item.price})`,
          );
        });
        // Verificar stock disponible antes de confirmar pedido
        try {
          const products = getProducts();
          for (const item of cart) {
            const prod = products.find((p) => p.id === item.id);
            if (!prod) {
              return sendJson(res, 400, {
                error: `Producto con ID ${item.id} no encontrado`,
              });
            }
            const available = typeof prod.stock === "number" ? prod.stock : 0;
            if (item.quantity > available) {
              return sendJson(res, 400, {
                error: `Stock insuficiente para ${prod.name}. Disponibles: ${available}`,
              });
            }
          }
        } catch (e) {
          console.error("Error al validar stock:", e);
          return sendJson(res, 500, { error: "Error al validar stock" });
        }
        // Generar un número de orden legible
        if (data.cliente && data.cliente.email) {
          const valid = await verifyEmail(String(data.cliente.email).trim());
          if (!valid) {
            return sendJson(res, 400, {
              error:
                "El email ingresado no es válido. Por favor, ingresá uno real para recibir tu pedido.",
            });
          }
        }
        const orderId = generarNumeroOrden();
        const orders = getOrders();
        // Calcular total del pedido (utilizando precio base del producto)
        let total = 0;
        cart.forEach((item) => {
          total += item.price * item.quantity;
        });
        // Registrar pedido con posible información del cliente
        const pendingCode = mapPaymentStatusCode("pending");
        const pendingLabel = localizePaymentStatus("pending");
        const orderEntry = {
          id: orderId,
          external_reference: orderId,
          date: new Date().toISOString(),
          // Clonar items para no mutar las cantidades al actualizar inventario
          items: cart.map((it) => ({ ...it })),
          estado_pago: pendingLabel,
          payment_status: pendingLabel,
          payment_status_code: pendingCode,
          total,
          inventoryApplied: false,
        };
        // Si existe información de cliente, agregarla
        if (customer) {
          orderEntry.customer = customer;
        }
        orders.push(orderEntry);
        saveOrders(orders);
        /*
         * Lógica de descuento de stock trasladada al webhook de pago.
         * Se mantiene comentada aquí para referencia histórica.
         * Al confirmar el pago se actualizará el inventario desde
         * /api/mercado-pago/webhook.
         */
        // Si el pedido proviene de un cliente identificado, actualizar saldo
        if (customer && customer.email) {
          const clients = getClients();
          let client = clients.find((c) => c.email === customer.email);
          if (!client) {
            // Crear cliente nuevo con saldo inicial 0 y límite por defecto
            client = {
              email: customer.email,
              name: customer.name || "Cliente",
              cuit: "",
              condicion_iva: "",
              balance: 0,
              limit: 100000,
            };
            clients.push(client);
          }
          client.balance += total;
          saveClients(clients);
        }
        let mpInit = null;
        if (mpPreference) {
          try {
            const mpPref = {
              items: cart.map((it) => ({
                title: it.name,
                quantity: Number(it.quantity),
                unit_price: Number(it.price),
              })),
              back_urls: {
                success: `${DOMAIN}/success`,
                failure: `${DOMAIN}/failure`,
                pending: `${DOMAIN}/pending`,
              },
              auto_return: "approved",
              external_reference: orderId,
            };
            const prefRes = await mpPreference.create({ body: mpPref });
            mpInit = prefRes.init_point;
            orderEntry.preference_id = prefRes.id;
            saveOrders(orders);
          } catch (prefErr) {
            console.error(
              "Error al crear preferencia de Mercado Pago:",
              prefErr,
            );
          }
        }
        return sendJson(res, 200, {
          success: true,
          message: "Pedido registrado",
          orderId,
          init_point: mpInit,
        });
      } catch (err) {
        console.error(err);
        return sendJson(res, 500, { error: err.message });
      }
    });
    return;
  }

  // API: obtener costo de envío por provincia
  if (pathname === "/api/shipping-cost" && req.method === "GET") {
    const prov = parsedUrl.query.provincia || "";
    const costo = getShippingCost(prov);
    return sendJson(res, 200, { costo });
  }

  // API: validar email en tiempo real
  if (pathname === "/api/validate-email" && req.method === "GET") {
    const email = parsedUrl.query.email || "";
    return verifyEmail(String(email).trim())
      .then((valid) => {
        return sendJson(res, 200, { valid: !!valid });
      })
      .catch((e) => {
        console.error("Error validating email", e);
        return sendJson(res, 500, { error: "Error al validar" });
      });
  }

  if (pathname === "/api/footer" && req.method === "GET") {
    const cfg = readFooter();
    return sendJson(res, 200, cfg);
  }

  if (pathname === "/api/footer" && req.method === "POST") {
    const adminKey = req.headers["x-admin-key"];
    if (process.env.ADMIN_KEY && adminKey !== process.env.ADMIN_KEY) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        const cfg = normalizeFooter(data);
        saveFooter(cfg);
        return sendJson(res, 200, { success: true });
      } catch (e) {
        console.error(e);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  if (pathname === "/api/shipping-table" && req.method === "GET") {
    const table = getShippingTable();
    if (!validateShippingTable(table)) {
      return sendJson(res, 500, {
        error: "Tabla de env\u00edos inv\u00e1lida",
      });
    }
    return sendJson(res, 200, table);
  }

  if (pathname === "/api/shipping-table" && req.method === "PUT") {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        if (!validateShippingTable(data)) {
          return sendJson(res, 400, {
            error: "Datos de env\u00edos inv\u00e1lidos",
          });
        }
        saveShippingTable(data);
        return sendJson(res, 200, { success: true });
      } catch (e) {
        console.error(e);
        return sendJson(res, 400, { error: "Solicitud inv\u00e1lida" });
      }
    });
    return;
  }

  // API: crear nueva orden pendiente con datos de cliente y envío
  if (pathname === "/api/orders" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        console.log("/api/orders body", data);
        const items = data.productos || data.items || [];
        if (!Array.isArray(items) || items.length === 0) {
          return sendJson(res, 400, { error: "Carrito vacío" });
        }
        const orderId = generarNumeroOrden();
        const orders = getOrders();
        const provincia =
          (data.cliente &&
            data.cliente.direccion &&
            data.cliente.direccion.provincia) ||
          "";
        const shippingCost = getShippingCost(provincia);
        const total = items.reduce((t, it) => t + it.price * it.quantity, 0);
        const impuestosCalc = Math.round(total * 0.21);
        const itemsSummary = items
          .map((it) => `${it.name} x${it.quantity}`)
          .join(", ");
        const pendingCode = mapPaymentStatusCode("pending");
        const pendingLabel = localizePaymentStatus("pending");
        const baseOrder = {
          id: orderId,
          order_number: orderId,
          external_reference: orderId,
          cliente: data.cliente || {},
          productos: items,
          provincia_envio: provincia,
          costo_envio: shippingCost,
          estado_pago: pendingLabel,
          payment_status: pendingLabel,
          payment_status_code: pendingCode,
          estado_envio: "pendiente",
          shipping_status: "pendiente",
          metodo_envio: data.metodo_envio || "Correo Argentino",
          comentarios: data.comentarios || "",
          total,
          items_summary: itemsSummary,
          impuestos: {
            iva: 21,
            percepciones: 0,
            totalImpuestos: impuestosCalc,
          },
          fecha: new Date().toISOString(),
          created_at: new Date().toISOString(),
          seguimiento: "",
          tracking: "",
          transportista: "",
          carrier: "",
          user_email: (data.cliente && data.cliente.email) || "",
          inventoryApplied: false,
        };
        const idx = orders.findIndex((o) => o.id === orderId);
        if (idx !== -1) orders[idx] = { ...orders[idx], ...baseOrder };
        else orders.push(baseOrder);
        saveOrders(orders);

        // guardar líneas
        const orderItems = getOrderItems();
        items.forEach((it) => {
          const line = {
            order_number: orderId,
            product_id: it.id || it.sku || "",
            title: it.name,
            qty: it.quantity,
            unit_price: it.price,
            subtotal: it.price * it.quantity,
          };
          orderItems.push(line);
        });
        saveOrderItems(orderItems);
        let initPoint = null;
        if (mpPreference) {
          try {
            const pref = {
              items: items.map((it) => ({
                title: it.name,
                quantity: Number(it.quantity),
                unit_price: Number(it.price),
              })),
              back_urls: {
                success: `${DOMAIN}/success`,
                failure: `${DOMAIN}/failure`,
                pending: `${DOMAIN}/pending`,
              },
              auto_return: "approved",
              external_reference: orderId,
            };
            const prefRes = await mpPreference.create({ body: pref });
            initPoint = prefRes.init_point;
            const o = orders.find((or) => or.id === orderId);
            if (o) o.preference_id = prefRes.id;
            saveOrders(orders);
          } catch (e) {
            console.error("Error MP preference", e);
          }
        }
        return sendJson(res, 201, { orderId, init_point: initPoint });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: obtener lista de pedidos
  // Soporta filtros por estado de pago (payment_status), búsqueda genérica (q),
  // y paginación mediante limit y offset. Devuelve la propiedad total con el
  // número total de filas antes de paginar.
  if (pathname === "/api/orders" && req.method === "GET") {
    try {
      const query = parsedUrl.query || {};
      const includeDeleted =
        query.includeDeleted === "1" || String(query.includeDeleted).toLowerCase() === "true";
      const q = typeof query.q === "string" ? query.q : "";
      const statusParam =
        typeof query.status === "string"
          ? query.status
          : typeof query.payment_status === "string"
          ? query.payment_status
          : "";
      const dateParam =
        typeof query.date === "string" && query.date.trim()
          ? query.date.trim()
          : null;
      const filterDate = dateParam || formatLocalDate(new Date());

      const orders = await ordersRepo.list({
        date: filterDate,
        status: statusParam,
        q,
        includeDeleted,
      });

      const summary = {
        date: filterDate,
        total: orders.length,
        paid: 0,
        pending: 0,
        canceled: 0,
      };

      const items = orders.map((order) => {
        const normalized = normalizeOrder(order);
        const customer =
          ordersRepo.normalizeCustomer(order) ||
          normalized.customer ||
          order.customer ||
          null;
        const shippingAddress =
          ordersRepo.normalizeAddress(order) ||
          order.shipping_address ||
          null;
        const normalizedItems = ordersRepo.getNormalizedItems(order);
        const units = normalizedItems.reduce(
          (acc, it) => acc + Number(it.qty || it.quantity || 0),
          0,
        );
        const totals = computeTotalsSnapshot(order);
        const itemsSummary = normalizedItems
          .map((it) => {
            const name =
              it.name ||
              it.title ||
              it.descripcion ||
              it.product_id ||
              it.sku ||
              "item";
            const qty = it.qty || it.quantity || 0;
            return `${name} x${qty}`;
          })
          .join(", ");
        const paymentCode = mapPaymentStatusCode(
          normalized.payment_status_code ||
            normalized.payment_status ||
            order.payment_status ||
            order.estado_pago ||
            order.status,
        );
        if (paymentCode === "approved") summary.paid += 1;
        else if (paymentCode === "rejected") summary.canceled += 1;
        else summary.pending += 1;
        const paymentStatus = localizePaymentStatus(
          normalized.payment_status ||
            order.payment_status ||
            order.estado_pago ||
            paymentCode,
        );
        const statusValue =
          order.status ||
          normalized.status ||
          normalized.shipping_status ||
          order.shipping_status ||
          order.estado_envio ||
          paymentStatus;
        return {
          id: normalized.id || order.id,
          number:
            normalized.order_number ||
            order.order_number ||
            order.id ||
            order.external_reference ||
            "",
          created_at:
            normalized.created_at ||
            order.created_at ||
            order.fecha ||
            order.date ||
            null,
          customer: customer || null,
          shipping_address: shippingAddress || null,
          items_count: units > 0 ? units : normalizedItems.length,
          totals: {
            ...totals,
            grand_total: totals.grand_total,
          },
          items_summary: itemsSummary,
          payment_status: paymentStatus,
          payment_status_code: paymentCode,
          status: statusValue,
          deleted_at: order.deleted_at || null,
        };
      });

      return sendJson(res, 200, { summary, items });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron obtener los pedidos",
      });
    }
  }

  // API: obtener estado de una orden (ruta de test)
  if (
    pathname.startsWith("/api/orders/test/") &&
    pathname.endsWith("/status") &&
    req.method === "GET"
  ) {
    const id = pathname.split("/")[4];
    try {
      return sendJson(res, 200, getOrderStatus(id));
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "Error al obtener estado" });
    }
  }

  if (pathname.startsWith("/api/orders/") && req.method === "DELETE") {
    const parts = pathname.split("/").filter(Boolean);
    const orderId = parts[2];
    if (!orderId) {
      return sendJson(res, 404, { error: "Pedido no encontrado" });
    }
    try {
      await ordersRepo.softDelete(orderId);
      res.writeHead(204, {
        "Access-Control-Allow-Origin": ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Accept, Content-Type, Authorization, X-Requested-With",
      });
      res.end();
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "No se pudo eliminar el pedido" });
    }
    return;
  }

  // API: obtener estado de una orden
  if (
    pathname.startsWith("/api/orders/") &&
    pathname.endsWith("/status") &&
    req.method === "GET"
  ) {
    const id = pathname.split("/")[3];
    try {
      return sendJson(res, 200, getOrderStatus(id));
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "Error al obtener estado" });
    }
  }

  // API: obtener una orden por ID
  if (pathname.startsWith("/api/orders/") && req.method === "GET") {
    const id = pathname.split("/").pop();
    try {
      const orders = getOrders();
      const order = orders.find(
        (o) =>
          o.id === id || o.order_number === id || o.external_reference === id,
      );
      if (!order) return sendJson(res, 404, { error: "Pedido no encontrado" });
      const normalized = normalizeOrder(order);
      const customer =
        ordersRepo.normalizeCustomer(order) ||
        normalized.customer ||
        normalized.cliente ||
        order.customer ||
        order.cliente ||
        null;
      const shippingAddress =
        ordersRepo.normalizeAddress(order) ||
        normalized.shipping_address ||
        order.shipping_address ||
        null;
      const items = ordersRepo.getNormalizedItems(order);
      return sendJson(res, 200, {
        order: {
          ...normalized,
          customer,
          shipping_address: shippingAddress,
          items,
        },
      });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "Error al obtener pedido" });
    }
  }

  // API: buscar pedido por email y número
  if (pathname === "/api/track-order" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { email, order_number, id } = JSON.parse(body || "{}");
        const searchId = order_number || id;
        const orders = getOrders();
        const order = orders.find((o) => {
          const matchId =
            o.id === searchId ||
            o.order_number === searchId ||
            o.external_reference === searchId;
          const matchEmail =
            (o.user_email &&
              o.user_email.toLowerCase() === String(email).toLowerCase()) ||
            (o.cliente &&
              o.cliente.email &&
              o.cliente.email.toLowerCase() === String(email).toLowerCase()) ||
            (o.customer &&
              o.customer.email &&
              o.customer.email.toLowerCase() === String(email).toLowerCase());
          return matchId && matchEmail;
        });
        if (!order) {
          return sendJson(res, 404, { error: "Pedido no encontrado" });
        }
        const orderData = normalizeOrder(order);
        return sendJson(res, 200, {
          order: orderData,
          orderNumber: orderData.order_number,
          paymentStatus: orderData.payment_status,
          shippingStatus: orderData.shipping_status,
          createdAt: orderData.created_at,
          total: orderData.total,
        });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  if (
    pathname.startsWith("/api/orders/") &&
    pathname.endsWith("/ship") &&
    req.method === "PUT"
  ) {
    const parts = pathname.split("/");
    const orderNumber = parts[3];
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { carrier, tracking_number } = JSON.parse(body || "{}");
        const orders = getOrders();
        const idx = orders.findIndex(
          (o) => o.id === orderNumber || o.order_number === orderNumber,
        );
        if (idx === -1)
          return sendJson(res, 404, { error: "Pedido no encontrado" });
        orders[idx] = {
          ...orders[idx],
          transportista: carrier || orders[idx].transportista,
          seguimiento: tracking_number || orders[idx].seguimiento,
          estado_envio: "enviado",
          shipped_at: new Date().toISOString(),
        };
        saveOrders(orders);
        return sendJson(res, 200, { success: true, order: orders[idx] });
      } catch (e) {
        console.error(e);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  if (
    pathname.startsWith("/api/orders/") &&
    pathname.endsWith("/cancel") &&
    req.method === "PUT"
  ) {
    const parts = pathname.split("/");
    const orderNumber = parts[3];
    const orders = getOrders();
    const idx = orders.findIndex(
      (o) => o.id === orderNumber || o.order_number === orderNumber,
    );
    if (idx === -1)
      return sendJson(res, 404, { error: "Pedido no encontrado" });
    orders[idx].estado_envio = "cancelado";
    orders[idx].cancelled_at = new Date().toISOString();
    saveOrders(orders);
    return sendJson(res, 200, { success: true, order: orders[idx] });
  }

  // API: actualizar pedido por ID (cambiar estado o agregar seguimiento)
  // Ruta esperada: /api/orders/{id}
  if (
    pathname.startsWith("/api/orders/") &&
    (req.method === "PUT" || req.method === "PATCH")
  ) {
    const id = pathname.split("/").pop();
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const update = JSON.parse(body || "{}");
        const orders = getOrders();
        const index = orders.findIndex(
          (o) =>
            o.id === id ||
            o.order_number === id ||
            o.external_reference === id,
        );
        if (index === -1) {
          return sendJson(res, 404, { error: "Pedido no encontrado" });
        }
        if (
          Object.prototype.hasOwnProperty.call(update, "deleted_at") &&
          update.deleted_at === null
        ) {
          try {
            const identifier =
              orders[index].id || orders[index].order_number || id;
            await ordersRepo.restore(identifier);
            orders[index] = { ...orders[index], deleted_at: null };
            saveOrders(orders);
            return sendJson(res, 200, {
              success: true,
              order: orders[index],
            });
          } catch (restoreErr) {
            console.error(restoreErr);
            return sendJson(res, 500, {
              error: "No se pudo restaurar el pedido",
            });
          }
        }
        const prev = { ...orders[index] };
        const incomingStatus =
          update.payment_status ??
          update.estado_pago ??
          update.payment_status_code ??
          null;
        const next = { ...orders[index], ...update };
        if (incomingStatus != null) {
          const normalized = mapPaymentStatusCode(incomingStatus);
          const localized = localizePaymentStatus(incomingStatus);
          next.payment_status_code = normalized;
          next.payment_status = localized;
          next.estado_pago = localized;
        }
        const incomingShippingStatus =
          update.shipping_status ??
          update.shippingStatus ??
          update.estado_envio ??
          null;
        if (incomingShippingStatus != null) {
          const shippingCode = mapShippingStatusCode(incomingShippingStatus);
          const shippingLabel = localizeShippingStatus(incomingShippingStatus);
          next.shipping_status = shippingCode;
          next.shippingStatus = shippingCode;
          next.shipping_status_code = shippingCode;
          next.estado_envio = shippingLabel;
          next.shipping_status_label = shippingLabel;
        }
        if (Object.prototype.hasOwnProperty.call(update, "tracking")) {
          const trackingValue =
            update.tracking == null
              ? ""
              : String(update.tracking).trim();
          next.tracking = trackingValue;
          next.seguimiento = trackingValue;
        }
        if (Object.prototype.hasOwnProperty.call(update, "carrier")) {
          const carrierValue =
            update.carrier == null ? "" : String(update.carrier).trim();
          next.carrier = carrierValue;
          next.transportista = carrierValue;
        }
        if (Object.prototype.hasOwnProperty.call(update, "shipping_note")) {
          const noteValue =
            update.shipping_note == null
              ? ""
              : String(update.shipping_note).trim();
          next.shipping_note = noteValue;
          next.shippingNote = noteValue;
          next.nota_envio = noteValue;
          next.notas_envio = noteValue;
        }
        orders[index] = next;
        saveOrders(orders);
        const prevShippingCode = mapShippingStatusCode(
          prev.shipping_status ?? prev.estado_envio ?? null,
        );
        const nextShippingCode = mapShippingStatusCode(
          next.shipping_status ?? next.estado_envio ?? null,
        );
        if (
          incomingShippingStatus != null &&
          nextShippingCode === "shipped" &&
          prevShippingCode !== "shipped"
        ) {
          sendOrderShippedEmail(orders[index]);
        }
        return sendJson(res, 200, { success: true, order: orders[index] });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: añadir un nuevo producto
  if (pathname === "/api/products" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const newProduct = JSON.parse(body || "{}");
        const products = getProducts();
        // Asignar un ID autoincremental sencillo
        const newId = (
          products.length
            ? Math.max(...products.map((p) => parseInt(p.id, 10))) + 1
            : 1
        ).toString();
        newProduct.id = newId;
        products.push(newProduct);
        saveProducts(products);
        return sendJson(res, 201, { success: true, product: newProduct });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: duplicar producto existente
  if (
    pathname.startsWith("/api/products/") &&
    pathname.endsWith("/duplicate") &&
    req.method === "POST"
  ) {
    const parts = pathname.split("/");
    const id = parts[3];
    try {
      const products = getProducts();
      const original = products.find((p) => p.id === id);
      if (!original) {
        return sendJson(res, 404, { error: "Producto no encontrado" });
      }
      const newId = (
        products.length
          ? Math.max(...products.map((p) => parseInt(p.id, 10))) + 1
          : 1
      ).toString();
      const duplicate = { ...original, id: newId };
      if (duplicate.sku) duplicate.sku = `${duplicate.sku}-copy`;
      duplicate.name = `${duplicate.name} (copia)`;
      products.push(duplicate);
      saveProducts(products);
      return sendJson(res, 201, { success: true, product: duplicate });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "Error al duplicar producto" });
    }
  }

  // API: actualizar producto existente
  if (
    pathname.startsWith("/api/products/") &&
    (req.method === "PUT" || req.method === "PATCH") &&
    !pathname.endsWith("/duplicate")
  ) {
    const id = pathname.split("/").pop();
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        const products = getProducts();
        const index = products.findIndex((p) => p.id === id);
        if (index === -1) {
          return sendJson(res, 404, { error: "Producto no encontrado" });
        }
        products[index] = { ...products[index], ...update, id };
        saveProducts(products);
        return sendJson(res, 200, { success: true, product: products[index] });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: eliminar producto
  if (pathname.startsWith("/api/products/") && req.method === "DELETE") {
    const id = pathname.split("/").pop();
    try {
      const products = getProducts();
      const index = products.findIndex((p) => p.id === id);
      if (index === -1) {
        return sendJson(res, 404, { error: "Producto no encontrado" });
      }
      const removed = products.splice(index, 1)[0];
      saveProducts(products);
      return sendJson(res, 200, { success: true, product: removed });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "Error al eliminar producto" });
    }
  }

  // API: métricas básicas
  if (pathname === "/api/metrics" && req.method === "GET") {
    try {
      const orders = getOrders();
      const salesByMonth = {};
      const productTotals = {};
      orders.forEach((order) => {
        const date = new Date(order.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        (order.productos || []).forEach((item) => {
          const qty = item.quantity;
          // total por mes (suma de cantidad * precio unitario); para simplificar usamos price sin descuento aplicado
          salesByMonth[monthKey] =
            (salesByMonth[monthKey] || 0) + qty * item.price;
          productTotals[item.name] = (productTotals[item.name] || 0) + qty;
        });
      });
      // Crear ranking de productos
      const topProducts = Object.entries(productTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, quantity]) => ({ name, quantity }));
      return sendJson(res, 200, {
        metrics: {
          totalOrders: orders.length,
          salesByMonth,
          topProducts,
        },
      });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron calcular las métricas",
      });
    }
  }

  // API: obtener lista de clientes
  if (pathname === "/api/clients" && req.method === "GET") {
    try {
      const clients = getClients();
      return sendJson(res, 200, { clients });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron obtener los clientes",
      });
    }
  }

  // API: actualizar un cliente (balance, límites, datos fiscales)
  // Ruta: /api/clients/{email}
  if (pathname.startsWith("/api/clients/") && req.method === "PUT") {
    const email = decodeURIComponent(pathname.split("/").pop());
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        const clients = getClients();
        const idx = clients.findIndex((c) => c.email === email);
        if (idx === -1) {
          return sendJson(res, 404, { error: "Cliente no encontrado" });
        }
        clients[idx] = { ...clients[idx], ...update };
        saveClients(clients);
        return sendJson(res, 200, { success: true, client: clients[idx] });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: crear factura para un pedido
  // Ruta: /api/invoices/{orderId}
  if (pathname.startsWith("/api/invoices/") && req.method === "POST") {
    const orderId = decodeURIComponent(pathname.split("/").pop());
    try {
      const orders = getOrders();
      const order = orders.find((o) => o.id === orderId);
      if (!order) {
        return sendJson(res, 404, { error: "Pedido no encontrado" });
      }
      // Buscar si ya existe factura para este pedido
      let invoices = getInvoices();
      let existing = invoices.find((inv) => inv.orderId === orderId);
      if (existing) {
        return sendJson(res, 200, { invoice: existing });
      }
      // Determinar tipo de factura según condición fiscal del cliente
      let type = "B";
      let clientInfo = null;
      if (order.cliente && order.cliente.email) {
        const clients = getClients();
        const client = clients.find((c) => c.email === order.cliente.email);
        if (client) {
          clientInfo = { ...client };
          if (
            client.condicion_iva &&
            client.condicion_iva.toLowerCase().includes("responsable")
          ) {
            type = "A";
          }
        }
      }
      const invoiceNumber = getNextInvoiceNumber();
      const invoice = {
        id: invoiceNumber,
        orderId,
        date: new Date().toISOString(),
        type,
        client: clientInfo,
        items: order.productos,
        total: order.total,
      };
      invoices.push(invoice);
      saveInvoices(invoices);
      return sendJson(res, 201, { invoice });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "No se pudo crear la factura" });
    }
  }

  // API: obtener factura de un pedido
  // Ruta: /api/invoices/{orderId}
  if (pathname.startsWith("/api/invoices/") && req.method === "GET") {
    const orderId = decodeURIComponent(pathname.split("/").pop());
    try {
      const invoices = getInvoices();
      const invoice = invoices.find((inv) => inv.orderId === orderId);
      if (!invoice) {
        return sendJson(res, 404, { error: "Factura no encontrada" });
      }
      return sendJson(res, 200, { invoice });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "No se pudo obtener la factura" });
    }
  }

  // API: subir archivo de factura para un pedido
  // Ruta: /api/invoice-files/{orderId} (POST)
  if (pathname.startsWith("/api/invoice-files/") && req.method === "POST") {
    const orderId = decodeURIComponent(pathname.split("/").pop());
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { fileName, data } = JSON.parse(body || "{}");
        if (!fileName || !data) {
          return sendJson(res, 400, { error: "Falta archivo" });
        }
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const dir = INVOICES_DIR;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `${orderId}-${Date.now()}-${safeName}`);
        fs.writeFileSync(filePath, Buffer.from(data, "base64"));
        const uploads = getInvoiceUploads();
        const existingIdx = uploads.findIndex((u) => u.orderId === orderId);
        const record = {
          orderId,
          fileName: path.basename(filePath),
        };
        if (existingIdx !== -1) uploads[existingIdx] = record;
        else uploads.push(record);
        saveInvoiceUploads(uploads);
        return sendJson(res, 201, { success: true, file: record.fileName });
      } catch (err) {
        console.error(err);
        return sendJson(res, 500, { error: "No se pudo guardar la factura" });
      }
    });
    return;
  }

  // API: obtener archivo de factura de un pedido
  // Ruta: /api/invoice-files/{orderId} (GET)
  if (pathname.startsWith("/api/invoice-files/") && req.method === "GET") {
    const orderId = decodeURIComponent(pathname.split("/").pop());
    try {
      const uploads = getInvoiceUploads();
      const record = uploads.find((u) => u.orderId === orderId);
      if (!record) {
        return sendJson(res, 404, { error: "Factura no encontrada" });
      }
      const urlBase = `/assets/invoices/${encodeURIComponent(record.fileName)}`;
      return sendJson(res, 200, { fileName: record.fileName, url: urlBase });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "No se pudo obtener la factura" });
    }
  }

  // API: crear una solicitud de devolución
  // Ruta: /api/returns (POST)
  if (pathname === "/api/returns" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { orderId, reason, items, customerEmail } = JSON.parse(
          body || "{}",
        );
        if (!orderId || !reason) {
          return sendJson(res, 400, {
            error: "Faltan parámetros para la devolución",
          });
        }
        // Buscar pedido y cliente
        const orders = getOrders();
        const order = orders.find((o) => o.id === orderId);
        if (!order) {
          return sendJson(res, 404, { error: "Pedido no encontrado" });
        }
        // Verificar que el pedido pertenece al cliente (si se suministra) y que fue entregado
        if (
          customerEmail &&
          order.cliente &&
          order.cliente.email !== customerEmail
        ) {
          return sendJson(res, 403, {
            error: "No puedes devolver un pedido que no es tuyo",
          });
        }
        if (order.estado_envio !== "entregado") {
          return sendJson(res, 400, {
            error: "Sólo se pueden devolver pedidos entregados",
          });
        }
        // Verificar si el cliente está bloqueado para devoluciones
        let email = customerEmail;
        if (!email && order.cliente) email = order.cliente.email;
        let clientBlocked = false;
        if (email) {
          const clients = getClients();
          const client = clients.find((c) => c.email === email);
          if (client && client.blockedReturns) {
            clientBlocked = true;
          }
        }
        if (clientBlocked) {
          return sendJson(res, 403, {
            error:
              "Cliente bloqueado para devoluciones por actividades sospechosas",
          });
        }
        // Contar devoluciones existentes para este cliente
        const returns = getReturns();
        const clientReturns = returns.filter((r) => r.customerEmail === email);
        if (clientReturns.length >= 3) {
          // Bloquear al cliente
          const clients = getClients();
          const idx = clients.findIndex((c) => c.email === email);
          if (idx !== -1) {
            clients[idx].blockedReturns = true;
            saveClients(clients);
          }
          return sendJson(res, 403, {
            error: "Cliente bloqueado debido a exceso de devoluciones",
          });
        }
        // Crear ID de devolución
        const returnId =
          "RET-" +
          Date.now().toString(36) +
          "-" +
          Math.floor(Math.random() * 1000);
        const newReturn = {
          id: returnId,
          orderId,
          customerEmail: email || "",
          items: items || order.productos,
          reason,
          status: "pendiente",
          date: new Date().toISOString(),
        };
        returns.push(newReturn);
        saveReturns(returns);
        return sendJson(res, 201, { success: true, returnRequest: newReturn });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: obtener devoluciones (opcional filtro por email)
  if (pathname === "/api/returns" && req.method === "GET") {
    try {
      const query = url.parse(req.url, true).query;
      const returns = getReturns();
      if (query && query.email) {
        const filtered = returns.filter((r) => r.customerEmail === query.email);
        return sendJson(res, 200, { returns: filtered });
      }
      return sendJson(res, 200, { returns });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron obtener las devoluciones",
      });
    }
  }

  // API: actualizar una devolución
  // Ruta: /api/returns/{id} (PUT)
  if (pathname.startsWith("/api/returns/") && req.method === "PUT") {
    const retId = pathname.split("/").pop();
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        const returns = getReturns();
        const idx = returns.findIndex((r) => r.id === retId);
        if (idx === -1) {
          return sendJson(res, 404, { error: "Devolución no encontrada" });
        }
        returns[idx] = { ...returns[idx], ...update };
        saveReturns(returns);
        return sendJson(res, 200, {
          success: true,
          returnRequest: returns[idx],
        });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: obtener configuración general
  if (pathname === "/api/config" && req.method === "GET") {
    try {
      const cfg = getConfig();
      return sendJson(res, 200, cfg);
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudo obtener la configuración",
      });
    }
  }

  // API: actualizar configuración general (solo admin)
  if (pathname === "/api/config" && req.method === "PUT") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        // Obtener la configuración actual y fusionarla con la nueva
        const cfg = getConfig();
        const newCfg = { ...cfg, ...update };
        saveConfig(newCfg);
        return sendJson(res, 200, newCfg);
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  /* =====================================================================
   * API: Proveedores (Suppliers)
   * Los proveedores permiten llevar un registro de los socios comerciales
   * que suministran productos al negocio. Se pueden crear, obtener,
   * actualizar y eliminar proveedores. Cada proveedor cuenta con un ID
   * único (generado automáticamente), un nombre, contacto, dirección,
   * email, teléfono y condiciones de pago.
   */
  // Obtener lista de proveedores
  if (pathname === "/api/suppliers" && req.method === "GET") {
    try {
      const suppliers = getSuppliers();
      return sendJson(res, 200, { suppliers });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron obtener los proveedores",
      });
    }
  }
  // Crear nuevo proveedor
  if (pathname === "/api/suppliers" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const newSup = JSON.parse(body || "{}");
        if (!newSup.name) {
          return sendJson(res, 400, {
            error: "Se requiere el nombre del proveedor",
          });
        }
        const suppliers = getSuppliers();
        // Generar ID incremental
        const newId = suppliers.length
          ? (
              Math.max(...suppliers.map((s) => parseInt(s.id, 10))) + 1
            ).toString()
          : "1";
        newSup.id = newId;
        suppliers.push(newSup);
        saveSuppliers(suppliers);
        return sendJson(res, 201, { success: true, supplier: newSup });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }
  // Actualizar proveedor
  if (pathname.startsWith("/api/suppliers/") && req.method === "PUT") {
    const supId = pathname.split("/").pop();
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        const suppliers = getSuppliers();
        const idx = suppliers.findIndex((s) => s.id === supId);
        if (idx === -1) {
          return sendJson(res, 404, { error: "Proveedor no encontrado" });
        }
        suppliers[idx] = { ...suppliers[idx], ...update, id: supId };
        saveSuppliers(suppliers);
        return sendJson(res, 200, { success: true, supplier: suppliers[idx] });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }
  // Eliminar proveedor
  if (pathname.startsWith("/api/suppliers/") && req.method === "DELETE") {
    const supId = pathname.split("/").pop();
    try {
      const suppliers = getSuppliers();
      const index = suppliers.findIndex((s) => s.id === supId);
      if (index === -1) {
        return sendJson(res, 404, { error: "Proveedor no encontrado" });
      }
      const removed = suppliers.splice(index, 1)[0];
      saveSuppliers(suppliers);
      return sendJson(res, 200, { success: true, supplier: removed });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "Error al eliminar proveedor" });
    }
  }

  /*
   * API: Órdenes de compra (Purchase Orders)
   * Permite generar solicitudes de compra a proveedores para reponer stock.
   * Al cambiar el estado a "recibido", se actualiza automáticamente el
   * inventario de los productos implicados.
   */
  if (pathname === "/api/purchase-orders" && req.method === "GET") {
    try {
      const purchaseOrders = getPurchaseOrders();
      return sendJson(res, 200, { purchaseOrders });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron obtener las órdenes de compra",
      });
    }
  }
  if (pathname === "/api/purchase-orders" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const order = JSON.parse(body || "{}");
        if (
          !order.supplier ||
          !Array.isArray(order.items) ||
          order.items.length === 0
        ) {
          return sendJson(res, 400, {
            error: "Datos incompletos para la orden de compra",
          });
        }
        const orders = getPurchaseOrders();
        const newId = orders.length
          ? (Math.max(...orders.map((o) => parseInt(o.id, 10))) + 1).toString()
          : "1";
        order.id = newId;
        order.date = new Date().toISOString();
        order.status = order.status || "pendiente";
        orders.push(order);
        savePurchaseOrders(orders);
        return sendJson(res, 201, { success: true, purchaseOrder: order });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }
  if (pathname.startsWith("/api/purchase-orders/") && req.method === "PUT") {
    const poId = pathname.split("/").pop();
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        const orders = getPurchaseOrders();
        const idx = orders.findIndex((o) => o.id === poId);
        if (idx === -1) {
          return sendJson(res, 404, { error: "Orden de compra no encontrada" });
        }
        const existing = orders[idx];
        // Si el estado cambia a "recibido" y antes no estaba como recibido,
        // actualizar inventario sumando las cantidades
        const wasReceived = existing.status === "recibido";
        const willBeReceived = update.status === "recibido";
        orders[idx] = { ...existing, ...update, id: poId };
        savePurchaseOrders(orders);
        if (!wasReceived && willBeReceived) {
          // Ajustar inventario de productos
          try {
            const products = getProducts();
            let modified = false;
            existing.items.forEach((item) => {
              const pIdx = products.findIndex(
                (p) => p.sku === item.sku || p.id === item.id,
              );
              if (pIdx !== -1) {
                // Sumar stock global
                if (typeof products[pIdx].stock === "number") {
                  products[pIdx].stock += item.quantity;
                }
                // Sumar a almacén central
                if (!products[pIdx].warehouseStock) {
                  products[pIdx].warehouseStock = { central: item.quantity };
                } else {
                  products[pIdx].warehouseStock.central =
                    (products[pIdx].warehouseStock.central || 0) +
                    item.quantity;
                }
                modified = true;
              }
            });
            if (modified) {
              saveProducts(products);
            }
          } catch (invErr) {
            console.error(
              "Error al actualizar inventario tras orden de compra:",
              invErr,
            );
          }
        }
        return sendJson(res, 200, {
          success: true,
          purchaseOrder: orders[idx],
        });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }
  if (pathname.startsWith("/api/purchase-orders/") && req.method === "DELETE") {
    const poId = pathname.split("/").pop();
    try {
      const orders = getPurchaseOrders();
      const index = orders.findIndex((o) => o.id === poId);
      if (index === -1) {
        return sendJson(res, 404, { error: "Orden de compra no encontrada" });
      }
      const removed = orders.splice(index, 1)[0];
      savePurchaseOrders(orders);
      return sendJson(res, 200, { success: true, purchaseOrder: removed });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "Error al eliminar orden de compra" });
    }
  }

  /*
   * API: Analíticas avanzadas
   * Devuelve métricas más detalladas: ventas por categoría, volumen por producto,
   * devoluciones por producto y clientes con mayor facturación. Útil para
   * análisis profundo y dashboards.
   */
  if (pathname === "/api/analytics/detailed" && req.method === "GET") {
    try {
      const analytics = calculateDetailedAnalytics();
      return sendJson(res, 200, { analytics });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron calcular las analíticas detalladas",
      });
    }
  }

  /*
   * API: Alertas de stock
   * Devuelve productos cuyo stock global esté por debajo de su umbral de
   * seguridad (min_stock). Puede utilizarse para mostrar avisos y generar
   * sugerencias de compra.
   */
  if (pathname === "/api/stock-alerts" && req.method === "GET") {
    try {
      const products = getProducts();
      const low = products.filter((p) => {
        const stock = p.stock || 0;
        const threshold = p.min_stock || 0;
        return stock < threshold;
      });
      return sendJson(res, 200, { alerts: low });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron obtener las alertas de stock",
      });
    }
  }

  // === Integración con Mercado Pago ===
  if (
    (pathname === "/api/mercadopago/preference" ||
      pathname === "/api/mercado-pago/crear-preferencia") &&
    req.method === "POST"
  ) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const { carrito, usuario } = JSON.parse(body || "{}");
        const hasValidItems =
          Array.isArray(carrito) &&
          carrito.length > 0 &&
          carrito.every(
            (i) =>
              i &&
              typeof i.titulo === "string" &&
              i.titulo.trim() !== "" &&
              !isNaN(Number(i.precio)) &&
              Number(i.precio) > 0 &&
              Number.isInteger(Number(i.cantidad)) &&
              Number(i.cantidad) > 0 &&
              (typeof i.currency_id === "undefined" ||
                typeof i.currency_id === "string"),
          );
        if (!hasValidItems) {
          return sendJson(res, 400, {
            error: "Faltan datos en los ítems del carrito",
          });
        }

        const productsList = getProducts();
        const normalize = (s) =>
          String(s || "")
            .normalize("NFD")
            .replace(/[^\w\s-]/g, "")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();

        const items = carrito.map(
          ({ titulo, precio, cantidad, currency_id }) => ({
            title: String(titulo),
            unit_price: Number(precio),
            quantity: Number(cantidad),
            currency_id: currency_id || "ARS",
          }),
        );

        const itemsForOrder = carrito.map(
          ({ titulo, precio, cantidad, id, productId, sku }) => {
            const normTitle = normalize(titulo);
            const prod =
              productsList.find(
                (p) =>
                  normalize(p.id) === normalize(id || productId) ||
                  normalize(p.sku) === normalize(sku) ||
                  normalize(p.name) === normTitle,
              ) || null;
            return {
              id: prod ? String(prod.id) : String(id || productId || ""),
              sku: prod ? String(prod.sku) : String(sku || ""),
              name: titulo,
              price: Number(precio),
              quantity: Number(cantidad),
            };
          },
        );
        const total = itemsForOrder.reduce(
          (t, it) => t + it.price * it.quantity,
          0,
        );
        const itemsSummary = itemsForOrder
          .map((it) => `${it.name} x${it.quantity}`)
          .join(", ");
        const numeroOrden = generarNumeroOrden();
        const now = new Date().toISOString();
        const preferenceBody = {
          items,
          payer: { email: usuario?.email },
          external_reference: numeroOrden,
          back_urls: {
            success: `${DOMAIN}/success`,
            failure: `${DOMAIN}/failure`,
            pending: `${DOMAIN}/pending`,
          },
          auto_return: "approved",
          notification_url: `${DOMAIN}/api/webhooks/mp`,
        };
        console.log("Preferencia enviada a Mercado Pago:", preferenceBody);
        if (!mpPreference) {
          throw new Error("Mercado Pago no está configurado");
        }
        const pref = await mpPreference.create({ body: preferenceBody });
        const prefId = pref.id || pref.body?.id || pref.preference_id;
        console.log("MP preference", prefId, numeroOrden);
        if (prefId) {
          const orders = getOrders();
          const idx = orders.findIndex(
            (o) => o.id === numeroOrden || o.external_reference === numeroOrden,
          );
          if (idx === -1) {
            const pendingCode = mapPaymentStatusCode("pending");
            const pendingLabel = localizePaymentStatus("pending");
            orders.push({
              id: numeroOrden,
              order_number: numeroOrden,
              external_reference: numeroOrden,
              preference_id: prefId,
              payment_status: pendingLabel,
              payment_status_code: pendingCode,
              estado_pago: pendingLabel,
              estado_envio: "pendiente",
              shipping_status: "pendiente",
              user_email: usuario?.email || null,
              cliente: usuario || {},
              productos: itemsForOrder,
              items_summary: itemsSummary,
              total,
              created_at: now,
              fecha: now,
              provincia_envio: usuario?.provincia || "",
              costo_envio: Number(usuario?.costo || usuario?.costo_envio || 0),
              seguimiento: "",
              tracking: "",
              transportista: "",
              carrier: "",
              inventoryApplied: false,
            });
          } else {
            const row = orders[idx];
            row.preference_id = prefId;
            row.external_reference = numeroOrden;
            row.order_number = row.order_number || numeroOrden;
            row.user_email = usuario?.email || row.user_email || null;
            const statusSource =
              row.payment_status || row.estado_pago || row.payment_status_code;
            const normalizedStatus = mapPaymentStatusCode(statusSource);
            row.payment_status_code = normalizedStatus;
            const localizedStatus = localizePaymentStatus(statusSource);
            row.payment_status = localizedStatus;
            row.estado_pago = localizePaymentStatus(
              row.estado_pago || statusSource || normalizedStatus,
            );
            row.estado_envio = row.estado_envio || "pendiente";
            row.shipping_status =
              row.shipping_status || row.estado_envio || "pendiente";
            row.cliente = row.cliente || usuario || {};
            row.productos = itemsForOrder;
            row.items_summary = itemsSummary;
            if (!row.total) row.total = total;
            if (!row.created_at) row.created_at = now;
            row.fecha = row.created_at;
            row.provincia_envio =
              row.provincia_envio || usuario?.provincia || "";
            if (row.costo_envio == null)
              row.costo_envio = Number(
                usuario?.costo || usuario?.costo_envio || 0,
              );
            row.seguimiento = row.seguimiento || "";
            row.tracking = row.tracking || "";
            row.transportista = row.transportista || "";
            row.carrier = row.carrier || "";
          }
          saveOrders(orders);
        }
        console.log("Respuesta completa de Mercado Pago:", pref);
        return sendJson(res, 200, {
          init_point: pref.init_point,
          id: prefId,
          preferenceId: prefId,
          nrn: numeroOrden,
        });
      } catch (err) {
        console.error(err);
        return sendJson(res, 500, {
          error: "Error al crear preferencia de pago",
        });
      }
    });
    return;
  }

  if (pathname === "/api/payments/create-preference" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const itemsSrc = data.cart || data.items || [];
        console.log("Productos recibidos:", itemsSrc);
        if (!Array.isArray(itemsSrc) || itemsSrc.length === 0) {
          return sendJson(res, 400, { error: "Carrito vacío" });
        }
        const items = itemsSrc.map((it) => ({
          title: it.title || it.name,
          quantity: Number(it.quantity) || 1,
          unit_price: Number(it.price || it.unit_price) || 0,
        }));
        const urlBase = DOMAIN;
        const preference = {
          items,
          back_urls: {
            success: `${DOMAIN}/success`,
            pending: `${DOMAIN}/pending`,
            failure: `${DOMAIN}/failure`,
          },
          auto_return: "approved",
        };
        if (!mpPreference) {
          throw new Error("Mercado Pago no está configurado");
        }
        const result = await mpPreference.create({ body: preference });
        return sendJson(res, 200, { preferenceId: result.id });
      } catch (err) {
        console.error(err);
        return sendJson(res, 500, { error: "Error al crear preferencia" });
      }
    });
    return;
  }

  if (pathname === "/create_preference" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const { title, price, quantity } = JSON.parse(body || "{}");
        if (!mpPreference) {
          throw new Error("Mercado Pago no est\xE1 configurado");
        }
        if (
          !title ||
          typeof title !== "string" ||
          isNaN(Number(price)) ||
          Number(price) <= 0 ||
          isNaN(Number(quantity)) ||
          Number(quantity) <= 0
        ) {
          return sendJson(res, 400, { error: "Datos de pago inv\xE1lidos" });
        }
        const urlBase = DOMAIN;
        const preference = {
          items: [
            {
              title,
              unit_price: Number(price),
              quantity: Number(quantity),
            },
          ],
          back_urls: {
            success: `${DOMAIN}/success`,
            failure: `${DOMAIN}/failure`,
            pending: `${DOMAIN}/pending`,
          },
          auto_return: "approved",
        };
        const result = await mpPreference.create({ body: preference });
        return sendJson(res, 200, {
          preferenceId: result.id,
          init_point: result.init_point,
        });
      } catch (error) {
        console.error(error);
        res.writeHead(302, { Location: "/failure" });
        res.end();
        return;
      }
    });
    return;
  }

  if (
    pathname === "/api/mercado-pago/webhook" ||
    pathname === "/api/webhooks/mp"
  ) {
    req.query = parsedUrl.query || {};

    const acknowledge = () => {
      res.writeHead(200, {
        "Access-Control-Allow-Origin": ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Accept, Content-Type, Authorization, X-Requested-With",
      });
      res.end();
    };

    const scheduleProcessing = () => {
      setImmediate(() => {
        Promise.resolve(processNotification(req)).catch((err) => {
          console.error("mp-webhook process fail", err?.message);
        });
      });
    };

    if (req.method === "POST") {
      parseBody(req).then(() => {
        if (!req.body || typeof req.body !== "object") {
          req.body = {};
        }
        try {
          req.body = validateWebhook(req.body);
        } catch (e) {
          res.writeHead(400, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": ORIGIN,
          });
          res.end(JSON.stringify({ error: "Invalid payload" }));
          return;
        }

        const topic = req.query.topic || req.body.topic || req.body.type || null;
        const id =
          req.query.id ||
          req.body.id ||
          req.body.payment_id ||
          (req.body.data && req.body.data.id) ||
          null;

        console.log("mp-webhook recibido:", { topic, id });

        acknowledge();
        scheduleProcessing();
      });
      return;
    }

    if (req.method === "GET") {
      req.body = {};
      const topic = req.query.topic || null;
      let id = req.query.id || null;
      if (!id && req.query.resource) {
        const parts = String(req.query.resource).split("/");
        id = parts[parts.length - 1] || null;
      }
      console.log("mp-webhook recibido:", { topic, id });
      acknowledge();
      scheduleProcessing();
      return;
    }
  }

  if (pathname === "/api/webhooks/mp/test" && req.method === "POST") {
    parseBody(req).then(() => {
      console.log("mp-webhook TEST", req.body);
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  // === Integración con AFIP (facturación electrónica) ===
  if (pathname === "/api/afip/invoice" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const afip = new Afip({
          CUIT: CONFIG.afipCUIT,
          cert: CONFIG.afipCert,
          key: CONFIG.afipKey,
        });
        const response = await afip.ElectronicBilling.createVoucher(data);
        return sendJson(res, 200, { afip: response });
      } catch (err) {
        console.error(err);
        return sendJson(res, 500, {
          error: "Error al generar factura con AFIP",
        });
      }
    });
    return;
  }

  // === Integración con Andreani (envíos) ===
  if (pathname === "/api/shipping/andreani" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const shipment = JSON.parse(body || "{}");
        // Aquí se integraría con el servicio real de Andreani
        // Actualmente se devuelve una respuesta simulada
        const tracking = "AND-" + Date.now();
        return sendJson(res, 200, { tracking });
      } catch (err) {
        console.error(err);
        return sendJson(res, 500, { error: "Error al generar envío" });
      }
    });
    return;
  }

  // Páginas de resultado de pago de Mercado Pago
  if (pathname === "/success") {
    return serveStatic(path.join(__dirname, "../frontend/success.html"), res, {
      "Cache-Control": "no-store",
    });
  }
  if (pathname === "/failure") {
    return serveStatic(path.join(__dirname, "../frontend/failure.html"), res, {
      "Cache-Control": "no-store",
    });
  }
  if (pathname === "/pending") {
    return serveStatic(path.join(__dirname, "../frontend/pending.html"), res, {
      "Cache-Control": "no-store",
    });
  }

  if (pathname === "/seguimiento" || pathname === "/seguimiento-pedido") {
    return serveStatic(
      path.join(__dirname, "../frontend/seguimiento.html"),
      res,
    );
  }

  // === Archivos estáticos persistentes ===
  // 1) Facturas de pedidos (PDF/XML) guardadas en el disco persistente.
  //    La ruta pública es /assets/invoices/<nombre de archivo>. Se sirve
  //    directamente desde INVOICES_DIR para que los archivos sobrevivan a
  //    desplegues. Se controla que el path esté dentro del directorio.
  if (pathname.startsWith("/assets/invoices/") && req.method === "GET") {
    const file = decodeURIComponent(pathname.replace("/assets/invoices/", ""));
    const abs = path.join(INVOICES_DIR, file);
    // Validar que la ruta no salga del directorio de facturas
    if (!abs.startsWith(INVOICES_DIR)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }
    fs.stat(abs, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Access-Control-Allow-Origin": ORIGIN,
      });
      fs.createReadStream(abs).pipe(res);
    });
    return;
  }

  // 2) Archivos subidos de forma genérica.
  //    Se acceden vía /uploads/<nombre>. Se sirven desde UPLOADS_DIR.
  if (pathname.startsWith("/uploads/") && req.method === "GET") {
    const file = decodeURIComponent(pathname.replace("/uploads/", ""));
    const abs = path.join(UPLOADS_DIR, file);
    if (!abs.startsWith(UPLOADS_DIR)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }
    fs.stat(abs, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Access-Control-Allow-Origin": ORIGIN,
      });
      fs.createReadStream(abs).pipe(res);
    });
    return;
  }

  // 3) Imágenes de productos subidas por el administrador.
  //    La ruta pública es /assets/uploads/products/<nombre de imagen>.
  //    Estas imágenes se guardan en PRODUCT_UPLOADS_DIR para persistir entre
  //    despliegues. Se calcula el tipo MIME básico según la extensión.
  if (pathname.startsWith("/assets/uploads/products/") && req.method === "GET") {
    const file = decodeURIComponent(pathname.replace("/assets/uploads/products/", ""));
    const abs = path.join(PRODUCT_UPLOADS_DIR, file);
    if (!abs.startsWith(PRODUCT_UPLOADS_DIR)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }
    fs.stat(abs, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(abs).toLowerCase();
      const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
        : ext === ".png" ? "image/png"
        : "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": mime,
        "Access-Control-Allow-Origin": ORIGIN,
        "Cache-Control": "public, max-age=86400",
      });
      fs.createReadStream(abs).pipe(res);
    });
    return;
  }

  // SSR de productos
  if (pathname.startsWith("/p/") && req.method === "GET") {
    // Decodificar slug con guardas para evitar URIError (e.g. /p/%E0)
    let raw = pathname.slice(3);
    if (raw.endsWith("/")) raw = raw.slice(0, -1);
    let slug;
    try {
      slug = decodeURIComponent(raw);
    } catch (e) {
      const html = '<!DOCTYPE html><html lang="es"><head>' +
        '<meta charset="utf-8"><meta name="robots" content="noindex">' +
        '<title>Solicitud inválida</title></head>' +
        '<body><h1>Solicitud inválida</h1></body></html>';
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    const products = await loadProducts();
    const product = Array.isArray(products)
      ? products.find((p) => p.slug === slug)
      : null;
    if (!product) {
      const html =
        "<!DOCTYPE html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex\"><title>Producto no encontrado</title></head><body><h1>Producto no encontrado</h1></body></html>";
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    const name = product.name || "";
    const desc =
      product.meta_description || product.description || `Compra ${name}`;
    const canonical = `${BASE_URL}/p/${slug}`;
    const image = product.image
      ? new URL(product.image, BASE_URL).href
      : null;
    const ld = {
      "@context": "https://schema.org",
      "@type": "Product",
      name,
      ...(product.description ? { description: product.description } : {}),
      ...(product.sku ? { sku: product.sku } : {}),
      ...(product.mpn ? { mpn: product.mpn } : {}),
      ...(product.gtin13 ? { gtin13: product.gtin13 } : {}),
      brand: { "@type": "Brand", name: product.brand || "Samsung" },
      offers: {
        "@type": "Offer",
        priceCurrency: "ARS",
        price:
          product.price ||
          product.price_minorista ||
          product.price_mayorista ||
          0,
        availability: "https://schema.org/InStock",
        url: canonical,
      },
    };
    const head = [
      '<meta charset="utf-8">',
      `<title>${esc(name)}</title>`,
      `<meta name="description" content="${esc(desc)}">`,
      `<link rel="canonical" href="${esc(canonical)}">`,
      `<meta property="og:title" content="${esc(name)}">`,
      `<meta property="og:description" content="${esc(desc)}">`,
      `<meta property="og:url" content="${esc(canonical)}">`,
      '<meta property="og:type" content="product">',
      image ? `<meta property="og:image" content="${esc(image)}">` : "",
      `<script type="application/ld+json">${safeJsonForScript(ld)}</script>`,
    ]
      .filter(Boolean)
      .join("");
    const body = `<h1>${esc(name)}</h1><div>Precio: $${esc(
      product.price || product.price_minorista || product.price_mayorista || ""
    )}</div><div>${product.stock > 0 ? "En stock" : "Sin stock"}</div>`;
    const html = `<!DOCTYPE html><html lang="es"><head>${head}</head><body>${body}</body></html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // Servir componentes del frontend: /components/* -> /frontend/components/*
  if (pathname.startsWith("/components/") && req.method === "GET") {
    const compPath = path.join(__dirname, "..", "frontend", pathname.slice(1));
    if (!fs.existsSync(compPath) || fs.statSync(compPath).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(compPath).toLowerCase();
    const mime =
      ext === ".css"
        ? "text/css"
        : ext === ".js"
          ? "application/javascript"
          : ext === ".html"
            ? "text/html"
            : "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=600",
    });
    fs.createReadStream(compPath).pipe(res);
    return;
  }

  // Servir archivos estáticos del frontend y assets
  let filePath;
  // Servir recursos dentro de /assets (imágenes)
  if (pathname.startsWith("/assets/")) {
    // Eliminar la barra inicial para evitar que path.join ignore los segmentos anteriores
    filePath = path.join(__dirname, "..", pathname.slice(1));
  } else {
    filePath = path.join(__dirname, "../frontend", pathname);
  }
  // Si la ruta es directorio o no existe, servir index.html (SPA fallback)
  fs.stat(filePath, (err, stats) => {
    if (err || stats.isDirectory()) {
      filePath = path.join(__dirname, "../frontend/index.html");
    }
    serveStatic(filePath, res);
  });
}

function createServer() {
  return http.createServer(requestHandler);
}

module.exports = { createServer };

if (require.main === module) {
  const server = createServer();
  server.listen(APP_PORT, () => {
    console.log(`Servidor de NERIN corriendo en http://localhost:${APP_PORT}`);
  });
}
