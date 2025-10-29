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
const fsp = fs.promises;
const path = require("path");
const url = require("url");
const crypto = require("crypto");
const { createProxyMiddleware } = require("http-proxy-middleware");
const dataDirUtils = require("./utils/dataDir");
const {
  sendEmail,
  sendOrderPreparing,
  sendOrderShipped,
  sendOrderDelivered,
  sendInvoiceUploaded,
  sendWholesaleVerificationEmail,
  sendWholesaleApplicationReceived,
  sendWholesaleInternalNotification,
} = require("./services/emailNotifications");
const {
  STATUS_ES_TO_CODE,
  mapPaymentStatusCode,
  localizePaymentStatus,
} = require("./utils/paymentStatus");
const {
  mapShippingStatusCode,
  localizeShippingStatus,
  normalizeShipping,
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
const DEFAULT_LOCAL_DATA_DIR = path.join(__dirname, "data");
const resolvedDataDir = dataDirUtils?.DATA_DIR || DEFAULT_LOCAL_DATA_DIR;
const dataPath =
  typeof dataDirUtils?.dataPath === "function"
    ? dataDirUtils.dataPath
    : (file) => path.join(resolvedDataDir, file);
const DATA_DIR_SOURCE = dataDirUtils?.DATA_SOURCE ||
  (resolvedDataDir === DEFAULT_LOCAL_DATA_DIR
    ? { type: "local", value: resolvedDataDir }
    : { type: "custom", value: resolvedDataDir });
const IS_DATA_DIR_PERSISTENT =
  typeof dataDirUtils?.IS_PERSISTENT === "boolean"
    ? dataDirUtils.IS_PERSISTENT
    : DATA_DIR_SOURCE.type !== "local";

const DATA_DIR = resolvedDataDir;
const DATA_SOURCE_LABEL = (() => {
  switch (DATA_DIR_SOURCE.type) {
    case "env":
      return `variable de entorno (${DATA_DIR_SOURCE.value})`;
    case "render":
      return `Render Disk (${DATA_DIR_SOURCE.value})`;
    case "custom":
      return `directorio configurado (${DATA_DIR_SOURCE.value})`;
    default:
      return `carpeta local del repo (${DATA_DIR_SOURCE.value})`;
  }
})();

if (process.env.NODE_ENV !== "test") {
  console.log(
    `[NERIN] Directorio de datos: ${DATA_DIR} (${IS_DATA_DIR_PERSISTENT ? "persistente" : "local"}) – ${DATA_SOURCE_LABEL}`,
  );
  if (!IS_DATA_DIR_PERSISTENT) {
    console.warn(
      "[NERIN] ⚠️ No se detectó un Render Disk persistente. Configurá un disco y seteá DATA_DIR o montá /var/data para conservar la información tras cada deploy.",
    );
  }
}
const BASE_URL = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
const PRODUCTS_TTL = parseInt(process.env.PRODUCTS_TTL_MS, 10) || 60000;

let _cache = { t: 0, data: null };

function normalizeBaseUrl(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const normalized = new URL(value.trim());
    normalized.hash = "";
    return normalized.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

const FALLBACK_BASE_URL = normalizeBaseUrl(BASE_URL) || BASE_URL;

function getPublicBaseUrl(cfg) {
  if (cfg && typeof cfg.publicUrl === "string") {
    const fromConfig = normalizeBaseUrl(cfg.publicUrl);
    if (fromConfig) return fromConfig;
  }
  const fromEnv = normalizeBaseUrl(process.env.PUBLIC_URL);
  if (fromEnv) return fromEnv;
  return FALLBACK_BASE_URL;
}

function safeParseMetadata(meta) {
  if (!meta) return {};
  if (typeof meta === "object") {
    try {
      return meta == null ? {} : { ...meta };
    } catch {
      return {};
    }
  }
  try {
    return JSON.parse(meta) || {};
  } catch {
    return {};
  }
}

function normalizeProductImages(product) {
  if (!product) return product;
  const copy = { ...product };
  const meta = safeParseMetadata(copy.metadata);
  const fromField = Array.isArray(copy.images)
    ? copy.images.filter(Boolean)
    : [];
  const fromMeta = Array.isArray(meta.images) ? meta.images.filter(Boolean) : [];
  const images = fromField.length ? fromField : fromMeta;
  const alt = Array.isArray(copy.images_alt)
    ? copy.images_alt
    : Array.isArray(meta.images_alt)
    ? meta.images_alt
    : [];
  if (images.length) {
    copy.images = images;
    if (!copy.image) {
      copy.image = images[0];
    }
  } else if (copy.image) {
    copy.images = [copy.image];
  }
  if (alt.length) {
    copy.images_alt = alt;
  }
  const hasMeta = Object.keys(meta).length > 0;
  copy.metadata = hasMeta ? meta : undefined;
  return copy;
}

function normalizeProductsList(products) {
  return Array.isArray(products)
    ? products.map((p) => normalizeProductImages(p))
    : [];
}

function normalizeTextInput(value) {
  if (value == null) return "";
  try {
    const trimmed = String(value).trim();
    return trimmed || "";
  } catch (err) {
    return "";
  }
}

function normalizeEmailInput(value) {
  const text = normalizeTextInput(value);
  return text ? text.toLowerCase() : "";
}

function escapeHtml(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const WHOLESALE_ALLOWED_STATUSES = new Set([
  "code_sent",
  "pending_review",
  "waiting_documents",
  "approved",
  "rejected",
  "archived",
]);

function generateWholesaleId() {
  if (typeof crypto.randomUUID === "function") {
    return `whr_${crypto.randomUUID()}`;
  }
  return `whr_${crypto.randomBytes(8).toString("hex")}`;
}

function generateHistoryId() {
  if (typeof crypto.randomUUID === "function") {
    return `hst_${crypto.randomUUID()}`;
  }
  return `hst_${crypto.randomBytes(8).toString("hex")}`;
}

function generateDocumentId() {
  if (typeof crypto.randomUUID === "function") {
    return `doc_${crypto.randomUUID()}`;
  }
  return `doc_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizeWholesaleHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const copy = { ...entry };
  let changed = false;
  if (!copy.id) {
    copy.id = generateHistoryId();
    changed = true;
  }
  copy.action = normalizeTextInput(copy.action) || "note";
  copy.at = copy.at && !Number.isNaN(Date.parse(copy.at))
    ? copy.at
    : new Date().toISOString();
  if (copy.by && typeof copy.by === "object") {
    copy.by = {
      name: normalizeTextInput(copy.by.name) || undefined,
      email: normalizeEmailInput(copy.by.email) || undefined,
    };
  } else if (copy.by) {
    copy.by = { name: normalizeTextInput(copy.by) };
  }
  if (copy.note != null) {
    copy.note = normalizeTextInput(copy.note);
  }
  if (copy.status && !WHOLESALE_ALLOWED_STATUSES.has(copy.status)) {
    delete copy.status;
    changed = true;
  }
  if (copy.meta && typeof copy.meta === "object") {
    copy.meta = Object.entries(copy.meta).reduce((acc, [key, value]) => {
      acc[key] = normalizeTextInput(value);
      return acc;
    }, {});
  }
  return { entry: copy, changed };
}

function normalizeWholesaleDocumentEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const copy = { ...entry };
  let changed = false;
  if (!copy.id) {
    copy.id = generateDocumentId();
    changed = true;
  }
  copy.label = normalizeTextInput(copy.label);
  copy.filename = normalizeTextInput(copy.filename);
  copy.originalName = normalizeTextInput(copy.originalName || copy.label);
  copy.url = normalizeTextInput(copy.url);
  copy.mimetype = normalizeTextInput(copy.mimetype);
  copy.uploadedAt =
    copy.uploadedAt && !Number.isNaN(Date.parse(copy.uploadedAt))
      ? copy.uploadedAt
      : new Date().toISOString();
  if (copy.uploadedBy && typeof copy.uploadedBy === "object") {
    copy.uploadedBy = {
      name: normalizeTextInput(copy.uploadedBy.name) || undefined,
      email: normalizeEmailInput(copy.uploadedBy.email) || undefined,
    };
  } else if (copy.uploadedBy) {
    copy.uploadedBy = { name: normalizeTextInput(copy.uploadedBy) };
  }
  const sizeNumber = Number(copy.size);
  copy.size = Number.isFinite(sizeNumber) && sizeNumber >= 0 ? sizeNumber : 0;
  return { document: copy, changed };
}

function normalizeWholesaleRequestEntry(entry) {
  const nowIso = new Date().toISOString();
  const source = entry && typeof entry === "object" ? entry : {};
  const copy = { ...source };
  let changed = false;

  if (!copy.id) {
    copy.id = generateWholesaleId();
    changed = true;
  }

  copy.email = normalizeEmailInput(copy.email);
  copy.legalName = normalizeTextInput(copy.legalName);
  copy.taxId = normalizeTextInput(copy.taxId);
  copy.contactName = normalizeTextInput(copy.contactName);
  copy.phone = normalizeTextInput(copy.phone);
  copy.province = normalizeTextInput(copy.province);
  copy.website = normalizeTextInput(copy.website);
  copy.companyType = normalizeTextInput(copy.companyType);
  copy.salesChannel = normalizeTextInput(copy.salesChannel);
  copy.monthlyVolume = normalizeTextInput(copy.monthlyVolume);
  copy.systems = normalizeTextInput(copy.systems);
  copy.afipUrl = normalizeTextInput(copy.afipUrl);
  copy.notes = normalizeTextInput(copy.notes);
  copy.internalNotes = normalizeTextInput(copy.internalNotes);
  copy.assignedTo = normalizeTextInput(copy.assignedTo);

  const status = normalizeTextInput(copy.status) || "pending_review";
  if (!WHOLESALE_ALLOWED_STATUSES.has(status)) {
    copy.status = "pending_review";
    changed = true;
  } else {
    copy.status = status;
  }

  copy.createdAt =
    copy.createdAt && !Number.isNaN(Date.parse(copy.createdAt))
      ? copy.createdAt
      : nowIso;
  copy.updatedAt =
    copy.updatedAt && !Number.isNaN(Date.parse(copy.updatedAt))
      ? copy.updatedAt
      : copy.createdAt;
  copy.submittedAt =
    copy.submittedAt && !Number.isNaN(Date.parse(copy.submittedAt))
      ? copy.submittedAt
      : copy.createdAt;

  const docs = Array.isArray(copy.documents) ? copy.documents : [];
  const normalizedDocs = [];
  let docsChanged = false;
  for (const doc of docs) {
    const normalized = normalizeWholesaleDocumentEntry(doc);
    if (normalized) {
      normalizedDocs.push(normalized.document);
      if (normalized.changed) docsChanged = true;
    } else {
      docsChanged = true;
    }
  }
  if (docsChanged || normalizedDocs.length !== docs.length) {
    changed = true;
  }
  copy.documents = normalizedDocs;

  const history = Array.isArray(copy.history) ? copy.history : [];
  const normalizedHistory = [];
  let historyChanged = false;
  for (const item of history) {
    const normalized = normalizeWholesaleHistoryEntry(item);
    if (normalized) {
      normalizedHistory.push(normalized.entry);
      if (normalized.changed) historyChanged = true;
    } else {
      historyChanged = true;
    }
  }
  normalizedHistory.sort((a, b) => {
    const tA = Date.parse(a.at || nowIso) || 0;
    const tB = Date.parse(b.at || nowIso) || 0;
    return tA - tB;
  });
  if (historyChanged || normalizedHistory.length !== history.length) {
    changed = true;
  }
  copy.history = normalizedHistory;

  const tags = Array.isArray(copy.tags) ? copy.tags : [];
  const normalizedTags = Array.from(
    new Set(
      tags
        .map((tag) => normalizeTextInput(tag))
        .filter((tag) => tag && tag.length <= 40),
    ),
  );
  if (normalizedTags.length !== tags.length) {
    changed = true;
  }
  copy.tags = normalizedTags;

  if (!copy.verification || typeof copy.verification !== "object") {
    copy.verification = {};
    changed = true;
  } else {
    copy.verification = {
      code: copy.verification.code || undefined,
      sentAt: copy.verification.sentAt,
      expiresAt: copy.verification.expiresAt,
      confirmed: Boolean(copy.verification.confirmed),
      confirmedAt: copy.verification.confirmedAt,
    };
  }

  if (!copy.review) {
    copy.review = {};
  } else if (typeof copy.review === "object") {
    copy.review = {
      decisionNote: normalizeTextInput(copy.review.decisionNote),
      decidedAt: copy.review.decidedAt,
      decidedBy: copy.review.decidedBy,
    };
  }

  return { record: copy, changed };
}

function sanitizeWholesaleRequestForResponse(request) {
  if (!request || typeof request !== "object") return {};
  const sanitized = JSON.parse(JSON.stringify(request));
  if (sanitized.verification) {
    delete sanitized.verification.code;
  }
  return sanitized;
}

function createWholesaleRequestSeed(payload = {}) {
  const nowIso = new Date().toISOString();
  const createdAt =
    payload.createdAt && !Number.isNaN(Date.parse(payload.createdAt))
      ? payload.createdAt
      : nowIso;
  const submittedAt =
    payload.submittedAt && !Number.isNaN(Date.parse(payload.submittedAt))
      ? payload.submittedAt
      : createdAt;
  const base = {
    id: generateWholesaleId(),
    email: normalizeEmailInput(payload.email),
    legalName: normalizeTextInput(payload.legalName),
    contactName: normalizeTextInput(payload.contactName),
    phone: normalizeTextInput(payload.phone),
    taxId: normalizeTextInput(payload.taxId),
    province: normalizeTextInput(payload.province),
    website: normalizeTextInput(payload.website),
    companyType: normalizeTextInput(payload.companyType),
    salesChannel: normalizeTextInput(payload.salesChannel),
    monthlyVolume: normalizeTextInput(payload.monthlyVolume),
    systems: normalizeTextInput(payload.systems),
    afipUrl: normalizeTextInput(payload.afipUrl),
    notes: normalizeTextInput(payload.notes),
    createdAt,
    updatedAt:
      payload.updatedAt && !Number.isNaN(Date.parse(payload.updatedAt))
        ? payload.updatedAt
        : nowIso,
    submittedAt,
    status: payload.status || "pending_review",
    documents: Array.isArray(payload.documents) ? payload.documents : [],
    history: Array.isArray(payload.history) ? payload.history : [],
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    verification:
      payload.verification && typeof payload.verification === "object"
        ? { ...payload.verification }
        : {},
    internalNotes: normalizeTextInput(payload.internalNotes),
    assignedTo: normalizeTextInput(payload.assignedTo),
    review:
      payload.review && typeof payload.review === "object"
        ? { ...payload.review }
        : {},
  };
  return normalizeWholesaleRequestEntry(base).record;
}

function generateTempPassword() {
  let candidate = crypto.randomBytes(12).toString("base64");
  candidate = candidate.replace(/[^a-zA-Z0-9]/g, "");
  if (candidate.length < 10) {
    candidate += crypto.randomBytes(6).toString("hex");
  }
  return candidate.slice(0, 12);
}

function defaultWholesaleEmailSubject(status) {
  switch (status) {
    case "approved":
      return "Cuenta mayorista aprobada – NERIN Parts";
    case "waiting_documents":
      return "Información adicional requerida para tu solicitud mayorista";
    case "rejected":
      return "Actualización sobre tu solicitud mayorista";
    default:
      return "Actualización de tu solicitud mayorista";
  }
}

function defaultWholesaleEmailBody(status, request, message, credentials) {
  const lines = [];
  const greeting = request.contactName
    ? `Hola ${escapeHtml(request.contactName)},`
    : "Hola,";
  lines.push(`<p>${greeting}</p>`);
  const custom = message ? escapeHtml(message).replace(/\n/g, "<br />") : null;
  if (custom) {
    lines.push(`<p>${custom}</p>`);
  } else {
    if (status === "approved") {
      lines.push(
        "<p>¡Buenas noticias! Tu cuenta mayorista fue aprobada y ya podés acceder a nuestra lista de precios exclusiva.</p>",
      );
    } else if (status === "waiting_documents") {
      lines.push(
        "<p>Para continuar necesitamos documentación adicional. Respondé este correo adjuntando la constancia solicitada o indicanos cómo prefieres compartirla.</p>",
      );
    } else if (status === "rejected") {
      lines.push(
        "<p>En esta instancia no podemos habilitar la cuenta mayorista. Si contás con más información que ayude a la validación, por favor respondenos este mensaje.</p>",
      );
    } else {
      lines.push(
        "<p>Tenemos novedades sobre tu solicitud mayorista. Respondé este correo si necesitás más información.</p>",
      );
    }
  }

  if (status === "approved") {
    lines.push(
      "<p>Ingresá a <a href=\"https://nerin.com.ar/login.html\">nerin.com.ar/login</a> con tu correo registrado para ver precios mayoristas y realizar pedidos.</p>",
    );
  }

  if (credentials && credentials.tempPassword) {
    lines.push(
      `<p>Tu clave provisoria es: <strong>${escapeHtml(
        credentials.tempPassword,
      )}</strong>. Te recomendamos cambiarla luego de iniciar sesión.</p>`,
    );
  }

  lines.push("<p>Gracias por confiar en NERIN Parts.</p>");
  return lines.join("\n");
}

const PRODUCT_TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "frontend",
  "product.html",
);
let PRODUCT_TEMPLATE_CACHE = null;

function getProductTemplateParts() {
  if (PRODUCT_TEMPLATE_CACHE) return PRODUCT_TEMPLATE_CACHE;
  try {
    const template = fs.readFileSync(PRODUCT_TEMPLATE_PATH, "utf8");
    const headMatch = template.match(/<head>([\s\S]*?)<\/head>/i);
    const rawHead = headMatch ? headMatch[1] : "";
    const baseHead = rawHead
      .replace(/<title>[\s\S]*?<\/title>/i, "")
      .replace(/<meta[^>]+data-product-meta[^>]*>\s*/gi, "")
      .replace(/<link[^>]+data-product-meta[^>]*>\s*/gi, "")
      .replace(/<script[^>]+data-product-breadcrumbs[^>]*>[\s\S]*?<\/script>\s*/gi, "")
      .replace(/<meta[^>]+name=["']twitter:card["'][^>]*>\s*/gi, "");
    const bodyMatch = template.match(/<body[\s\S]*<\/body>/i);
    const body = bodyMatch
      ? bodyMatch[0]
      : '<body><main class="product-page container" id="productDetail"></main></body>';
    PRODUCT_TEMPLATE_CACHE = { head: baseHead, body };
  } catch (err) {
    console.error("No se pudo cargar la plantilla de producto", err);
    PRODUCT_TEMPLATE_CACHE = {
      head: "",
      body:
        '<body><main class="product-page container" id="productDetail"></main></body>',
    };
  }
  return PRODUCT_TEMPLATE_CACHE;
}

async function loadProducts() {
  const now = Date.now();
  if (_cache.data && now - _cache.t < PRODUCTS_TTL) return _cache.data;
  const p = typeof dataPath === 'function'
    ? dataPath('products.json')
    : path.join(DATA_DIR, 'products.json');
  try {
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(json?.products) ? json.products : json;
    const normalized = normalizeProductsList(arr);
    _cache = { t: now, data: normalized };
    return normalized;
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

function absoluteUrl(input, base) {
  if (!input) return null;
  const siteBase = normalizeBaseUrl(base) || FALLBACK_BASE_URL;
  try {
    return new URL(input, siteBase).href;
  } catch {
    return null;
  }
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isProductPublic(product) {
  if (!product) return false;
  const visibility =
    typeof product.visibility === "string"
      ? product.visibility.trim().toLowerCase()
      : "";
  if (visibility && visibility !== "public") return false;
  if (product.vip_only) return false;
  if (product.enabled === false) return false;
  const status =
    typeof product.status === "string"
      ? product.status.trim().toLowerCase()
      : "";
  if (status === "draft" || status === "archived") return false;
  return Boolean(
    (typeof product.slug === "string" && product.slug.trim()) ||
      (typeof product.id === "string" && product.id.trim()) ||
      typeof product.id === "number",
  );
}

function getProductLastModifiedDate(product) {
  if (!product) return null;
  const rawDate =
    product.updated_at ||
    product.updatedAt ||
    product.lastModified ||
    product.lastmod ||
    product.updated ||
    product.modified ||
    product.created_at;
  if (!rawDate) return null;
  const parsed = rawDate instanceof Date ? rawDate : new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function buildSitemapXml(baseUrl, products = []) {
  const siteBase = normalizeBaseUrl(baseUrl) || FALLBACK_BASE_URL;
  const generatedAt = toIsoString(new Date());
  const toAbsolute = (pathSegment) => absoluteUrl(pathSegment, siteBase);
  const staticPages = [
    { path: "/", changefreq: "weekly", priority: "1.0" },
    { path: "/shop.html", changefreq: "daily", priority: "0.9" },
    { path: "/contact.html", changefreq: "monthly", priority: "0.5" },
    { path: "/seguimiento.html", changefreq: "weekly", priority: "0.4" },
    { path: "/cart.html", changefreq: "weekly", priority: "0.3" },
    { path: "/checkout.html", changefreq: "weekly", priority: "0.5" },
    { path: "/login.html", changefreq: "monthly", priority: "0.3" },
    { path: "/register.html", changefreq: "monthly", priority: "0.3" },
  ];

  const urls = staticPages
    .map((entry) => ({
      loc: toAbsolute(entry.path),
      changefreq: entry.changefreq,
      priority: entry.priority,
      lastmod: generatedAt,
    }))
    .filter((entry) => Boolean(entry.loc));

  const productUrls = products
    .filter((product) => isProductPublic(product))
    .map((product) => {
      const slug =
        typeof product.slug === "string" && product.slug.trim()
          ? product.slug.trim()
          : null;
      const pathSegment = slug
        ? `/p/${encodeURIComponent(slug)}`
        : `/product.html?id=${encodeURIComponent(String(product.id))}`;
      const lastModifiedDate = getProductLastModifiedDate(product);
      const lastmod = toIsoString(lastModifiedDate) || generatedAt;
      return {
        loc: toAbsolute(pathSegment),
        changefreq: "weekly",
        priority: "0.8",
        lastmod,
      };
    })
    .filter((entry) => Boolean(entry.loc));

  const categoryMap = new Map();
  for (const product of products) {
    if (!isProductPublic(product)) continue;
    const name =
      typeof product.category === "string" ? product.category.trim() : "";
    if (!name) continue;
    const key = name.toLowerCase();
    const lastModifiedDate = getProductLastModifiedDate(product);
    const existing = categoryMap.get(key);
    if (!existing) {
      categoryMap.set(key, {
        name,
        lastModifiedDate: lastModifiedDate || null,
      });
    } else if (lastModifiedDate) {
      if (
        !existing.lastModifiedDate ||
        existing.lastModifiedDate.getTime() < lastModifiedDate.getTime()
      ) {
        existing.lastModifiedDate = lastModifiedDate;
      }
    }
  }

  const categoryUrls = Array.from(categoryMap.values())
    .map(({ name, lastModifiedDate }) => {
      const pathSegment = `/shop.html?category=${encodeURIComponent(name)}`;
      const lastmod = toIsoString(lastModifiedDate) || generatedAt;
      return {
        loc: toAbsolute(pathSegment),
        changefreq: "weekly",
        priority: "0.6",
        lastmod,
      };
    })
    .filter((entry) => Boolean(entry.loc));

  const serialize = ({ loc, lastmod, changefreq, priority }) => {
    const segments = [`<loc>${esc(loc)}</loc>`];
    if (lastmod) segments.push(`<lastmod>${lastmod}</lastmod>`);
    if (changefreq) segments.push(`<changefreq>${changefreq}</changefreq>`);
    if (priority) segments.push(`<priority>${priority}</priority>`);
    return `<url>${segments.join("")}</url>`;
  };

  const allEntries = [...urls, ...categoryUrls, ...productUrls];
  const body = allEntries.map(serialize).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

// === Directorios persistentes para archivos subidos ===
// UPLOADS_DIR guarda archivos genéricos
// INVOICES_DIR guarda facturas y comprobantes
// PRODUCT_UPLOADS_DIR guarda imágenes de productos
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const INVOICES_DIR = path.join(DATA_DIR, 'invoices');
const PRODUCT_UPLOADS_DIR = path.join(UPLOADS_DIR, 'products');
const ACCOUNT_DOCS_DIR = path.join(UPLOADS_DIR, 'account-docs');
const ACCOUNT_DOCUMENT_KEYS = ["afip", "iva", "bank", "agreement"];
const ACCOUNT_DOCUMENT_ALLOWED_STATUSES = new Set([
  "pending",
  "submitted",
  "approved",
  "rejected",
]);
// Crear directorios si no existen (modo persistente)
try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(INVOICES_DIR, { recursive: true });
  fs.mkdirSync(PRODUCT_UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(ACCOUNT_DOCS_DIR, { recursive: true });
} catch (e) {
  // En entornos donde no haya permisos, los directorios se crearán al primer uso
}
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const { Afip } = require("afip.ts");
const { Resend } = require("resend");
const multer = require("multer");
let sharp = null;
try {
  // sharp permite optimizar imágenes y generar WebP con alta performance
  // En entornos donde no esté disponible, se continúa usando el archivo original
  sharp = require("sharp");
} catch (err) {
  console.warn("sharp no disponible, se usará la imagen original", err?.message || err);
}
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
const API_BASE_URL = (
  process.env.API_BASE_URL || `${DOMAIN}/api`
).replace(/\/+$/, "");
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
const CALC_API =
  process.env.IMPORT_CALC_API_BASE || "http://localhost:8000/api";
const hasExternalCalcApi = Boolean(process.env.IMPORT_CALC_API_BASE);
const calcApiProxy = hasExternalCalcApi
  ? createProxyMiddleware({
      target: CALC_API,
      changeOrigin: true,
      pathRewrite: { "^/calc-api": "" },
    })
  : null;
const { handleCalcApiRequest } = require("./routes/calcApiLocal");

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
    buttonLabel: "Ingresar a portal mayorista",
    href: "/account-minorista.html#mayoristas",
  },
  columns: [
    {
      title: "Catálogo",
      links: [
        { label: "Productos", href: "/shop.html" },
        { label: "Pantallas Samsung", href: "/shop.html?category=pantallas" },
        { label: "Baterías originales", href: "/shop.html?category=baterias" },
      ],
    },
    {
      title: "Ayuda",
      links: [
        { label: "Seguimiento de pedido", href: "/seguimiento.html" },
        { label: "Garantía y devoluciones", href: "/pages/terminos.html#garantia" },
        { label: "Preguntas frecuentes", href: "/contact.html#faq" },
      ],
    },
    {
      title: "Cuenta",
      links: [
        { label: "Acceder", href: "/login.html" },
        { label: "Crear cuenta", href: "/register.html" },
        { label: "Soporte técnico", href: "/contact.html" },
      ],
    },
    {
      title: "Empresa",
      links: [
        { label: "Quiénes somos", href: "/index.html#quienes-somos" },
        { label: "Contacto comercial", href: "#contacto" },
        { label: "Términos y condiciones", href: "/pages/terminos.html" },
      ],
    },
  ],
  contact: {
    whatsapp: "+54 9 11 3034-1550",
    email: "ventas@nerinparts.com.ar",
    address: "CABA, Argentina",
  },
  social: {
    instagram: "https://www.instagram.com/nerinparts",
    linkedin: "https://www.linkedin.com/company/nerinparts",
    youtube: "",
  },
  badges: {
    mercadoPago: true,
    ssl: true,
    andreani: true,
    oca: true,
    dhl: false,
    authenticity: true,
  },
  newsletter: {
    enabled: false,
    placeholder: "Tu email para recibir novedades",
    successMsg: "¡Listo! Te sumamos a nuestra lista.",
  },
  legal: {
    cuit: "30-93002432-2",
    iibb: "IIBB CABA 901-117119-4",
    terms: "/pages/terminos.html",
    privacy: "/pages/terminos.html#datos",
  },
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
    accentFrom: "#60a5fa",
    accentTo: "#2563eb",
    border: "rgba(255,255,255,0.08)",
    bg: "#0b0b0c",
    fg: "#edeff5",
    muted: "#9ca3af",
    accentBar: true,
    mode: "dark",
    link: "#93c5fd",
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
  const { sessions, events } = getActivityLog();
  const now = Date.now();
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  const formatCurrencyArs = (value) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(Number(value) || 0);
  const sessionById = new Map(
    sessions
      .filter((s) => s && s.id)
      .map((s) => [String(s.id), s]),
  );
  const salesByCategory = {};
  const salesByProduct = {};
  const returnsByProduct = {};
  const customerTotals = {};
  const customerOrderCounts = {};
  const monthlySales = {};
  let totalSales = 0;
  let totalUnitsSold = 0;
  let totalReturns = 0;
  let revenueToday = 0;
  let revenueThisWeek = 0;
  let ordersToday = 0;
  let ordersThisWeek = 0;
  orders.forEach((order) => {
    totalSales += order.total || 0;
    const orderDateRaw =
      order.date || order.fecha || order.created_at || order.createdAt || null;
    const orderDate = Date.parse(orderDateRaw);
    if (Number.isFinite(orderDate)) {
      if (orderDate >= startOfToday.getTime()) {
        revenueToday += order.total || 0;
        ordersToday += 1;
      }
      if (orderDate >= startOfWeek.getTime()) {
        revenueThisWeek += order.total || 0;
        ordersThisWeek += 1;
      }
    }
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
      const email = String(order.cliente.email).toLowerCase();
      customerTotals[email] = (customerTotals[email] || 0) + (order.total || 0);
      customerOrderCounts[email] = (customerOrderCounts[email] || 0) + 1;
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
  const ACTIVE_WINDOW_MS = 30 * 60 * 1000; // 30 minutos
  const activeSessions = sessions.filter((session) => {
    if (!session) return false;
    if (session.status === "active") return true;
    const lastSeen = Date.parse(session.lastSeenAt || session.lastSeen || session.updatedAt);
    return Number.isFinite(lastSeen) && now - lastSeen <= ACTIVE_WINDOW_MS;
  });
  const checkoutInProgress = activeSessions.filter((session) => {
    const step = String(session.currentStep || "").toLowerCase();
    if (!step) return false;
    return (
      step.includes("checkout") ||
      step.includes("pago") ||
      step.includes("envio") ||
      step.includes("carrito")
    );
  }).length;
  const activeCarts = sessions.filter((session) => {
    if (!session) return false;
    const cartValue = Number(session.cartValue || session.cart_total || session.total);
    if (Number.isFinite(cartValue) && cartValue > 0) {
      const lastSeen = Date.parse(session.lastSeenAt || session.lastSeen || session.updatedAt);
      return !Number.isFinite(lastSeen) || now - lastSeen <= 24 * 60 * 60 * 1000;
    }
    return false;
  }).length;
  const visitTrendMap = new Map();
  const visitsTodaySessions = new Set();
  const visitsWeekSessions = new Set();
  const productNameById = new Map(
    products.map((p) => [String(p.id), p.name || p.title || p.sku || String(p.id)]),
  );
  const productViewsToday = new Map();
  const productViewsWeek = new Map();
  const funnel = {
    product_view: 0,
    add_to_cart: 0,
    checkout_start: 0,
    checkout_payment: 0,
    purchase: 0,
  };
  const normalizedEvents = Array.isArray(events)
    ? events
        .filter((evt) => evt && evt.timestamp)
        .map((evt) => ({
          ...evt,
          timestampMs: Date.parse(evt.timestamp),
        }))
        .filter((evt) => Number.isFinite(evt.timestampMs))
    : [];
  const sortedEvents = normalizedEvents.slice().sort((a, b) => a.timestampMs - b.timestampMs);
  const sessionEventCounts = new Map();
  const sessionPageViewCounts = new Map();
  const landingPageBySession = new Map();
  const landingPageCounts = new Map();
  const hourlyTraffic = new Array(24).fill(0);
  sortedEvents.forEach((evt) => {
    const eventDate = new Date(evt.timestampMs);
    const dateKey = eventDate.toISOString().slice(0, 10);
    const isInWeek = eventDate >= startOfWeek && eventDate <= today;
    const isToday = eventDate >= startOfToday;
    const sessionKey = evt.sessionId || evt.id || dateKey;
    if (sessionKey) {
      const key = String(sessionKey);
      sessionEventCounts.set(key, (sessionEventCounts.get(key) || 0) + 1);
    }
    if (isInWeek) {
      if (!visitTrendMap.has(dateKey)) {
        visitTrendMap.set(dateKey, new Set());
      }
      visitTrendMap.get(dateKey).add(evt.sessionId || evt.id || dateKey);
      if (evt.sessionId) {
        visitsWeekSessions.add(evt.sessionId);
      }
    }
    if (isToday && evt.sessionId) {
      visitsTodaySessions.add(evt.sessionId);
    }
    const type = String(evt.type || "").toLowerCase();
    if (type in funnel) {
      funnel[type] += 1;
    }
    if (type === "product_view" && evt.productId) {
      const prodId = String(evt.productId);
      const name = productNameById.get(prodId) || prodId;
      if (isToday) {
        productViewsToday.set(name, (productViewsToday.get(name) || 0) + 1);
      }
      if (isInWeek) {
        productViewsWeek.set(name, (productViewsWeek.get(name) || 0) + 1);
      }
    }
    if (type === "page_view") {
      const key = sessionKey ? String(sessionKey) : null;
      if (key) {
        sessionPageViewCounts.set(key, (sessionPageViewCounts.get(key) || 0) + 1);
        if (!landingPageBySession.has(key) && evt.path) {
          landingPageBySession.set(key, evt.path);
        }
      }
    }
    if (Number.isFinite(evt.timestampMs)) {
      const hour = eventDate.getUTCHours();
      hourlyTraffic[hour] = (hourlyTraffic[hour] || 0) + 1;
    }
  });
  const visitTrend = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(startOfToday);
    day.setDate(startOfToday.getDate() - i);
    const key = day.toISOString().slice(0, 10);
    const visitors = visitTrendMap.has(key) ? visitTrendMap.get(key).size : 0;
    visitTrend.push({ date: key, visitors });
  }
  const mostViewedTodayEntry = Array.from(productViewsToday.entries()).sort(
    (a, b) => {
      if (b[1] === a[1]) return a[0].localeCompare(b[0]);
      return b[1] - a[1];
    },
  )[0];
  const mostViewedWeekEntry = Array.from(productViewsWeek.entries()).sort(
    (a, b) => {
      if (b[1] === a[1]) return a[0].localeCompare(b[0]);
      return b[1] - a[1];
    },
  )[0];
  landingPageBySession.forEach((path) => {
    const page = path || "/";
    landingPageCounts.set(page, (landingPageCounts.get(page) || 0) + 1);
  });
  const topLandingPages = Array.from(landingPageCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([path, count]) => ({ path, count }));
  let bounceSessions = 0;
  let sessionsWithLanding = 0;
  sessionPageViewCounts.forEach((count, sessionId) => {
    if (count > 0) {
      sessionsWithLanding += 1;
      const totalEvents = sessionEventCounts.get(sessionId) || 0;
      if (count === 1 && totalEvents === 1) {
        bounceSessions += 1;
      }
    }
  });
  const bounceRate = sessionsWithLanding > 0 ? bounceSessions / sessionsWithLanding : 0;
  const engagedSessionsCount = Array.from(sessionEventCounts.values()).filter(
    (count) => count >= 4,
  ).length;
  const engagedSessionsRate =
    sessionEventCounts.size > 0 ? engagedSessionsCount / sessionEventCounts.size : 0;
  const trafficByHour = hourlyTraffic.map((count, hour) => ({
    hour,
    label: `${hour.toString().padStart(2, "0")}:00`,
    count,
  }));
  const peakTrafficHour = trafficByHour.reduce(
    (acc, entry) => {
      if (!acc || entry.count > acc.count) return entry;
      return acc;
    },
    null,
  );
  const sessionDurations = sessions
    .map((session) => {
      const start = Date.parse(session.startedAt || session.createdAt || session.created_at);
      const end = Date.parse(
        session.lastSeenAt || session.lastSeen || session.updatedAt || session.endedAt,
      );
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        return null;
      }
      return end - start;
    })
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  const averageSessionDurationMs = sessionDurations.length
    ? sessionDurations.reduce((sum, value) => sum + value, 0) / sessionDurations.length
    : 0;
  const averageSessionDuration = averageSessionDurationMs / (60 * 1000);
  const sortedDurations = sessionDurations.slice().sort((a, b) => a - b);
  let medianSessionDuration = 0;
  if (sortedDurations.length) {
    const middle = Math.floor(sortedDurations.length / 2);
    if (sortedDurations.length % 2 === 0) {
      medianSessionDuration = (sortedDurations[middle - 1] + sortedDurations[middle]) / 2;
    } else {
      medianSessionDuration = sortedDurations[middle];
    }
    medianSessionDuration /= 60 * 1000;
  }
  const uniqueCustomerCount = Object.keys(customerOrderCounts).length;
  const returningCustomerCount = Object.values(customerOrderCounts).filter((count) => count > 1)
    .length;
  const repeatCustomerRate =
    uniqueCustomerCount > 0 ? returningCustomerCount / uniqueCustomerCount : 0;
  const conversionRate = funnel.product_view > 0 ? funnel.purchase / funnel.product_view : 0;
  const cartAbandonmentRate =
    funnel.add_to_cart > 0 ? 1 - funnel.purchase / funnel.add_to_cart : 0;
  const insights = [];
  if (conversionRate > 0) {
    const level = conversionRate >= 0.02 ? "positive" : "neutral";
    insights.push({
      level,
      message: `Tasa de conversión ${(conversionRate * 100).toFixed(1)}%.`,
    });
  } else {
    insights.push({
      level: "alert",
      message: "Aún no hay compras registradas para medir la conversión.",
    });
  }
  if (peakTrafficHour && peakTrafficHour.count > 0) {
    insights.push({
      level: "info",
      message: `Mayor actividad a las ${peakTrafficHour.label} (${peakTrafficHour.count} eventos).`,
    });
  } else {
    insights.push({
      level: "neutral",
      message: "Aún no hay suficiente tráfico para detectar una hora pico.",
    });
  }
  if (bounceRate >= 0.4) {
    insights.push({
      level: "alert",
      message: `La tasa de rebote es ${(bounceRate * 100).toFixed(1)}%. Revisá las páginas de entrada.`,
    });
  } else {
    insights.push({
      level: "positive",
      message: `La tasa de rebote controlada en ${(bounceRate * 100).toFixed(1)}%.`,
    });
  }
  if (revenueThisWeek > 0) {
    insights.push({
      level: "positive",
      message: `Ingresos de la semana ${formatCurrencyArs(revenueThisWeek)}.`,
    });
  } else {
    insights.push({
      level: "neutral",
      message: "Todavía no hay ingresos registrados en los últimos 7 días.",
    });
  }
  const formatSessionLabel = (sessionId) => {
    if (!sessionId) return "Visitante";
    const session = sessionById.get(String(sessionId));
    if (!session) return `Sesión ${sessionId}`;
    if (session.userName) return session.userName;
    if (session.userEmail && session.userEmail !== "guest") return session.userEmail;
    return `Sesión ${sessionId}`;
  };
  const describeEvent = (evt) => {
    const type = String(evt.type || "").toLowerCase();
    const owner = formatSessionLabel(evt.sessionId);
    if (type === "product_view" && evt.productId) {
      const prodName = productNameById.get(String(evt.productId)) || evt.productId;
      return `${owner} miró ${prodName}`;
    }
    if (type === "add_to_cart" && evt.productId) {
      const prodName = productNameById.get(String(evt.productId)) || evt.productId;
      return `${owner} agregó ${prodName} al carrito`;
    }
    if (type === "checkout_start") {
      return `${owner} inició el checkout`;
    }
    if (type === "checkout_payment") {
      return `${owner} está completando el pago`;
    }
    if (type === "purchase") {
      return `${owner} confirmó una compra`;
    }
    if (type === "page_view") {
      const path = evt.path || evt.url || "/";
      return `${owner} visitó ${path}`;
    }
    return `${owner} registró ${type || "una interacción"}`;
  };
  const recentEvents = normalizedEvents
    .slice()
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, 6)
    .map((evt) => ({
      timestamp: new Date(evt.timestampMs).toISOString(),
      type: evt.type,
      sessionId: evt.sessionId || null,
      description: describeEvent(evt),
    }));
  return {
    revenueToday,
    revenueThisWeek,
    ordersToday,
    ordersThisWeek,
    conversionRate,
    cartAbandonmentRate,
    averageSessionDuration,
    medianSessionDuration,
    bounceRate,
    repeatCustomerRate,
    engagedSessionsRate,
    trafficByHour,
    peakTrafficHour,
    topLandingPages,
    insights,
    salesByCategory,
    salesByProduct,
    returnsByProduct,
    topCustomers,
    monthlySales,
    averageOrderValue,
    returnRate,
    mostReturnedProduct,
    activeSessions: activeSessions.length,
    checkoutInProgress,
    activeCarts,
    visitorsToday: visitsTodaySessions.size,
    visitorsThisWeek: visitsWeekSessions.size,
    visitTrend,
    liveSessions: activeSessions.map((session) => ({
      id: session.id,
      userEmail: session.userEmail || null,
      userName: session.userName || null,
      currentStep: session.currentStep || null,
      cartValue: Number(session.cartValue || 0) || 0,
      lastSeenAt:
        session.lastSeenAt || session.lastSeen || session.updatedAt || session.startedAt || null,
      location: session.location || session.city || session.region || null,
    })),
    productViewsToday: Array.from(productViewsToday.entries()).map(([name, count]) => ({
      name,
      count,
    })),
    productViewsWeek: Array.from(productViewsWeek.entries()).map(([name, count]) => ({
      name,
      count,
    })),
    mostViewedToday: mostViewedTodayEntry
      ? { name: mostViewedTodayEntry[0], count: mostViewedTodayEntry[1] }
      : null,
    mostViewedWeek: mostViewedWeekEntry
      ? { name: mostViewedWeekEntry[0], count: mostViewedWeekEntry[1] }
      : null,
    funnel,
    recentEvents,
  };
}

// Leer productos desde el archivo JSON
function getProducts() {
  const filePath = dataPath("products.json");
  try {
    const file = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(file);
    const list = Array.isArray(data?.products) ? data.products : data;
    return normalizeProductsList(list);
  } catch {
    return [];
  }
}

// Guardar productos en el archivo JSON
function saveProducts(products) {
  const filePath = dataPath("products.json");
  const normalized = normalizeProductsList(products);
  fs.writeFileSync(
    filePath,
    JSON.stringify({ products: normalized }, null, 2),
    "utf8",
  );
  _cache = { t: Date.now(), data: normalized };
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

function getActivityLog() {
  const filePath = dataPath("activity.json");
  try {
    const file = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(file);
    return {
      sessions: Array.isArray(data?.sessions) ? data.sessions : [],
      events: Array.isArray(data?.events) ? data.events : [],
    };
  } catch {
    return { sessions: [], events: [] };
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
  const shippingSource =
    o.shipping_status_code ||
    o.shippingStatusCode ||
    o.shipping_status ||
    o.shippingStatus ||
    o.estado_envio ||
    o.estadoEnvio ||
    (o.envio && (o.envio.estado || o.envio.status));
  let shippingCode = normalizeShipping(shippingSource);
  if (!shippingCode) {
    shippingCode =
      normalizeShipping(o.shipping_status) ||
      normalizeShipping(o.estado_envio) ||
      "received";
  }
  if (shippingCode === "cancelled") shippingCode = "canceled";
  const shippingLabelCandidates = [
    o.shipping_status_label,
    o.estado_envio,
    o.shipping_status,
    o.shippingStatus,
  ];
  const firstNonEmptyLabel = shippingLabelCandidates.find((value) => {
    if (value == null) return false;
    const str = String(value).trim();
    return str !== "";
  });
  let shippingLabel = firstNonEmptyLabel ? String(firstNonEmptyLabel).trim() : "";
  const shippingLabelLc = shippingLabel.toLowerCase();
  if (
    !shippingLabel ||
    ["received", "preparing", "shipped", "delivered", "canceled", "cancelled"].includes(
      shippingLabelLc,
    )
  ) {
    shippingLabel = localizeShippingStatus(shippingCode);
  }
  const tracking = o.tracking || o.seguimiento || "";
  const carrier = o.carrier || o.transportista || "";
  const updatedAt =
    o.updated_at ||
    o.updatedAt ||
    o.updated ||
    o.modified_at ||
    o.modifiedAt ||
    o.modified ||
    o.estado_actualizado ||
    o.fecha_actualizacion ||
    o.last_updated ||
    null;
  const invoicesRaw = Array.isArray(o.invoices) ? o.invoices : [];
  const invoices = invoicesRaw
    .map((inv) => ({ ...inv }))
    .filter((inv) => inv && !inv.deleted_at);
  const invoiceStatus =
    o.invoice_status ||
    o.invoiceStatus ||
    (invoices.length ? 'emitida' : null);
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
    estado_pago: payment,
    shipping_status_code: shippingCode,
    shippingStatusCode: shippingCode,
    shipping_status: shippingLabel,
    shippingStatus: shippingLabel,
    estado_envio: shippingLabel,
    shipping_status_label: shippingLabel,
    tracking,
    carrier,
    updated_at: updatedAt,
    updatedAt,
    productos: items,
    cliente,
    invoices,
    invoice_status: invoiceStatus,
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

function normalizeOrderForCustomer(order = {}) {
  const normalized = normalizeOrder(order);
  const totals = computeTotalsSnapshot(order);
  let customerData = null;
  try {
    customerData =
      typeof ordersRepo.normalizeCustomer === "function"
        ? ordersRepo.normalizeCustomer(order)
        : null;
  } catch {
    customerData = null;
  }
  if (!customerData) {
    customerData =
      normalized.customer || order.customer || order.cliente || null;
  }
  let shippingAddress = null;
  try {
    shippingAddress =
      typeof ordersRepo.normalizeAddress === "function"
        ? ordersRepo.normalizeAddress(order)
        : null;
  } catch {
    shippingAddress = null;
  }
  if (!shippingAddress) {
    shippingAddress =
      normalized.shipping_address ||
      order.shipping_address ||
      order.cliente?.direccion ||
      null;
  }
  const rawItems = ordersRepo.getNormalizedItems(order);
  const items = rawItems.map((item) => {
    const quantity = Number(item.qty ?? item.quantity ?? 0) || 0;
    const price = Number(item.price ?? item.unit_price ?? 0) || 0;
    const total = Number(item.total ?? quantity * price) || 0;
    return {
      id: item.id || item.product_id || item.sku || null,
      sku: item.sku || item.product_id || null,
      name:
        item.name ||
        item.title ||
        item.descripcion ||
        item.product_name ||
        "Producto",
      quantity,
      price,
      total,
      image: item.image || item.image_url || item.img || null,
    };
  });

  const shippingStatus =
    normalized.shipping_status ||
    order.shipping_status ||
    order.estado_envio ||
    order.shippingStatus ||
    "pendiente";

  const paymentCode = mapPaymentStatusCode(
    normalized.payment_status_code ||
      normalized.payment_status ||
      order.payment_status ||
      order.estado_pago ||
      order.status,
  );

  const paymentLabel = localizePaymentStatus(
    normalized.payment_status || order.payment_status || order.estado_pago || paymentCode,
  );

  const tracking = normalized.tracking || resolveOrderTrackingCode(order);

  const orderNumber =
    normalized.order_number ||
    order.order_number ||
    order.id ||
    order.external_reference ||
    null;

  const createdAt =
    normalized.created_at ||
    order.created_at ||
    order.fecha ||
    order.date ||
    order.updated_at ||
    null;

  return {
    ...order,
    ...normalized,
    order_number: orderNumber,
    created_at: createdAt,
    payment_status_code: paymentCode,
    payment_status: paymentLabel,
    paymentStatus: paymentLabel,
    customer: customerData || null,
    shipping_address: shippingAddress || null,
    productos: items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      total: item.total,
      image: item.image,
    })),
    items,
    totals,
    total_amount: totals.grand_total,
    total: totals.grand_total,
    shipping_status: shippingStatus,
    tracking: tracking || null,
  };
}

function normalizeStatusFilter(value) {
  if (value == null) return '';
  const key = String(value).trim().toLowerCase();
  if (!key || key === 'all' || key === 'todos') return '';
  if (key === 'pagado' || key === 'aprobado' || key === 'approved' || key === 'paid') {
    return 'approved';
  }
  if (key === 'pendiente' || key === 'pending' || key === 'in_process' || key === 'in process') {
    return 'pending';
  }
  if (key === 'rechazado' || key === 'rejected' || key === 'cancelado' || key === 'cancelled' || key === 'canceled') {
    return 'rejected';
  }
  return key;
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

function formatClientAddress(shipping = {}) {
  if (!shipping || typeof shipping !== "object") return "";
  const street = normalizeTextInput(shipping.street || shipping.calle);
  const number = normalizeTextInput(shipping.number || shipping.numero);
  const floor = normalizeTextInput(shipping.floor || shipping.piso);
  const city = normalizeTextInput(shipping.city || shipping.localidad);
  const province = normalizeTextInput(shipping.province || shipping.provincia);
  const zip = normalizeTextInput(shipping.zip || shipping.cp || shipping.postal);

  const firstLine = street
    ? `${street}${number ? ` ${number}` : ""}${floor ? ` ${floor}` : ""}`.trim()
    : "";

  const parts = [];
  if (firstLine) parts.push(firstLine);
  if (city) parts.push(city);
  if (province) parts.push(province);
  if (zip) parts.push(`CP ${zip}`.trim());
  return parts.join(", ").replace(/\s{2,}/g, " ").trim();
}

function pickProfileValue(profile, shippingSource, keys = []) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(profile, key)) {
      return profile[key];
    }
  }
  if (shippingSource && typeof shippingSource === "object") {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(shippingSource, key)) {
        return shippingSource[key];
      }
    }
  }
  return undefined;
}

function applyProfileToClient(client, profile = {}) {
  if (!client || typeof client !== "object") return client;
  if (!profile || typeof profile !== "object") return { ...client };

  const copy = { ...client };
  const shippingSource =
    (profile.shipping && typeof profile.shipping === "object"
      ? profile.shipping
      : null) ||
    (profile.address && typeof profile.address === "object"
      ? profile.address
      : null) ||
    (profile.direccion && typeof profile.direccion === "object"
      ? profile.direccion
      : null) ||
    {};

  if (Object.prototype.hasOwnProperty.call(profile, "name")) {
    copy.name = normalizeTextInput(profile.name) || copy.name || "";
  } else {
    const nombre = pickProfileValue(profile, {}, ["nombre"]);
    const apellido = pickProfileValue(profile, {}, ["apellido"]);
    if (nombre !== undefined || apellido !== undefined) {
      const parts = [normalizeTextInput(nombre), normalizeTextInput(apellido)]
        .filter(Boolean)
        .join(" ");
      if (parts) copy.name = parts;
    }
  }

  if (Object.prototype.hasOwnProperty.call(profile, "phone") ||
      Object.prototype.hasOwnProperty.call(profile, "telefono")) {
    const phone = profile.phone ?? profile.telefono;
    copy.phone = normalizeTextInput(phone);
  }

  if (Object.prototype.hasOwnProperty.call(profile, "cuit") ||
      Object.prototype.hasOwnProperty.call(profile, "taxId")) {
    copy.cuit = normalizeTextInput(profile.cuit ?? profile.taxId);
  }

  if (Object.prototype.hasOwnProperty.call(profile, "address") &&
      typeof profile.address === "string") {
    copy.address = normalizeTextInput(profile.address);
  }

  if (Object.prototype.hasOwnProperty.call(profile, "billing_address")) {
    copy.address = normalizeTextInput(profile.billing_address);
  }

  const shippingFields = [
    { target: "street", keys: ["street", "calle"] },
    { target: "number", keys: ["number", "numero"] },
    { target: "floor", keys: ["floor", "piso", "apto", "departamento"] },
    { target: "city", keys: ["city", "localidad"] },
    { target: "province", keys: ["province", "provincia", "state"] },
    { target: "zip", keys: ["zip", "cp", "codigo_postal", "postal"] },
    { target: "notes", keys: ["notes", "notas"] },
  ];

  const nextShipping = { ...(copy.shipping || {}) };
  let shippingChanged = false;
  for (const field of shippingFields) {
    const value = pickProfileValue(profile, shippingSource, field.keys);
    if (value !== undefined) {
      nextShipping[field.target] = normalizeTextInput(value);
      shippingChanged = true;
    }
  }

  const methodValue =
    pickProfileValue(profile, shippingSource, [
      "metodo",
      "metodo_envio",
      "shipping_method",
      "method",
    ]);
  if (methodValue !== undefined) {
    nextShipping.method = normalizeTextInput(methodValue);
    shippingChanged = true;
  }

  if (shippingChanged) {
    copy.shipping = nextShipping;
    const formatted = formatClientAddress(nextShipping);
    if (formatted) copy.address = formatted;
    if (nextShipping.city !== undefined) copy.city = nextShipping.city;
    if (nextShipping.province !== undefined) copy.province = nextShipping.province;
    if (nextShipping.zip !== undefined) copy.zip = nextShipping.zip;
  }

  const prefs =
    (profile.contact_preferences && typeof profile.contact_preferences === "object"
      ? profile.contact_preferences
      : null) ||
    (profile.contactPreferences && typeof profile.contactPreferences === "object"
      ? profile.contactPreferences
      : null);
  if (prefs) {
    const current = copy.contact_preferences || {};
    copy.contact_preferences = {
      whatsapp:
        prefs.whatsapp !== undefined
          ? Boolean(prefs.whatsapp)
          : current.whatsapp || false,
      email:
        prefs.email !== undefined
          ? Boolean(prefs.email)
          : current.email || false,
    };
  }

  copy.updated_at = new Date().toISOString();
  return copy;
}

function buildClientProfile(client, fallbackEmail) {
  const email = normalizeTextInput(client?.email || fallbackEmail || "");
  const fullName = normalizeTextInput(client?.name || "");
  const parts = fullName.split(/\s+/).filter(Boolean);
  const firstName = parts.length ? parts[0] : "";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
  const shipping =
    client && typeof client.shipping === "object" && client.shipping
      ? client.shipping
      : {};

  const profile = {
    nombre: firstName,
    apellido: lastName,
    email,
    telefono: normalizeTextInput(client?.phone || ""),
    provincia: normalizeTextInput(
      shipping.province || shipping.provincia || client?.province || "",
    ),
    localidad: normalizeTextInput(
      shipping.city || shipping.localidad || client?.city || "",
    ),
    calle: normalizeTextInput(shipping.street || shipping.calle || ""),
    numero: normalizeTextInput(shipping.number || shipping.numero || ""),
    piso: normalizeTextInput(shipping.floor || shipping.piso || ""),
    cp: normalizeTextInput(shipping.zip || shipping.cp || client?.zip || ""),
    metodo: normalizeTextInput(shipping.method || ""),
  };

  profile.direccion = {
    calle: profile.calle,
    numero: profile.numero,
    piso: profile.piso,
    localidad: profile.localidad,
    provincia: profile.provincia,
    cp: profile.cp,
    metodo: profile.metodo,
  };

  profile.contactPreferences = {
    whatsapp: Boolean(client?.contact_preferences?.whatsapp),
    email: Boolean(client?.contact_preferences?.email ?? true),
  };

  profile.name = fullName;

  return profile;
}

function normalizeAccountDocumentActor(actor) {
  if (!actor || typeof actor !== "object") return undefined;
  const name = normalizeTextInput(actor.name);
  const email = normalizeEmailInput(actor.email);
  const result = {};
  if (name) result.name = name;
  if (email) result.email = email;
  return Object.keys(result).length ? result : undefined;
}

function normalizeAccountDocumentFile(file) {
  if (!file || typeof file !== "object") return null;
  const id = normalizeTextInput(file.id || file.fileId || file.file_id);
  const filename = normalizeTextInput(file.filename || file.file || file.path);
  const url = normalizeTextInput(file.url);
  if (!id || !filename || !url) return null;
  const originalName =
    normalizeTextInput(file.originalName || file.original_name || file.name) || filename;
  const uploadedAt = file.uploadedAt || file.uploaded_at || null;
  const size =
    typeof file.size === "number"
      ? file.size
      : Number(file.size || file.filesize || file.file_size) || null;
  const uploadedBy = normalizeAccountDocumentActor(file.uploadedBy || file.uploaded_by);
  return {
    id,
    filename,
    url,
    originalName,
    uploadedAt,
    size,
    uploadedBy,
  };
}

function normalizeAccountDocumentEntry(entry) {
  const statusRaw = normalizeTextInput(entry?.status).toLowerCase();
  const status = ACCOUNT_DOCUMENT_ALLOWED_STATUSES.has(statusRaw)
    ? statusRaw
    : "pending";
  const notes = normalizeTextInput(entry?.notes).slice(0, 400);
  const reviewedAt = entry?.reviewedAt || entry?.reviewed_at || null;
  const reviewedBy = normalizeAccountDocumentActor(entry?.reviewedBy || entry?.reviewed_by);
  const updatedAt = entry?.updatedAt || entry?.updated_at || null;
  const files = Array.isArray(entry?.files)
    ? entry.files
        .map((file) => normalizeAccountDocumentFile(file))
        .filter(Boolean)
        .sort((a, b) => {
          const timeA = Date.parse(a.uploadedAt || 0) || 0;
          const timeB = Date.parse(b.uploadedAt || 0) || 0;
          return timeB - timeA;
        })
    : [];
  return {
    status,
    notes,
    files,
    reviewedAt,
    reviewedBy,
    updatedAt,
  };
}

function createEmptyAccountDocumentRecord(email) {
  const normalizedEmail = normalizeEmailInput(email);
  if (!normalizedEmail) return null;
  const documents = {};
  ACCOUNT_DOCUMENT_KEYS.forEach((key) => {
    documents[key] = normalizeAccountDocumentEntry({});
  });
  return {
    email: normalizedEmail,
    documents,
    updatedAt: null,
    history: [],
  };
}

function normalizeAccountDocumentRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = createEmptyAccountDocumentRecord(raw.email);
  if (!base) return null;
  const history = Array.isArray(raw.history)
    ? raw.history.filter((event) => event && typeof event === "object")
    : [];
  base.history = history.slice(-120);
  base.updatedAt = raw.updatedAt || raw.updated_at || null;
  ACCOUNT_DOCUMENT_KEYS.forEach((key) => {
    if (raw.documents && raw.documents[key]) {
      base.documents[key] = normalizeAccountDocumentEntry(raw.documents[key]);
    }
  });
  return base;
}

function getAccountDocumentRecords() {
  const filePath = dataPath("account_documents.json");
  try {
    const file = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(file);
    const rawList = Array.isArray(parsed.records) ? parsed.records : [];
    const normalized = [];
    rawList.forEach((item) => {
      const record = normalizeAccountDocumentRecord(item);
      if (record) normalized.push(record);
    });
    return normalized;
  } catch (err) {
    return [];
  }
}

function saveAccountDocumentRecords(records) {
  const filePath = dataPath("account_documents.json");
  const payload = {
    records: Array.isArray(records)
      ? records
          .map((record) => normalizeAccountDocumentRecord(record))
          .filter(Boolean)
      : [],
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function findAccountDocumentRecord(records, email) {
  const normalizedEmail = normalizeEmailInput(email);
  if (!normalizedEmail) return null;
  const record = Array.isArray(records)
    ? records.find((item) => item.email === normalizedEmail)
    : null;
  if (!record) return null;
  ACCOUNT_DOCUMENT_KEYS.forEach((key) => {
    if (!record.documents[key]) {
      record.documents[key] = normalizeAccountDocumentEntry({});
    }
  });
  return record;
}

function ensureAccountDocumentRecord(records, email) {
  const normalizedEmail = normalizeEmailInput(email);
  if (!normalizedEmail) return null;
  let record = findAccountDocumentRecord(records, normalizedEmail);
  if (!record) {
    record = createEmptyAccountDocumentRecord(normalizedEmail);
    if (!Array.isArray(records)) return record;
    records.push(record);
  }
  return record;
}

function appendAccountDocumentHistory(record, event) {
  if (!record || !event) return;
  if (!Array.isArray(record.history)) record.history = [];
  const docKey = normalizeTextInput(event.docKey).toLowerCase();
  if (!ACCOUNT_DOCUMENT_KEYS.includes(docKey)) return;
  const action = normalizeTextInput(event.action) || "update";
  const at = event.at || new Date().toISOString();
  const historyEntry = {
    id: generateHistoryId(),
    action,
    docKey,
    at,
  };
  const actor = normalizeAccountDocumentActor(event.by);
  if (actor) historyEntry.by = actor;
  const status = normalizeTextInput(event.status).toLowerCase();
  if (ACCOUNT_DOCUMENT_ALLOWED_STATUSES.has(status)) {
    historyEntry.status = status;
  }
  const notes = normalizeTextInput(event.notes);
  if (notes) historyEntry.notes = notes.slice(0, 400);
  const fileId = normalizeTextInput(event.fileId);
  if (fileId) historyEntry.fileId = fileId;
  record.history.push(historyEntry);
  if (record.history.length > 120) {
    record.history = record.history.slice(-120);
  }
}

function publicAccountDocumentRecord(record) {
  const base = record ? normalizeAccountDocumentRecord(record) : null;
  if (!base) return null;
  const documents = {};
  ACCOUNT_DOCUMENT_KEYS.forEach((key) => {
    const entry = base.documents[key] || normalizeAccountDocumentEntry({});
    documents[key] = {
      status: entry.status,
      notes: entry.notes,
      files: entry.files.map((file) => ({
        id: file.id,
        url: file.url,
        originalName: file.originalName,
        uploadedAt: file.uploadedAt,
        size: file.size,
      })),
      reviewedAt: entry.reviewedAt,
      reviewedBy: entry.reviewedBy,
      updatedAt: entry.updatedAt,
    };
  });
  return {
    email: base.email,
    updatedAt: base.updatedAt,
    documents,
  };
}

function cleanupAccountDocumentUpload(file) {
  if (!file) return;
  const targetPath = file.path || path.join(ACCOUNT_DOCS_DIR, file.filename || "");
  if (!targetPath) return;
  if (!targetPath.startsWith(ACCOUNT_DOCS_DIR)) return;
  fsp.unlink(targetPath).catch(() => {});
}

function getWholesaleRequests() {
  const filePath = dataPath("wholesale_requests.json");
  try {
    const file = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(file);
    const rawList = Array.isArray(parsed.requests) ? parsed.requests : [];
    const normalized = [];
    let needsSave = false;
    for (const item of rawList) {
      const { record, changed } = normalizeWholesaleRequestEntry(item);
      normalized.push(record);
      if (changed) needsSave = true;
    }
    if (needsSave) {
      saveWholesaleRequests(normalized);
    }
    return normalized;
  } catch (err) {
    return [];
  }
}

function saveWholesaleRequests(requests) {
  const filePath = dataPath("wholesale_requests.json");
  const normalizedList = Array.isArray(requests)
    ? requests.map((req) => normalizeWholesaleRequestEntry(req).record)
    : [];
  const payload = {
    requests: normalizedList,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
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
function buildBaseHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Accept, Content-Type, Authorization, X-Requested-With",
    ...extra,
  };
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, buildBaseHeaders(extraHeaders));
  res.end(json);
}

function sendStatus(res, statusCode, extraHeaders = {}) {
  res.writeHead(statusCode, buildBaseHeaders(extraHeaders));
  res.end();
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
    accentBar:
      data?.theme?.accentBar === false
        ? false
        : data?.theme?.accentBar === true
          ? true
          : base.theme.accentBar !== false,
    mode:
      typeof data?.theme?.mode === "string" && data.theme.mode
        ? data.theme.mode
        : base.theme.mode,
    link: String(data?.theme?.link || base.theme.link || base.theme.accentFrom),
  };
  return out;
}

// Leer tabla de costos de envío por provincia
const DEFAULT_SHIPPING_METHODS = [
  { id: "retiro", label: "Retiro en local" },
  { id: "estandar", label: "Envío estándar" },
  { id: "express", label: "Envío express" },
];

function resolveShippingMethods(methods) {
  if (!Array.isArray(methods)) return [...DEFAULT_SHIPPING_METHODS];
  const seen = new Set();
  const normalized = [];
  methods.forEach((method) => {
    if (!method) return;
    const id = String(method.id || method.value || "").trim().toLowerCase();
    if (!id || seen.has(id)) return;
    const labelSource =
      method.label || method.name || method.title || method.displayName || id;
    const label = String(labelSource || id).trim() || id;
    normalized.push({ id, label });
    seen.add(id);
  });
  return normalized.length ? normalized : [...DEFAULT_SHIPPING_METHODS];
}

function normalizeShippingTable(table) {
  const methods = resolveShippingMethods(table?.methods);
  const rows = Array.isArray(table?.costos) ? table.costos : [];
  const normalizedRows = rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const provincia = String(row.provincia || "").trim();
      if (!provincia) return null;
      const metodos = {};
      const rawMethods =
        row.metodos && typeof row.metodos === "object" ? row.metodos : {};
      const fallbackValueRaw = row.costo ?? row.price ?? row.valor ?? null;
      const fallbackNumber = Number(fallbackValueRaw);
      const fallbackCost =
        Number.isFinite(fallbackNumber) && fallbackNumber >= 0
          ? fallbackNumber
          : 0;
      methods.forEach((method) => {
        const rawValue =
          rawMethods[method.id] ??
          row[method.id] ??
          (method.id === "retiro" ? 0 : undefined);
        let numeric = Number(rawValue);
        if (!Number.isFinite(numeric) || numeric < 0) {
          numeric = method.id === "retiro" ? 0 : fallbackCost;
        }
        metodos[method.id] = numeric;
      });
      return { provincia, metodos };
    })
    .filter(Boolean);
  return { methods, costos: normalizedRows };
}

function getShippingTable() {
  const filePath = dataPath("shipping.json");
  try {
    const file = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(file);
    return normalizeShippingTable(data);
  } catch (e) {
    return normalizeShippingTable({});
  }
}

function saveShippingTable(table) {
  const normalized = normalizeShippingTable(table || {});
  const filePath = dataPath("shipping.json");
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf8");
}

function validateShippingTable(table) {
  try {
    const normalized = normalizeShippingTable(table || {});
    return Array.isArray(normalized.costos)
      ? normalized.costos.every((row) => {
          if (!row || typeof row !== "object") return false;
          if (typeof row.provincia !== "string" || !row.provincia.trim()) {
            return false;
          }
          if (!row.metodos || typeof row.metodos !== "object") return false;
          return normalized.methods.every((method) => {
            const value = row.metodos[method.id];
            return (
              typeof value === "number" &&
              !Number.isNaN(value) &&
              value >= 0
            );
          });
        })
      : false;
  } catch (err) {
    return false;
  }
}

function getShippingMethodLabel(methodId, table) {
  const shippingTable = table ? table : getShippingTable();
  const method = shippingTable.methods.find((m) => m.id === methodId);
  return method ? method.label : methodId || "Envío";
}

// Obtener costo de envío para una provincia y método (retorna 0 si no se encuentra)
function getShippingCost(provincia, metodo = "estandar", table) {
  const shippingTable = table ? normalizeShippingTable(table) : getShippingTable();
  const methods = shippingTable.methods;
  const normalizedMethod =
    methods.find((m) => m.id === metodo) ||
    methods.find((m) => m.id === "estandar") ||
    methods[0];
  const methodId = normalizedMethod ? normalizedMethod.id : metodo;
  const match = shippingTable.costos.find(
    (c) =>
      c.provincia.toLowerCase() === String(provincia || "").toLowerCase(),
  );
  const fallback = shippingTable.costos.find(
    (c) => c.provincia.toLowerCase() === "otras",
  );
  const sourceRow = match || fallback;
  if (sourceRow && sourceRow.metodos && methodId in sourceRow.metodos) {
    const value = sourceRow.metodos[methodId];
    if (typeof value === "number" && !Number.isNaN(value)) {
      return value;
    }
  }
  if (methodId === "retiro") return 0;
  return 0;
}

function resolveOrderCustomerEmail(order = {}) {
  let normalizedCustomer = null;
  try {
    normalizedCustomer =
      typeof ordersRepo.normalizeCustomer === "function"
        ? ordersRepo.normalizeCustomer(order)
        : null;
  } catch {
    normalizedCustomer = null;
  }
  const candidates = [
    normalizedCustomer?.email,
    order?.customer?.email,
    order?.customer?.mail,
    order?.customer?.correo,
    order?.cliente?.email,
    order?.cliente?.mail,
    order?.cliente?.correo,
    order?.customer_email,
    order?.user_email,
    order?.email,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = String(candidate).trim();
    if (trimmed) return trimmed;
  }
  return null;
}

// Enviar email cuando el pedido se despacha
function prepareOrderForEmail(order) {
  if (!order) return order;
  let normalizedCustomer = null;
  try {
    normalizedCustomer =
      typeof ordersRepo.normalizeCustomer === "function"
        ? ordersRepo.normalizeCustomer(order)
        : null;
  } catch {
    normalizedCustomer = null;
  }
  if (
    normalizedCustomer &&
    (!order.customer || order.customer !== normalizedCustomer)
  ) {
    return { ...order, customer: normalizedCustomer };
  }
  return order;
}

function resolveOrderTrackingCode(order = {}) {
  const candidates = [
    order.tracking,
    order.seguimiento,
    order.tracking_number,
    order.trackingNumber,
    order.numero_seguimiento,
    order.numeroSeguimiento,
    order.shipping_tracking,
    order.shippingTracking,
  ];
  for (const candidate of candidates) {
    const value = normalizeTextInput(candidate);
    if (value) return value;
  }
  return null;
}

function resolveOrderCarrier(order = {}) {
  const candidates = [
    order.carrier,
    order.transportista,
    order.shipping_carrier,
    order.shippingCarrier,
  ];
  for (const candidate of candidates) {
    const value = normalizeTextInput(candidate);
    if (value) return value;
  }
  return null;
}

function resolveOrderTrackingUrl(order = {}) {
  const candidates = [
    order.tracking_url,
    order.trackingUrl,
    order.seguimiento_url,
    order.seguimientoUrl,
    order.tracking_link,
    order.trackingLink,
    order.link_seguimiento,
    order.linkSeguimiento,
  ];
  for (const candidate of candidates) {
    const value = normalizeTextInput(candidate);
    if (value) return value;
  }
  return null;
}

function buildAbsoluteUrl(baseUrl, target) {
  if (!target && target !== 0) return null;
  const text = normalizeTextInput(target);
  if (!text) return null;
  try {
    return new URL(text).toString();
  } catch {
    const base = baseUrl || FALLBACK_BASE_URL;
    if (!base) return null;
    try {
      return new URL(text, base).toString();
    } catch {
      return null;
    }
  }
}

function buildOrderStatusUrl(order, email, baseUrl) {
  if (!order) return null;
  const idCandidates = [
    order.id,
    order.order_number,
    order.orderNumber,
    order.external_reference,
    order.externalReference,
  ];
  let orderId = null;
  for (const candidate of idCandidates) {
    const value = normalizeTextInput(candidate);
    if (value) {
      orderId = value;
      break;
    }
  }
  if (!orderId) return null;
  const recipient = normalizeEmailInput(email || resolveOrderCustomerEmail(order));
  const base = baseUrl || FALLBACK_BASE_URL;
  if (!base) return null;
  try {
    const url = new URL(base);
    url.pathname = "/seguimiento";
    url.search = "";
    url.searchParams.set("order", orderId);
    if (recipient) url.searchParams.set("email", recipient);
    return url.toString();
  } catch {
    return null;
  }
}

function prepareOrderEmailPayload(order) {
  const recipient = resolveOrderCustomerEmail(order);
  if (!recipient) return null;
  const normalizedOrder = prepareOrderForEmail(order);
  const baseUrl = getPublicBaseUrl(getConfig());
  const statusUrl = buildOrderStatusUrl(order, recipient, baseUrl);
  const trackingUrl = buildAbsoluteUrl(baseUrl, resolveOrderTrackingUrl(order));
  const tracking = resolveOrderTrackingCode(order);
  const carrier = resolveOrderCarrier(order);
  return {
    recipient,
    order: normalizedOrder,
    baseUrl,
    statusUrl,
    trackingUrl,
    tracking,
    carrier,
  };
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
      const safeSku = sku
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "img";
      const unique = `${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      cb(null, `${safeSku}-${unique}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".jpg", ".jpeg", ".png"].includes(ext)) cb(null, true);
    else cb(new Error("Formato no permitido"));
  },
});

async function optimizeProductImage(file) {
  if (!file) return null;
  const originalPath = file.path;
  let finalName = file.filename;
  let finalPath = `/assets/uploads/products/${encodeURIComponent(
    file.filename,
  )}`;
  if (sharp) {
    const targetName = `${path.parse(file.filename).name}.webp`;
    const targetPath = path.join(productImagesDir, targetName);
    try {
      await sharp(originalPath)
        .rotate()
        .webp({ quality: 82 })
        .toFile(targetPath);
      await fsp.unlink(originalPath).catch(() => {});
      finalName = targetName;
      finalPath = `/assets/uploads/products/${encodeURIComponent(targetName)}`;
    } catch (err) {
      console.error("optimizeProductImage", err);
      // En caso de error, mantenemos el archivo original
      finalName = file.filename;
      finalPath = `/assets/uploads/products/${encodeURIComponent(
        file.filename,
      )}`;
    }
  }
  return { file: finalName, path: finalPath };
}

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

const invoiceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(INVOICES_DIR, { recursive: true });
      cb(null, INVOICES_DIR);
    },
    filename: (req, file, cb) => {
      const baseId =
        (req && req.orderId && String(req.orderId)) ||
        (file && file.fieldname) ||
        'invoice';
      const sanitized = baseId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'invoice';
      const stamp = Date.now();
      cb(null, `${sanitized}-${stamp}.pdf`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (file.mimetype === 'application/pdf' || ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'));
    }
  },
});

const accountDocsUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(ACCOUNT_DOCS_DIR, { recursive: true });
      cb(null, ACCOUNT_DOCS_DIR);
    },
    filename: (req, file, cb) => {
      const docKeyRaw =
        (req?.body?.docKey || req?.body?.document || file?.fieldname || 'document')
          .toString()
          .toLowerCase();
      const safeKey = docKeyRaw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'documento';
      const unique = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 10)}`;
      const ext = path.extname(file.originalname || '').toLowerCase() || '.dat';
      cb(null, `${safeKey.slice(0, 32)}-${unique}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Formato de archivo no permitido'));
  },
});

// Servir archivos estáticos (HTML, CSS, JS, imágenes)
function hydrateHtmlSeo(buffer) {
  try {
    const html = buffer.toString("utf8");
    const baseUrl = getPublicBaseUrl(getConfig());
    if (!baseUrl) {
      return buffer;
    }
    const normalized = baseUrl.replace(/\/+$/, "");
    const hydrated = html.replace(/__BASE_URL__/g, normalized);
    if (hydrated === html) {
      return buffer;
    }
    return Buffer.from(hydrated, "utf8");
  } catch (err) {
    console.error("No se pudo hidratar HTML con la URL pública", err);
    return buffer;
  }
}

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
      return;
    }
    let payload = data;
    if (ext === ".html") {
      payload = hydrateHtmlSeo(data);
    }
    res.writeHead(200, { "Content-Type": contentType, ...headers });
    res.end(payload);
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

  if (pathname && pathname.startsWith("/calc-api")) {
    if (hasExternalCalcApi && calcApiProxy) {
      return calcApiProxy(req, res, (proxyError) => {
        if (proxyError) {
          console.error("calc-api proxy error", proxyError);
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                ok: false,
                error: "calc_api_proxy_error",
              }),
            );
          }
        }
      });
    }
    return handleCalcApiRequest(req, res, parsedUrl, {
      parseBody,
      sendJson,
      sendStatus,
    });
  }

  if (pathname === "/api/version" && req.method === "GET") {
    return sendJson(res, 200, { build: BUILD_ID });
  }

  if (pathname === "/api/ping" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, ts: Date.now() });
  }

  if (pathname === "/api/test-email" && req.method === "GET") {
    const requestUrl = new URL(req.url, "http://localhost");
    const to = requestUrl.searchParams.get("to") || "tuemail@ejemplo.com";
    try {
      const result = await sendEmail({
        to,
        subject: "Test Resend OK",
        html: "<p>Backend ✅ Resend ✅</p>",
        type: "no-reply",
      });
      const id = (result && result.data && result.data.id) || true;
      return sendJson(res, 200, { ok: true, id });
    } catch (error) {
      const errorPayload =
        error && typeof error === "object" ? error : String(error);
      return sendJson(res, 500, { ok: false, error: errorPayload });
    }
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
      return sendJson(res, 200, normalizeProductImages(product));
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
          const normalizedEmail = normalizeEmailInput(email);
          let profile = null;
          try {
            const clients = getClients();
            const client = clients.find(
              (c) => normalizeEmailInput(c.email) === normalizedEmail,
            );
            profile = buildClientProfile(client, email);
          } catch (clientErr) {
            console.error("login profile lookup failed", clientErr);
            profile = buildClientProfile(null, email);
          }
          return sendJson(res, 200, {
            success: true,
            token,
            role: user.role || "mayorista",
            name: user.name || "Cliente",
            profile,
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
    upload.fields([
      { name: "images", maxCount: 10 },
      { name: "image", maxCount: 10 },
    ])(req, res, async (err) => {
      if (err) {
        console.error(err);
        return sendJson(res, 400, { error: err.message });
      }
      const files = [];
      if (Array.isArray(req.files)) {
        files.push(...req.files);
      } else if (req.files && typeof req.files === "object") {
        Object.values(req.files).forEach((group) => {
          if (Array.isArray(group)) files.push(...group);
        });
      }
      if (!files.length) {
        return sendJson(res, 400, { error: "No se recibió archivo" });
      }
      try {
        const processed = [];
        for (const file of files) {
          const optimized = await optimizeProductImage(file);
          if (optimized) processed.push(optimized);
        }
        if (!processed.length) {
          return sendJson(res, 500, { error: "No se pudieron procesar las imágenes" });
        }
        return sendJson(res, 201, {
          success: true,
          files: processed,
          path: processed[0]?.path || null,
        });
      } catch (e) {
        console.error("product-image-upload", e);
        return sendJson(res, 500, { error: "Error al procesar imágenes" });
      }
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

  if (pathname === "/api/account/documents/upload" && req.method === "POST") {
    accountDocsUpload.single("file")(req, res, async (err) => {
      if (err) {
        console.error("account-doc-upload", err);
        return sendJson(res, 400, { error: err.message || "No se pudo subir el archivo" });
      }
      const email = normalizeEmailInput(req.body?.email);
      const docKey = normalizeTextInput(req.body?.docKey || req.body?.document).toLowerCase();
      if (!email) {
        cleanupAccountDocumentUpload(req.file);
        return sendJson(res, 400, { error: "Correo inválido" });
      }
      if (!ACCOUNT_DOCUMENT_KEYS.includes(docKey)) {
        cleanupAccountDocumentUpload(req.file);
        return sendJson(res, 400, { error: "Documento no reconocido" });
      }
      if (!req.file) {
        return sendJson(res, 400, { error: "Archivo requerido" });
      }
      try {
        const records = getAccountDocumentRecords();
        const record = ensureAccountDocumentRecord(records, email);
        if (!record) {
          cleanupAccountDocumentUpload(req.file);
          return sendJson(res, 400, { error: "No se pudo crear el registro" });
        }
        const nowIso = new Date().toISOString();
        const entry = record.documents[docKey] || normalizeAccountDocumentEntry({});
        const fileId = generateDocumentId();
        const fileRecord = {
          id: fileId,
          filename: req.file.filename,
          url: `/uploads/account-docs/${encodeURIComponent(req.file.filename)}`,
          originalName: req.file.originalname || req.file.filename,
          uploadedAt: nowIso,
          size: req.file.size || null,
          uploadedBy: { email },
        };
        entry.files = [fileRecord, ...entry.files];
        entry.status = "submitted";
        entry.reviewedAt = null;
        entry.reviewedBy = undefined;
        entry.updatedAt = nowIso;
        record.documents[docKey] = normalizeAccountDocumentEntry(entry);
        record.updatedAt = nowIso;
        appendAccountDocumentHistory(record, {
          action: "file_uploaded",
          docKey,
          at: nowIso,
          by: { email },
          fileId,
        });
        saveAccountDocumentRecords(records);
        const payload = publicAccountDocumentRecord(record);
        return sendJson(res, 201, {
          success: true,
          document: payload.documents[docKey],
          record: payload,
        });
      } catch (uploadErr) {
        console.error("account-documents-upload", uploadErr);
        cleanupAccountDocumentUpload(req.file);
        return sendJson(res, 500, { error: "No se pudo guardar el archivo" });
      }
    });
    return;
  }

  if (pathname === "/api/account/documents" && req.method === "GET") {
    const emailParam = parsedUrl.query.email || "";
    const email = normalizeEmailInput(emailParam);
    if (!email) {
      return sendJson(res, 400, { error: "Correo inválido" });
    }
    const records = getAccountDocumentRecords();
    const record = findAccountDocumentRecord(records, email);
    const payload =
      record ? publicAccountDocumentRecord(record) : publicAccountDocumentRecord(createEmptyAccountDocumentRecord(email));
    return sendJson(res, 200, { record: payload });
  }

  const accountDocsMatch = pathname.match(
    /^\/api\/account\/documents\/([^/]+)$/,
  );
  if (accountDocsMatch && req.method === "PUT") {
    const email = normalizeEmailInput(decodeURIComponent(accountDocsMatch[1]));
    if (!email) {
      return sendJson(res, 400, { error: "Correo inválido" });
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        const updates = payload.documents;
        if (!updates || typeof updates !== "object") {
          return sendJson(res, 400, { error: "Datos inválidos" });
        }
        const actor = normalizeAccountDocumentActor(payload.actor);
        const records = getAccountDocumentRecords();
        const record = ensureAccountDocumentRecord(records, email);
        if (!record) {
          return sendJson(res, 400, { error: "No se pudo actualizar el registro" });
        }
        const nowIso = new Date().toISOString();
        let changed = false;
        Object.entries(updates).forEach(([key, value]) => {
          const docKey = normalizeTextInput(key).toLowerCase();
          if (!ACCOUNT_DOCUMENT_KEYS.includes(docKey)) return;
          const entry = record.documents[docKey] || normalizeAccountDocumentEntry({});
          let entryChanged = false;
          if (value && typeof value === "object") {
            if (value.status) {
              const status = normalizeTextInput(value.status).toLowerCase();
              if (!ACCOUNT_DOCUMENT_ALLOWED_STATUSES.has(status)) {
                throw new Error(`Estado inválido para ${docKey}`);
              }
              if (entry.status !== status) {
                entry.status = status;
                entryChanged = true;
                if (status === "approved" || status === "rejected") {
                  entry.reviewedAt = nowIso;
                  entry.reviewedBy = actor;
                } else {
                  entry.reviewedAt = null;
                  entry.reviewedBy = undefined;
                }
              }
            }
            if (Object.prototype.hasOwnProperty.call(value, "notes")) {
              const notes = normalizeTextInput(value.notes).slice(0, 400);
              if (entry.notes !== notes) {
                entry.notes = notes;
                entryChanged = true;
              }
            }
          }
          if (entryChanged) {
            entry.updatedAt = nowIso;
            record.documents[docKey] = normalizeAccountDocumentEntry(entry);
            appendAccountDocumentHistory(record, {
              action: "status_updated",
              docKey,
              status: record.documents[docKey].status,
              notes: record.documents[docKey].notes,
              at: nowIso,
              by: actor,
            });
            changed = true;
          }
        });
        if (changed) {
          record.updatedAt = nowIso;
          saveAccountDocumentRecords(records);
        }
        const response = publicAccountDocumentRecord(record);
        return sendJson(res, 200, { record: response, success: changed });
      } catch (updateErr) {
        console.error("account-documents-update", updateErr);
        const message =
          updateErr instanceof Error ? updateErr.message : "No se pudieron actualizar los documentos";
        return sendJson(res, 400, { error: message });
      }
    });
    return;
  }

  const accountDocDeleteMatch = pathname.match(
    /^\/api\/account\/documents\/([^/]+)\/([^/]+)\/([^/]+)$/,
  );
  if (accountDocDeleteMatch && req.method === "DELETE") {
    const email = normalizeEmailInput(decodeURIComponent(accountDocDeleteMatch[1]));
    const docKey = normalizeTextInput(decodeURIComponent(accountDocDeleteMatch[2])).toLowerCase();
    const fileId = normalizeTextInput(decodeURIComponent(accountDocDeleteMatch[3]));
    if (!email || !ACCOUNT_DOCUMENT_KEYS.includes(docKey) || !fileId) {
      return sendJson(res, 400, { error: "Solicitud inválida" });
    }
    try {
      const records = getAccountDocumentRecords();
      const record = findAccountDocumentRecord(records, email);
      if (!record) {
        return sendJson(res, 404, { error: "Registro no encontrado" });
      }
      const entry = record.documents[docKey] || normalizeAccountDocumentEntry({});
      const index = entry.files.findIndex((file) => file.id === fileId);
      if (index === -1) {
        return sendJson(res, 404, { error: "Archivo no encontrado" });
      }
      const [removed] = entry.files.splice(index, 1);
      if (removed?.filename) {
        const abs = path.join(ACCOUNT_DOCS_DIR, removed.filename);
        if (abs.startsWith(ACCOUNT_DOCS_DIR)) {
          fsp.unlink(abs).catch(() => {});
        }
      }
      const nowIso = new Date().toISOString();
      entry.updatedAt = nowIso;
      record.documents[docKey] = normalizeAccountDocumentEntry(entry);
      record.updatedAt = nowIso;
      appendAccountDocumentHistory(record, {
        action: "file_deleted",
        docKey,
        at: nowIso,
        fileId,
      });
      saveAccountDocumentRecords(records);
      return sendJson(res, 200, { record: publicAccountDocumentRecord(record) });
    } catch (deleteErr) {
      console.error("account-documents-delete", deleteErr);
      return sendJson(res, 500, { error: "No se pudo eliminar el archivo" });
    }
  }

  if (pathname === "/api/wholesale/send-code" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const email = normalizeEmailInput(payload.email);
        const confirmEmail = normalizeEmailInput(payload.confirmEmail);
        if (!email || !confirmEmail || email !== confirmEmail) {
          return sendJson(res, 400, {
            error: "El correo debe coincidir en ambos campos",
          });
        }

        const legalName = normalizeTextInput(payload.legalName);
        const contactName = normalizeTextInput(payload.contactName);
        const phone = normalizeTextInput(payload.phone);

        const code = String(crypto.randomInt(100000, 1000000));
        const nowIso = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        const requests = getWholesaleRequests();
        const idx = requests.findIndex((request) => request.email === email);

        const historyEntry = { action: "code_sent", at: nowIso };

        let updatedEntry;
        let nextRequests;

        if (idx >= 0) {
          const current = requests[idx];
          const history = Array.isArray(current.history)
            ? [...current.history, historyEntry]
            : [historyEntry];
          updatedEntry = {
            ...current,
            email,
            legalName: legalName || current.legalName || "",
            contactName: contactName || current.contactName || "",
            phone: phone || current.phone || "",
            status: "code_sent",
            updatedAt: nowIso,
            verification: {
              code,
              sentAt: nowIso,
              expiresAt,
              confirmed: false,
            },
            history,
          };
          nextRequests = requests.map((entry, entryIdx) =>
            entryIdx === idx ? updatedEntry : entry,
          );
        } else {
          updatedEntry = createWholesaleRequestSeed({
            email,
            legalName,
            contactName,
            phone,
            status: "code_sent",
            createdAt: nowIso,
            submittedAt: nowIso,
            verification: {
              code,
              sentAt: nowIso,
              expiresAt,
              confirmed: false,
            },
            history: [historyEntry],
          });
          nextRequests = [...requests, updatedEntry];
        }

        try {
          saveWholesaleRequests(nextRequests);
        } catch (error) {
          console.error("wholesale send-code save", error);
          return sendJson(res, 500, {
            error:
              "No pudimos registrar la solicitud en este momento. Intentá nuevamente más tarde.",
          });
        }

        try {
          await sendWholesaleVerificationEmail({
            to: email,
            code,
            contactName: updatedEntry.contactName,
          });
          console.log(`[wholesale] Código de verificación enviado a ${email}`);
        } catch (error) {
          const rawMessage =
            typeof error === "string"
              ? error
              : error?.message || "";
          console.warn("wholesale send-code email", rawMessage || error);
          let friendlyMessage = rawMessage;
          if (
            !friendlyMessage ||
            /email service not configured/i.test(friendlyMessage) ||
            /resend/i.test(friendlyMessage)
          ) {
            friendlyMessage =
              "No pudimos enviar el código de verificación. Verificá tu correo o intentá nuevamente en unos minutos.";
          }
          return sendJson(res, 502, {
            error: friendlyMessage,
            saved: true,
          });
        }

        return sendJson(res, 200, {
          success: true,
          message: "Código de verificación enviado",
        });
      } catch (error) {
        console.error("wholesale send-code", error);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  if (pathname === "/api/wholesale/apply" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const email = normalizeEmailInput(payload.email);
        const confirmEmail = normalizeEmailInput(payload.confirmEmail);
        if (!email || !confirmEmail || email !== confirmEmail) {
          return sendJson(res, 400, {
            error: "El correo debe coincidir en ambos campos",
          });
        }

        const verificationCode = normalizeTextInput(payload.verificationCode);
        if (!verificationCode) {
          return sendJson(res, 400, {
            error: "Ingresá el código de verificación enviado por email",
          });
        }

        if (!payload.termsAccepted) {
          return sendJson(res, 400, {
            error: "Debés aceptar la declaración para continuar",
          });
        }

        const requests = getWholesaleRequests();
        const idx = requests.findIndex((request) => request.email === email);
        if (idx === -1) {
          return sendJson(res, 404, {
            error: "No encontramos una solicitud de código para este correo",
          });
        }

        const current = requests[idx];
        const verification = current.verification || {};
        if (!verification.code) {
          return sendJson(res, 400, {
            error: "Solicitá un código de verificación antes de enviar la solicitud",
          });
        }

        if (verification.code !== verificationCode) {
          return sendJson(res, 400, {
            error: "El código de verificación es incorrecto",
          });
        }

        if (verification.expiresAt && Date.now() > Date.parse(verification.expiresAt)) {
          return sendJson(res, 400, {
            error: "El código de verificación expiró, solicitá uno nuevo",
          });
        }

        const nowIso = new Date().toISOString();
        const history = Array.isArray(current.history)
          ? [...current.history, { action: "application_submitted", at: nowIso }]
          : [{ action: "application_submitted", at: nowIso }];

        requests[idx] = {
          ...current,
          email,
          legalName: normalizeTextInput(payload.legalName) || current.legalName || "",
          taxId: normalizeTextInput(payload.taxId) || current.taxId || "",
          contactName:
            normalizeTextInput(payload.contactName) || current.contactName || "",
          phone: normalizeTextInput(payload.phone) || current.phone || "",
          province: normalizeTextInput(payload.province) || current.province || "",
          website: normalizeTextInput(payload.website) || current.website || "",
          companyType:
            normalizeTextInput(payload.companyType) || current.companyType || "",
          salesChannel:
            normalizeTextInput(payload.salesChannel) || current.salesChannel || "",
          monthlyVolume:
            normalizeTextInput(payload.monthlyVolume) || current.monthlyVolume || "",
          systems: normalizeTextInput(payload.systems) || current.systems || "",
          afipUrl: normalizeTextInput(payload.afipUrl) || current.afipUrl || "",
          notes: normalizeTextInput(payload.notes) || current.notes || "",
          termsAccepted: true,
          status: "pending_review",
          updatedAt: nowIso,
          submittedAt: nowIso,
          verification: {
            ...verification,
            code: null,
            confirmed: true,
            confirmedAt: nowIso,
          },
          history,
        };

        saveWholesaleRequests(requests);
        console.log(
          `[wholesale] Solicitud mayorista recibida de ${email} (${requests[idx].legalName || "sin razón social"})`,
        );

        try {
          await sendWholesaleApplicationReceived({
            to: email,
            contactName: requests[idx].contactName,
          });
        } catch (error) {
          console.warn("wholesale apply confirmation email", error?.message || error);
        }

        try {
          await sendWholesaleInternalNotification({
            request: sanitizeWholesaleRequestForResponse(requests[idx]),
            baseUrl: getPublicBaseUrl(getConfig()),
          });
        } catch (error) {
          console.warn("wholesale apply admin email", error?.message || error);
        }

        return sendJson(res, 201, {
          success: true,
          message: "Solicitud mayorista recibida",
        });
      } catch (error) {
        console.error("wholesale apply", error);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  if (pathname === "/api/wholesale/requests" && req.method === "GET") {
    const requests = getWholesaleRequests();
    const sorted = [...requests].sort((a, b) => {
      const tA = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
      const tB = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
      return tB - tA;
    });
    const sanitized = sorted.map((item) => sanitizeWholesaleRequestForResponse(item));
    return sendJson(res, 200, { requests: sanitized });
  }

  const wholesaleMatch = pathname.match(/^\/api\/wholesale\/requests\/([^/]+)$/);
  if (wholesaleMatch && req.method === "GET") {
    const id = normalizeTextInput(decodeURIComponent(wholesaleMatch[1]));
    const requests = getWholesaleRequests();
    const requestEntry = requests.find(
      (r) => r.id === id || (id && r.email === id.toLowerCase()),
    );
    if (!requestEntry) {
      return sendJson(res, 404, { error: "Solicitud no encontrada" });
    }
    return sendJson(res, 200, {
      request: sanitizeWholesaleRequestForResponse(requestEntry),
    });
  }

  if (wholesaleMatch && req.method === "PATCH") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const id = normalizeTextInput(decodeURIComponent(wholesaleMatch[1]));
        const requests = getWholesaleRequests();
        const idx = requests.findIndex(
          (r) => r.id === id || (id && r.email === id.toLowerCase()),
        );
        if (idx === -1) {
          return sendJson(res, 404, { error: "Solicitud no encontrada" });
        }
        const current = { ...requests[idx] };
        const nowIso = new Date().toISOString();
        const actorName = normalizeTextInput(
          payload.actorName || (payload.actor && payload.actor.name),
        );
        const actorEmail = normalizeEmailInput(
          payload.actorEmail || (payload.actor && payload.actor.email),
        );
        const actor = {};
        if (actorName) actor.name = actorName;
        if (actorEmail) actor.email = actorEmail;
        const actorForHistory = Object.keys(actor).length ? actor : undefined;

        let modified = false;
        let tempCredentials = null;
        let emailSent = false;

        if (typeof payload.internalNotes === "string") {
          current.internalNotes = normalizeTextInput(payload.internalNotes);
          modified = true;
        }

        if (typeof payload.assignedTo === "string") {
          current.assignedTo = normalizeTextInput(payload.assignedTo);
          modified = true;
        }

        if (Array.isArray(payload.tags)) {
          const tags = Array.from(
            new Set(
              payload.tags
                .map((tag) => normalizeTextInput(tag))
                .filter((tag) => tag && tag.length <= 40),
            ),
          );
          current.tags = tags;
          modified = true;
        }

        if (payload.timelineEntry && typeof payload.timelineEntry === "object") {
          const timelineNote = normalizeTextInput(payload.timelineEntry.note);
          const timelineType =
            normalizeTextInput(payload.timelineEntry.type) || "note";
          if (timelineNote) {
            const timelineHistory = {
              action: `timeline_${timelineType}`,
              at: nowIso,
              note: timelineNote,
              meta: { type: timelineType },
            };
            if (actorForHistory) {
              timelineHistory.by = actorForHistory;
            }
            const normalizedTimeline = normalizeWholesaleHistoryEntry(
              timelineHistory,
            );
            if (normalizedTimeline) {
              current.history = Array.isArray(current.history)
                ? [...current.history, normalizedTimeline.entry]
                : [normalizedTimeline.entry];
              modified = true;
            }
          }
        }

        let desiredStatus = null;
        if (payload.status) {
          const statusCandidate = normalizeTextInput(payload.status);
          if (!WHOLESALE_ALLOWED_STATUSES.has(statusCandidate)) {
            return sendJson(res, 400, { error: "Estado inválido" });
          }
          desiredStatus = statusCandidate;
        }

        const decisionNote = normalizeTextInput(payload.decisionNote);

        if (desiredStatus && desiredStatus !== current.status) {
          current.status = desiredStatus;
          current.updatedAt = nowIso;
          const statusEntry = {
            action: "status_changed",
            status: desiredStatus,
            at: nowIso,
            note: decisionNote,
          };
          if (actorForHistory) statusEntry.by = actorForHistory;
          const normalizedStatus = normalizeWholesaleHistoryEntry(statusEntry);
          if (normalizedStatus) {
            current.history = Array.isArray(current.history)
              ? [...current.history, normalizedStatus.entry]
              : [normalizedStatus.entry];
          }
          current.review = {
            decisionNote,
            decidedAt: nowIso,
            decidedBy: actorForHistory,
          };
          if (desiredStatus === "approved") {
            current.approvedAt = nowIso;
          } else if (desiredStatus === "rejected") {
            current.rejectedAt = nowIso;
          }
          modified = true;
        } else if (decisionNote) {
          current.review = {
            ...(current.review || {}),
            decisionNote,
            decidedAt: nowIso,
            decidedBy: actorForHistory || (current.review || {}).decidedBy,
          };
          modified = true;
        }

        const effectiveStatus = desiredStatus || current.status;
        if (effectiveStatus === "approved" && payload.createAccount) {
          const email = current.email;
          if (!email) {
            return sendJson(res, 400, {
              error: "No se puede crear la cuenta sin correo válido",
            });
          }
          const users = getUsers();
          const userExists =
            USERS.some((u) => u.email === email) ||
            users.some((u) => u.email === email);
          if (!userExists) {
            const tempPassword = generateTempPassword();
            const name =
              current.contactName || current.legalName || "Cliente Mayorista";
            users.push({
              email,
              password: tempPassword,
              role: "mayorista",
              name,
            });
            saveUsers(users);
            tempCredentials = { tempPassword };
            const accountEntry = {
              action: "account_created",
              at: nowIso,
              note: "Cuenta generada desde el panel de administración",
            };
            if (actorForHistory) accountEntry.by = actorForHistory;
            const normalizedAccount = normalizeWholesaleHistoryEntry(
              accountEntry,
            );
            if (normalizedAccount) {
              current.history = Array.isArray(current.history)
                ? [...current.history, normalizedAccount.entry]
                : [normalizedAccount.entry];
            }
            current.account = {
              createdAt: nowIso,
              createdBy: actorForHistory,
            };

            const clients = getClients();
            const clientIdx = clients.findIndex((c) => c.email === email);
            if (clientIdx >= 0) {
              const existing = clients[clientIdx];
              clients[clientIdx] = {
                ...existing,
                name: existing.name || name,
                phone: existing.phone || current.phone || existing.phone,
                cuit: existing.cuit || current.taxId || existing.cuit,
                notes: existing.notes
                  ? `${existing.notes}\nAlta mayorista ${nowIso}`
                  : `Alta mayorista ${nowIso}`,
              };
            } else {
              clients.push({
                email,
                name,
                cuit: current.taxId || "",
                condicion_iva: "Responsable Inscripto",
                balance: 0,
                limit: 150000,
                phone: current.phone || "",
                address: "",
                city: "",
                country: "Argentina",
                returnCount: 0,
                blockedReturns: false,
                blocked: false,
                notes: `Alta mayorista ${nowIso}`,
              });
            }
            saveClients(clients);
            modified = true;
          }
        }

        const shouldNotify = Boolean(payload.notifyApplicant);
        const notifyStatus = desiredStatus || current.status;
        if (shouldNotify && current.email) {
          const subject =
            normalizeTextInput(payload.emailSubject) ||
            defaultWholesaleEmailSubject(notifyStatus);
          const message = normalizeTextInput(payload.emailMessage);
          try {
            const html = defaultWholesaleEmailBody(
              notifyStatus,
              current,
              message,
              tempCredentials,
            );
            await sendEmail({
              to: current.email,
              subject,
              html,
              type: "no-reply",
            });
            emailSent = true;
            const emailEntry = {
              action: "notification_sent",
              at: nowIso,
              note: subject,
              meta: { status: notifyStatus },
            };
            if (actorForHistory) emailEntry.by = actorForHistory;
            const normalizedEmail = normalizeWholesaleHistoryEntry(emailEntry);
            if (normalizedEmail) {
              current.history = Array.isArray(current.history)
                ? [...current.history, normalizedEmail.entry]
                : [normalizedEmail.entry];
            }
          } catch (err) {
            console.warn("wholesale-notification", err?.message || err);
          }
        }

        if (modified) {
          current.updatedAt = nowIso;
        }
        const { record } = normalizeWholesaleRequestEntry(current);
        requests[idx] = record;
        if (modified || emailSent || tempCredentials) {
          saveWholesaleRequests(requests);
        }
        return sendJson(res, 200, {
          success: true,
          request: sanitizeWholesaleRequestForResponse(record),
          emailSent,
          credentials: tempCredentials,
        });
      } catch (error) {
        console.error("wholesale-request-update", error);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  const wholesaleDocsMatch = pathname.match(
    /^\/api\/wholesale\/requests\/([^/]+)\/documents$/,
  );
  if (wholesaleDocsMatch && req.method === "POST") {
    const id = normalizeTextInput(decodeURIComponent(wholesaleDocsMatch[1]));
    const requests = getWholesaleRequests();
    const idx = requests.findIndex(
      (r) => r.id === id || (id && r.email === id.toLowerCase()),
    );
    if (idx === -1) {
      return sendJson(res, 404, { error: "Solicitud no encontrada" });
    }
    generalUpload.single("file")(req, res, (err) => {
      if (err) {
        console.error("wholesale-doc-upload", err);
        return sendJson(res, 400, { error: err.message || "Error al subir" });
      }
      if (!req.file) {
        return sendJson(res, 400, { error: "No se recibió archivo" });
      }
      try {
        const nowIso = new Date().toISOString();
        const label = normalizeTextInput(req.body && req.body.label);
        const actorName = normalizeTextInput(
          (req.body && req.body.actorName) ||
            (req.body && req.body.actor && req.body.actor.name),
        );
        const actorEmail = normalizeEmailInput(
          (req.body && req.body.actorEmail) ||
            (req.body && req.body.actor && req.body.actor.email),
        );
        const actor = {};
        if (actorName) actor.name = actorName;
        if (actorEmail) actor.email = actorEmail;
        const actorForHistory = Object.keys(actor).length ? actor : undefined;

        const doc = {
          label,
          filename: req.file.filename,
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          uploadedAt: nowIso,
          url: `/uploads/${encodeURIComponent(req.file.filename)}`,
        };
        if (actorForHistory) {
          doc.uploadedBy = actorForHistory;
        }
        const normalizedDoc = normalizeWholesaleDocumentEntry(doc);
        const requestEntry = {
          ...requests[idx],
        };
        requestEntry.updatedAt = nowIso;
        requestEntry.documents = Array.isArray(requestEntry.documents)
          ? [...requestEntry.documents, normalizedDoc.document]
          : [normalizedDoc.document];
        const historyEntry = {
          action: "document_added",
          at: nowIso,
          note: normalizedDoc.document.label || normalizedDoc.document.originalName,
        };
        if (actorForHistory) historyEntry.by = actorForHistory;
        const normalizedHistory = normalizeWholesaleHistoryEntry(historyEntry);
        if (normalizedHistory) {
          requestEntry.history = Array.isArray(requestEntry.history)
            ? [...requestEntry.history, normalizedHistory.entry]
            : [normalizedHistory.entry];
        }
        const { record } = normalizeWholesaleRequestEntry(requestEntry);
        requests[idx] = record;
        saveWholesaleRequests(requests);
        return sendJson(res, 201, {
          success: true,
          document: normalizedDoc.document,
          request: sanitizeWholesaleRequestForResponse(record),
        });
      } catch (error) {
        console.error("wholesale-documents", error);
        return sendJson(res, 500, { error: "No se pudo adjuntar el archivo" });
      }
    });
    return;
  }

  const wholesaleDocDeleteMatch = pathname.match(
    /^\/api\/wholesale\/requests\/([^/]+)\/documents\/([^/]+)$/,
  );
  if (wholesaleDocDeleteMatch && req.method === "DELETE") {
    const id = normalizeTextInput(decodeURIComponent(wholesaleDocDeleteMatch[1]));
    const docId = normalizeTextInput(
      decodeURIComponent(wholesaleDocDeleteMatch[2]),
    );
    const requests = getWholesaleRequests();
    const idx = requests.findIndex(
      (r) => r.id === id || (id && r.email === id.toLowerCase()),
    );
    if (idx === -1) {
      return sendJson(res, 404, { error: "Solicitud no encontrada" });
    }
    const requestEntry = { ...requests[idx] };
    const docs = Array.isArray(requestEntry.documents)
      ? [...requestEntry.documents]
      : [];
    const docIndex = docs.findIndex((doc) => doc.id === docId);
    if (docIndex === -1) {
      return sendJson(res, 404, { error: "Documento no encontrado" });
    }
    const [removed] = docs.splice(docIndex, 1);
    requestEntry.documents = docs;
    const nowIso = new Date().toISOString();
    requestEntry.updatedAt = nowIso;
    const historyEntry = {
      action: "document_removed",
      at: nowIso,
      note: removed ? removed.label || removed.originalName : "",
    };
    const normalizedHistory = normalizeWholesaleHistoryEntry(historyEntry);
    if (normalizedHistory) {
      requestEntry.history = Array.isArray(requestEntry.history)
        ? [...requestEntry.history, normalizedHistory.entry]
        : [normalizedHistory.entry];
    }
    const { record } = normalizeWholesaleRequestEntry(requestEntry);
    requests[idx] = record;
    saveWholesaleRequests(requests);
    if (removed && removed.filename) {
      const absPath = path.join(UPLOADS_DIR, removed.filename);
      if (absPath.startsWith(UPLOADS_DIR)) {
        fs.unlink(absPath, () => {});
      }
    }
    return sendJson(res, 200, {
      success: true,
      request: sanitizeWholesaleRequestForResponse(record),
    });
  }

  // API: registro de un nuevo usuario (clientes)
  if (pathname === "/api/register" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { email, password, name, role, profile: profilePayload } = JSON.parse(body || "{}");
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
        const normalizedProfile =
          profilePayload && typeof profilePayload === "object"
            ? profilePayload
            : null;
        if (clientIdx === -1) {
          let baseClient = {
            email,
            name: name || "Cliente",
            cuit: "",
            condicion_iva: "",
            balance: 0,
            limit: 100000,
            phone: "",
            address: "",
            city: "",
            province: "",
            country: "Argentina",
            zip: "",
            created_at: new Date().toISOString(),
          };
          const profileUpdate = {
            ...(normalizedProfile || {}),
            name: name || baseClient.name,
          };
          baseClient = applyProfileToClient(baseClient, profileUpdate);
          if (!baseClient.created_at) {
            baseClient.created_at = new Date().toISOString();
          }
          clients.push(baseClient);
        } else {
          const current = clients[clientIdx];
          const merged = {
            ...current,
            name: name || current.name || "Cliente",
          };
          const profileUpdate = {
            ...(normalizedProfile || {}),
            name: merged.name,
          };
          clients[clientIdx] = applyProfileToClient(merged, profileUpdate);
        }
        saveClients(clients);
        // Generar token
        const token = Buffer.from(`${email}:${Date.now()}`).toString("base64");
        const clientRecord =
          clients.find((c) => c.email === email) ||
          (normalizedProfile
            ? applyProfileToClient(
                {
                  email,
                  name: name || "Cliente",
                  cuit: "",
                  condicion_iva: "",
                  balance: 0,
                  limit: 100000,
                  phone: "",
                  address: "",
                  city: "",
                  province: "",
                  country: "Argentina",
                  zip: "",
                  created_at: new Date().toISOString(),
                },
                { ...(normalizedProfile || {}), name: name || "Cliente" },
              )
            : null);
        const profile = buildClientProfile(clientRecord, email);
        return sendJson(res, 201, {
          success: true,
          token,
          role: userRole,
          name: name || "Cliente",
          profile,
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
          const customerEmail = normalizeEmailInput(customer.email);
          if (customerEmail) {
            const clients = getClients();
            const idx = clients.findIndex(
              (c) => normalizeEmailInput(c.email) === customerEmail,
            );
            const profileUpdate = {
              email: customer.email,
              nombre: customer.nombre ?? customer.name ?? "",
              apellido: customer.apellido ?? "",
              phone: customer.telefono ?? customer.phone ?? "",
              direccion:
                (customer.direccion && typeof customer.direccion === "object"
                  ? customer.direccion
                  : {
                      calle: customer.calle,
                      numero: customer.numero,
                      piso: customer.piso,
                      localidad: customer.localidad,
                      provincia: customer.provincia,
                      cp: customer.cp,
                    }) || {},
              metodo_envio: data.metodo_envio,
            };
            if (idx === -1) {
              let baseClient = {
                email: customer.email,
                name:
                  customer.nombre ||
                  customer.name ||
                  `${customer.firstName || "Cliente"}`,
                cuit: customer.cuit || "",
                condicion_iva: "",
                balance: 0,
                limit: 100000,
                phone: "",
                address: "",
                city: "",
                province: "",
                country: "Argentina",
                zip: "",
                created_at: new Date().toISOString(),
              };
              baseClient = applyProfileToClient(baseClient, profileUpdate);
              baseClient.balance += total;
              baseClient.last_order_at = new Date().toISOString();
              baseClient.last_order_id = orderId;
              clients.push(baseClient);
              saveClients(clients);
            } else {
              const current = clients[idx];
              const merged = applyProfileToClient(current, {
                ...profileUpdate,
                name:
                  customer.nombre ||
                  customer.name ||
                  current.name ||
                  "Cliente",
              });
              merged.balance = Number(merged.balance || 0) + total;
              merged.last_order_at = new Date().toISOString();
              merged.last_order_id = orderId;
              clients[idx] = merged;
              saveClients(clients);
            }
          }
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
    const metodoQuery = parsedUrl.query.metodo || parsedUrl.query.method || "";
    const table = getShippingTable();
    const normalizedMethod =
      table.methods.find(
        (m) => m.id === String(metodoQuery || "").trim().toLowerCase(),
      ) ||
      table.methods.find((m) => m.id === "estandar") ||
      table.methods[0];
    const metodo = normalizedMethod ? normalizedMethod.id : "estandar";
    const costo = getShippingCost(prov, metodo, table);
    const provinciaMatch = table.costos.find(
      (row) => row.provincia.toLowerCase() === String(prov || "").toLowerCase(),
    );
    const fallbackProvincia =
      provinciaMatch || table.costos.find((row) => row.provincia === "Otras");
    return sendJson(res, 200, {
      costo,
      metodo,
      metodoLabel: normalizedMethod ? normalizedMethod.label : metodo,
      provincia: prov,
      metodos: fallbackProvincia ? fallbackProvincia.metodos : {},
    });
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
        const shippingTable = getShippingTable();
        const rawMethod = String(
          data.metodo ||
            data.metodo_envio ||
            data.cliente?.metodo ||
            data.cliente?.metodo_envio ||
            "",
        )
          .trim()
          .toLowerCase();
        const resolvedMethod =
          shippingTable.methods.find((m) => m.id === rawMethod) ||
          shippingTable.methods.find((m) => m.id === "estandar") ||
          shippingTable.methods[0];
        const shippingMethodId = resolvedMethod ? resolvedMethod.id : rawMethod;
        const shippingLabel = resolvedMethod
          ? resolvedMethod.label
          : getShippingMethodLabel(shippingMethodId, shippingTable);
        const shippingCost = getShippingCost(
          provincia,
          shippingMethodId,
          shippingTable,
        );
        const subtotal = items.reduce((t, it) => t + it.price * it.quantity, 0);
        const grandTotal = subtotal + (shippingCost || 0);
        const impuestosCalc = Math.round(subtotal * 0.21);
        const totals = {
          subtotal,
          shipping: shippingCost,
          grand_total: grandTotal,
        };
        const itemsSummary = items
          .map((it) => `${it.name} x${it.quantity}`)
          .join(", ");
        const summaryParts = [itemsSummary].filter((part) => part);
        if (shippingMethodId === "retiro") {
          summaryParts.push("Retiro en local");
        } else if (shippingCost > 0) {
          summaryParts.push(`Envío ${shippingLabel}`);
        }
        const combinedSummary = summaryParts.join(", ");
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
          metodo_envio: shippingLabel || data.metodo_envio || "Correo Argentino",
          shipping_method: shippingMethodId,
          comentarios: data.comentarios || "",
          total: grandTotal,
          subtotal,
          totals,
          items_summary: combinedSummary,
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
            const prefItems = items.map((it) => ({
                title: it.name,
                quantity: Number(it.quantity),
                unit_price: Number(it.price),
              }));
            if (shippingCost > 0) {
              prefItems.push({
                title: `Envío (${shippingLabel})`,
                quantity: 1,
                unit_price: shippingCost,
              });
            }
            const pref = {
              items: prefItems,
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
      const emailParam =
        typeof query.email === "string" ? query.email : undefined;
      const normalizedEmail = normalizeEmailInput(emailParam);
      if (normalizedEmail) {
        const allOrders = await ordersRepo.getAll();
        const filtered = allOrders.filter((order) => {
          const customerEmail = normalizeEmailInput(
            resolveOrderCustomerEmail(order),
          );
          if (customerEmail && customerEmail === normalizedEmail) return true;
          let normalizedCustomer = null;
          try {
            normalizedCustomer =
              typeof ordersRepo.normalizeCustomer === "function"
                ? ordersRepo.normalizeCustomer(order)
                : null;
          } catch {
            normalizedCustomer = null;
          }
          const normalizedCustomerEmail = normalizeEmailInput(
            normalizedCustomer?.email,
          );
          return normalizedCustomerEmail
            ? normalizedCustomerEmail === normalizedEmail
            : false;
        });
        const mapped = filtered.map((order) => normalizeOrderForCustomer(order));
        mapped.sort((a, b) => {
          const timeA =
            Date.parse(
              a.created_at || a.fecha || a.date || a.updated_at || a.updatedAt || 0,
            ) || 0;
          const timeB =
            Date.parse(
              b.created_at || b.fecha || b.date || b.updated_at || b.updatedAt || 0,
            ) || 0;
          return timeB - timeA;
        });
        const summary = {
          total: mapped.length,
          paid: 0,
          pending: 0,
          canceled: 0,
          total_amount: 0,
        };
        mapped.forEach((order) => {
          const code = mapPaymentStatusCode(
            order.payment_status_code || order.payment_status || order.estado_pago,
          );
          summary.total_amount +=
            Number(order.total_amount || order.total || 0) || 0;
          if (code === "approved") summary.paid += 1;
          else if (code === "rejected") summary.canceled += 1;
          else summary.pending += 1;
        });
        return sendJson(res, 200, { orders: mapped, summary });
      }
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
      const normalizedStatus = normalizeStatusFilter(statusParam);

      const orders = await ordersRepo.list({
        date: filterDate,
        status: normalizedStatus,
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
  if (
    pathname.startsWith("/api/orders/") &&
    req.method === "GET" &&
    !pathname.endsWith("/invoices") &&
    !pathname.includes("/invoices/")
  ) {
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
      const responseOrder = {
        ...normalized,
        customer,
        shipping_address: shippingAddress,
        items,
      };
      const etagSource = JSON.stringify({
        updated:
          responseOrder.updated_at ||
          responseOrder.updatedAt ||
          responseOrder.updated ||
          responseOrder.fecha_actualizacion ||
          responseOrder.created_at ||
          responseOrder.createdAt ||
          responseOrder.fecha ||
          null,
        payment: responseOrder.payment_status_code || null,
        shipping: responseOrder.shipping_status_code || null,
        tracking: responseOrder.tracking || null,
        shippingNote: responseOrder.shipping_note || responseOrder.nota_envio || null,
      });
      const etag = `"${crypto.createHash("sha1").update(etagSource).digest("hex")}"`;
      const cacheHeaders = {
        "Cache-Control": "no-store, must-revalidate",
        ETag: etag,
      };
      const incomingEtag = req.headers["if-none-match"];
      if (incomingEtag && incomingEtag === etag) {
        return sendStatus(res, 304, cacheHeaders);
      }
      return sendJson(
        res,
        200,
        {
          order: responseOrder,
        },
        cacheHeaders,
      );
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
          nextShippingCode === "preparing" &&
          prevShippingCode !== "preparing"
        ) {
          const payload = prepareOrderEmailPayload(orders[index]);
          if (payload) {
            try {
              await sendOrderPreparing({
                to: payload.recipient,
                order: payload.order,
              });
            } catch (emailErr) {
              console.error("order preparing email failed", emailErr);
            }
          }
        }
        if (
          incomingShippingStatus != null &&
          nextShippingCode === "shipped" &&
          prevShippingCode !== "shipped"
        ) {
          const payload = prepareOrderEmailPayload(orders[index]);
          if (payload) {
            try {
              await sendOrderShipped({
                to: payload.recipient,
                order: payload.order,
                carrier: payload.carrier,
                tracking: payload.tracking,
                trackingUrl: payload.trackingUrl,
                statusUrl: payload.statusUrl,
              });
            } catch (emailErr) {
              console.error("order shipped email failed", emailErr);
            }
          }
        }
        if (
          incomingShippingStatus != null &&
          nextShippingCode === "delivered" &&
          prevShippingCode !== "delivered"
        ) {
          const payload = prepareOrderEmailPayload(orders[index]);
          if (payload) {
            try {
              await sendOrderDelivered({
                to: payload.recipient,
                order: payload.order,
                statusUrl: payload.statusUrl,
                trackingUrl: payload.trackingUrl,
              });
            } catch (emailErr) {
              console.error("order delivered email failed", emailErr);
            }
          }
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

  if (pathname.startsWith("/api/clients/") && req.method === "GET") {
    const rawEmail = decodeURIComponent(pathname.split("/").pop() || "");
    const normalizedEmail = normalizeEmailInput(rawEmail);
    if (!normalizedEmail) {
      return sendJson(res, 400, { error: "Correo inválido" });
    }
    try {
      const clients = getClients();
      const client = clients.find(
        (c) => normalizeEmailInput(c.email) === normalizedEmail,
      );
      if (!client) {
        return sendJson(res, 404, { error: "Cliente no encontrado" });
      }
      const profile = buildClientProfile(client, rawEmail);
      return sendJson(res, 200, { client, profile });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "No se pudo obtener el cliente" });
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
        const profileUpdate =
          update.profile && typeof update.profile === "object"
            ? { ...update.profile }
            : null;
        if (profileUpdate) delete update.profile;
        const clients = getClients();
        const idx = clients.findIndex((c) => c.email === email);
        if (idx === -1) {
          return sendJson(res, 404, { error: "Cliente no encontrado" });
        }
        const merged = { ...clients[idx] };
        Object.keys(update).forEach((key) => {
          if (key === "contact_preferences" && typeof update[key] === "object") {
            const prefs = update[key];
            merged.contact_preferences = {
              ...(merged.contact_preferences || {}),
              whatsapp:
                prefs.whatsapp !== undefined
                  ? Boolean(prefs.whatsapp)
                  : merged.contact_preferences?.whatsapp || false,
              email:
                prefs.email !== undefined
                  ? Boolean(prefs.email)
                  : merged.contact_preferences?.email || false,
            };
          } else if (update[key] !== undefined) {
            merged[key] = update[key];
          }
        });
        const profilePayload = {
          ...(profileUpdate || {}),
        };
        if (update.name !== undefined && profilePayload.name === undefined) {
          profilePayload.name = update.name;
        }
        clients[idx] = applyProfileToClient(merged, profilePayload);
        saveClients(clients);
        const profile = buildClientProfile(clients[idx], email);
        return sendJson(res, 200, {
          success: true,
          client: clients[idx],
          profile,
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
    pathname.endsWith("/invoices") &&
    req.method === "POST"
  ) {
    const segments = pathname.split("/").filter(Boolean);
    const orderId = decodeURIComponent(segments[2] || "");
    if (!orderId) {
      return sendJson(res, 400, { error: "Pedido inválido" });
    }
    req.orderId = orderId;
    invoiceUpload.single("file")(req, res, async (err) => {
      if (err) {
        console.error(err);
        return sendJson(res, 400, { error: "No se pudo procesar el archivo" });
      }
      try {
        if (!req.file) {
          return sendJson(res, 400, { error: "Archivo requerido" });
        }
        const filename = req.file.filename;
        const uploadedAt = new Date().toISOString();
        const record = {
          filename,
          url: `/files/invoices/${encodeURIComponent(filename)}`,
          uploaded_at: uploadedAt,
          original_name: req.file.originalname || undefined,
        };
        const updatedOrder = await ordersRepo.appendInvoice(orderId, record);
        const invoices = await ordersRepo.listInvoices(orderId, {
          includeDeleted: true,
        });
        const payload = prepareOrderEmailPayload(updatedOrder);
        if (payload) {
          const invoiceUrl = buildAbsoluteUrl(payload.baseUrl, record.url);
          try {
            await sendInvoiceUploaded({
              to: payload.recipient,
              order: payload.order,
              invoiceUrl,
              statusUrl: payload.statusUrl,
            });
          } catch (emailErr) {
            console.error("invoice upload email failed", emailErr);
          }
        }
        return sendJson(res, 201, { invoice: record, invoices });
      } catch (error) {
        console.error(error);
        if (error.code === 'ORDER_NOT_FOUND') {
          return sendJson(res, 404, { error: "Pedido no encontrado" });
        }
        if (error.code === 'INVALID_INVOICE') {
          return sendJson(res, 400, { error: "Datos de factura inválidos" });
        }
        return sendJson(res, 500, { error: "No se pudo guardar la factura" });
      }
    });
    return;
  }

  if (
    pathname.startsWith("/api/orders/") &&
    pathname.endsWith("/invoices") &&
    req.method === "GET"
  ) {
    const segments = pathname.split("/").filter(Boolean);
    const orderId = decodeURIComponent(segments[2] || "");
    if (!orderId) {
      return sendJson(res, 400, { error: "Pedido inválido" });
    }
    try {
      const order = await ordersRepo.getById(orderId);
      if (!order) {
        return sendJson(res, 404, { error: "Pedido no encontrado" });
      }
      const invoices = await ordersRepo.listInvoices(orderId, {
        includeDeleted: true,
      });
      return sendJson(res, 200, { invoices });
    } catch (error) {
      console.error(error);
      return sendJson(res, 500, { error: "No se pudieron obtener las facturas" });
    }
  }

  if (
    pathname.startsWith("/api/orders/") &&
    pathname.includes("/invoices/") &&
    req.method === "DELETE"
  ) {
    const segments = pathname.split("/").filter(Boolean);
    const orderId = decodeURIComponent(segments[2] || "");
    const filename = decodeURIComponent(segments[4] || "");
    if (!orderId || !filename) {
      return sendJson(res, 400, { error: "Parámetros inválidos" });
    }
    try {
      await ordersRepo.softDeleteInvoice(orderId, filename);
      const invoices = await ordersRepo.listInvoices(orderId, {
        includeDeleted: true,
      });
      return sendJson(res, 200, { success: true, invoices });
    } catch (error) {
      console.error(error);
      if (error.code === 'ORDER_NOT_FOUND') {
        return sendJson(res, 404, { error: "Pedido no encontrado" });
      }
      if (error.code === 'INVOICE_NOT_FOUND') {
        return sendJson(res, 404, { error: "Factura no encontrada" });
      }
      return sendJson(res, 500, { error: "No se pudo eliminar la factura" });
    }
  }

  if (pathname.startsWith("/api/invoice-files/") && req.method === "GET") {
    const orderId = decodeURIComponent(pathname.split("/").pop());
    if (!orderId) {
      return sendJson(res, 400, { error: "Pedido inválido" });
    }
    try {
      const invoices = await ordersRepo.listInvoices(orderId);
      if (!invoices.length) {
        return sendJson(res, 404, { error: "Factura no encontrada" });
      }
      const invoice = invoices[0];
      const response = {
        fileName: invoice.filename || null,
        url: invoice.url,
      };
      return sendJson(res, 200, response);
    } catch (error) {
      console.error(error);
      if (error.code === 'ORDER_NOT_FOUND') {
        return sendJson(res, 404, { error: "Pedido no encontrado" });
      }
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

        const shippingTable = getShippingTable();
        const rawShippingMethod = String(
          usuario?.metodo || usuario?.metodo_envio || "",
        )
          .trim()
          .toLowerCase();
        let shippingMethodId = rawShippingMethod;
        let shippingCost = Number(usuario?.costo ?? usuario?.costo_envio);
        if (!Number.isFinite(shippingCost) || shippingCost < 0) {
          shippingCost = 0;
        }
        const resolvedMethod =
          shippingTable.methods.find((m) => m.id === shippingMethodId) ||
          shippingTable.methods.find((m) => m.id === "estandar") ||
          shippingTable.methods[0];
        if (resolvedMethod) {
          shippingMethodId = resolvedMethod.id;
        }
        if (!shippingMethodId) {
          shippingMethodId = shippingCost > 0 ? "estandar" : "retiro";
        }
        if (!shippingCost) {
          const resolvedCost = getShippingCost(
            usuario?.provincia,
            shippingMethodId,
            shippingTable,
          );
          if (Number.isFinite(resolvedCost) && resolvedCost >= 0) {
            shippingCost = resolvedCost;
          }
        }
        if (shippingMethodId === "retiro") {
          shippingCost = 0;
        }
        const shippingLabel = getShippingMethodLabel(
          shippingMethodId,
          shippingTable,
        );

        if (usuario && typeof usuario === "object") {
          usuario.metodo = shippingMethodId;
          usuario.metodo_envio = shippingLabel;
          usuario.costo = shippingCost;
          usuario.costo_envio = shippingCost;
        }

        const items = carrito.map(
          ({ titulo, precio, cantidad, currency_id }) => ({
            title: String(titulo),
            unit_price: Number(precio),
            quantity: Number(cantidad),
            currency_id: currency_id || "ARS",
          }),
        );

        if (shippingCost > 0) {
          items.push({
            title: `Envío (${shippingLabel})`,
            unit_price: shippingCost,
            quantity: 1,
            currency_id: "ARS",
          });
        }

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
        const subtotal = itemsForOrder.reduce(
          (t, it) => t + it.price * it.quantity,
          0,
        );
        const grandTotal = subtotal + (shippingCost || 0);
        const totals = {
          subtotal,
          shipping: shippingCost,
          grand_total: grandTotal,
        };
        const itemsSummary = itemsForOrder
          .map((it) => `${it.name} x${it.quantity}`)
          .join(", ");
        const summaryParts = [itemsSummary].filter((part) => part);
        if (shippingMethodId === "retiro") {
          summaryParts.push("Retiro en local");
        } else if (shippingCost > 0) {
          summaryParts.push(`Envío ${shippingLabel}`);
        }
        const combinedSummary = summaryParts.join(", ");
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
          notification_url: `${API_BASE_URL}/webhooks/mp`,
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
              items_summary: combinedSummary,
              subtotal,
              totals,
              total: grandTotal,
              created_at: now,
              fecha: now,
              provincia_envio: usuario?.provincia || "",
              costo_envio: shippingCost,
              metodo_envio: shippingLabel,
              shipping_method: shippingMethodId,
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
            row.items_summary = combinedSummary;
            row.subtotal = subtotal;
            row.totals = totals;
            row.total = grandTotal;
            if (!row.created_at) row.created_at = now;
            row.fecha = row.created_at;
            row.provincia_envio =
              row.provincia_envio || usuario?.provincia || "";
            row.costo_envio = shippingCost;
            row.metodo_envio = shippingLabel;
            row.shipping_method = shippingMethodId;
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

  if (pathname === "/robots.txt" && req.method === "GET") {
    const cfg = getConfig();
    const siteBase = getPublicBaseUrl(cfg);
    const lines = [
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /admin/",
      "Disallow: /backend/",
    ];
    if (siteBase) {
      lines.push(`Sitemap: ${siteBase}/sitemap.xml`);
    }
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(lines.join("\n") + "\n");
    return;
  }

  if (pathname === "/sitemap.xml" && req.method === "GET") {
    const cfg = getConfig();
    const siteBase = getPublicBaseUrl(cfg);
    const products = getProducts();
    const xml = buildSitemapXml(siteBase, products);
    res.writeHead(200, {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(xml);
    return;
  }

  // === Archivos estáticos persistentes ===
  // 1) Facturas de pedidos (PDF/XML) guardadas en el disco persistente.
  //    La ruta pública es /assets/invoices/<nombre de archivo>. Se sirve
  //    directamente desde INVOICES_DIR para que los archivos sobrevivan a
  //    desplegues. Se controla que el path esté dentro del directorio.
  if (
    (pathname.startsWith("/assets/invoices/") ||
      pathname.startsWith("/files/invoices/")) &&
    req.method === "GET"
  ) {
    const file = decodeURIComponent(
      pathname.replace(/^\/(?:assets|files)\/invoices\//, ""),
    );
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
        "Content-Type": "application/pdf",
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
    const seoConfig = getConfig();
    const siteBase = getPublicBaseUrl(seoConfig);
    const canonical = `${siteBase}/p/${encodeURIComponent(slug)}`;
    const rawImages = Array.isArray(product.images)
      ? product.images.filter(Boolean)
      : [];
    const legacyImages = !rawImages.length && product.image ? [product.image] : [];
    const imageList = [...rawImages, ...legacyImages]
      .map((src) => absoluteUrl(src, siteBase))
      .filter(Boolean);
    const alts = Array.isArray(product.images_alt) ? product.images_alt : [];
    const defaultAlt = name || "Imagen del producto";
    const primaryImage = imageList[0] || null;
    const primaryAlt = (alts[0] && String(alts[0]).trim()) || defaultAlt;
    const availability =
      typeof product.stock === "number" && product.stock > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock";
    const brandName =
      typeof product.brand === "string" && product.brand.trim()
        ? product.brand.trim()
        : null;
    const skuValue =
      typeof product.sku === "string" && product.sku.trim()
        ? product.sku.trim()
        : product.id != null
          ? String(product.id)
          : null;
    const descriptionValue =
      typeof desc === "string" && desc.trim() ? desc.trim() : null;
    const priceSource =
      product.price_minorista ??
      product.price ??
      product.price_mayorista ??
      0;
    const numericPrice = Number(priceSource);
    const formattedPrice = Number.isFinite(numericPrice)
      ? numericPrice.toFixed(2)
      : "0.00";
    const ld = {
      "@context": "https://schema.org",
      "@type": "Product",
      name,
      ...(imageList.length ? { image: imageList } : {}),
      ...(descriptionValue ? { description: descriptionValue } : {}),
      ...(skuValue ? { sku: skuValue } : {}),
      ...(brandName
        ? { brand: { "@type": "Brand", name: brandName } }
        : {}),
      offers: {
        "@type": "Offer",
        url: canonical,
        priceCurrency: "ARS",
        price: formattedPrice,
        availability,
        itemCondition: "https://schema.org/NewCondition",
      },
    };
    const ogImagesMeta = imageList
      .map((img, index) => {
        const parts = [`<meta property=\"og:image\" content=\"${esc(img)}\">`];
        const alt = alts[index];
        const resolvedAlt =
          typeof alt === "string" && alt.trim() ? alt.trim() : defaultAlt;
        if (resolvedAlt) {
          parts.push(
            `<meta property=\"og:image:alt\" content=\"${esc(resolvedAlt)}\">`,
          );
        }
        return parts.join("");
      })
      .join("");
    const { head: templateHead, body: templateBody } = getProductTemplateParts();
    const fallbackName = name && name.trim() ? name.trim() : "Producto";
    const metaTitleRaw =
      typeof product.meta_title === "string" && product.meta_title.trim()
        ? product.meta_title.trim()
        : fallbackName;
    const hasBrand = typeof product.brand === "string" && product.brand.trim();
    const title = hasBrand ? metaTitleRaw : `${metaTitleRaw} | NERIN Repuestos`;
    const description =
      typeof desc === "string" && desc.trim()
        ? desc.trim()
        : `Compra ${fallbackName} en NERIN.`;
    const keywordList = Array.isArray(product.tags)
      ? product.tags
          .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
          .filter(Boolean)
      : [];
    const keywords = keywordList.length
      ? keywordList.join(", ")
      : [fallbackName, product.brand, product.category]
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean)
          .join(", ");
    const keywordsMeta = keywords
      ? `<meta name="keywords" content="${esc(keywords)}">`
      : "";
    const twitterCardType = primaryImage ? "summary_large_image" : "summary";
    const twitterImageMeta = primaryImage
      ? `<meta name="twitter:image" content="${esc(primaryImage)}"><meta name="twitter:image:alt" content="${esc(primaryAlt)}">`
      : "";
    const breadcrumbs = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Inicio",
          item: absoluteUrl("/", siteBase),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Productos",
          item: absoluteUrl("/shop.html", siteBase),
        },
        {
          "@type": "ListItem",
          position: 3,
          name: name || fallbackName,
          item: canonical,
        },
      ],
    };
    const head = [
      templateHead,
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(description)}">`,
      keywordsMeta,
      `<link rel="canonical" href="${esc(canonical)}">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(description)}">`,
      `<meta property="og:url" content="${esc(canonical)}">`,
      ogImagesMeta,
      `<meta name="twitter:card" content="${twitterCardType}">`,
      `<meta name="twitter:title" content="${esc(title)}">`,
      `<meta name="twitter:description" content="${esc(description)}">`,
      `<meta name="twitter:url" content="${esc(canonical)}">`,
      twitterImageMeta,
      `<script type="application/ld+json" id="product-jsonld">${safeJsonForScript(ld)}</script>`,
      `<script type="application/ld+json" id="product-breadcrumbs">${safeJsonForScript(breadcrumbs)}</script>`,
    ]
      .filter(Boolean)
      .join("");
    const html = `<!DOCTYPE html><html lang="es"><head>${head}</head>${templateBody}</html>`;
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

  // Servir calculadora de importación embebida desde /import_calc_frontend
  if (
    pathname === "/import_calc_frontend" ||
    pathname === "/import_calc_frontend/" ||
    pathname.startsWith("/import_calc_frontend/")
  ) {
    const calcRoot = path.join(__dirname, "../import_calc_frontend");
    let relativeCalcPath = pathname.replace(/^\/import_calc_frontend\/?/, "");
    if (!relativeCalcPath) {
      relativeCalcPath = "index.html";
    }
    relativeCalcPath = path
      .normalize(relativeCalcPath)
      .replace(/^([.][.][/\\])+/, "");
    let calcFilePath = path.join(calcRoot, relativeCalcPath);
    fs.stat(calcFilePath, (err, stats) => {
      if (err || stats.isDirectory()) {
        calcFilePath = path.join(calcRoot, "index.html");
      }
      serveStatic(calcFilePath, res);
    });
    return;
  }

  // Servir archivos estáticos del frontend y assets
  let filePath;
  // Servir recursos dentro de /assets (imágenes)
  if (pathname.startsWith("/assets/")) {
    // Eliminar la barra inicial para evitar que path.join ignore los segmentos anteriores
    filePath = path.join(__dirname, "..", pathname.slice(1));
  } else {
    // Normalizar la ruta para evitar que un leading slash borre los segmentos previos
    let relativePath = pathname.replace(/^\/+/, "");
    if (!relativePath) {
      relativePath = "index.html";
    }
    // Evitar path traversal (../../) tras normalizar la ruta
    relativePath = path
      .normalize(relativePath)
      .replace(/^([.][.][/\\])+/, "");
    filePath = path.join(__dirname, "../frontend", relativePath);
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
