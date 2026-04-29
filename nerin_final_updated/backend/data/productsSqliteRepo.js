const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const sqlite3 = require("sqlite3");
const productsStreamRepo = require("./productsStreamRepo");
const { dataPath } = require("../utils/dataDir");

const PRODUCTS_JSON_PATH = dataPath("products.json");
const SQLITE_PATH = dataPath("products.sqlite");
const MANIFEST_PATH = dataPath("products.manifest.json");
const COUNT_CACHE_TTL_MS = 60_000;
const PRODUCTS_SQLITE_SCHEMA_VERSION = 5;
const CATALOG_MAPPING_VERSION = 2;

const REJECTED_STATE_VALUES = new Set([
  "hidden",
  "private",
  "draft",
  "disabled",
  "archived",
  "deleted",
]);
const PUBLIC_DESCRIPTION_FALLBACK =
  "Producto disponible para cotización. Consultanos por compatibilidad, stock y condiciones.";

let dbInstance = null;
let ftsEnabled = false;
let dbReadyPromise = null;
let dbReady = false;
let rebuildPromise = null;
const countCache = new Map();
const SQLITE_CORRUPT_CODE = "CATALOG_SQLITE_CORRUPT";
const catalogState = {
  ready: false,
  initializing: false,
  rebuilding: false,
  corruptDetected: false,
  lastError: null,
  lastErrorAt: null,
  lastReadyAt: null,
  lastRebuildStartedAt: null,
  lastRebuildFinishedAt: null,
  lastRebuildDurationMs: null,
};

function catalogStateSnapshot() {
  return { ...catalogState };
}

function setCatalogError(error, context = {}) {
  const forcedCode = context.code || null;
  const isCorrupt = forcedCode === SQLITE_CORRUPT_CODE || isSqliteCorruptionError(error);
  catalogState.lastError = {
    message: String(error?.message || error || "unknown_error"),
    code: forcedCode || error?.code || null,
    reason: context.reason || error?.reason || null,
    phase: context.phase || null,
    stack: error?.stack || null,
  };
  catalogState.lastErrorAt = new Date().toISOString();
  catalogState.ready = false;
  catalogState.corruptDetected = Boolean(isCorrupt);
}

function clearCatalogError() {
  catalogState.lastError = null;
  catalogState.lastErrorAt = null;
  catalogState.corruptDetected = false;
}

function isSqliteCorruptionError(error) {
  const msg = String(error?.message || error || "");
  return /SQLITE_CORRUPT|database disk image is malformed|SQLITE_NOTADB|file is not a database/i.test(msg);
}

function markSqliteCorruption(error, context = {}) {
  console.error("[products-db] sqlite corrupt detected", error?.message || error);
  setCatalogError(error, { ...context, code: SQLITE_CORRUPT_CODE });
}

async function closeDbInstance() {
  if (!dbInstance) return;
  await new Promise((resolve) => dbInstance.close(() => resolve()));
  dbInstance = null;
}

async function safeMoveOrDelete(filePath, suffix) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.corrupt-${suffix}`;
  try {
    await fsp.rename(filePath, backupPath);
    return backupPath;
  } catch (error) {
    try {
      await fsp.unlink(filePath);
      return null;
    } catch {
      throw error;
    }
  }
}

async function backupAndRemoveSqliteFiles({ suffix = Date.now() } = {}) {
  const backups = [];
  const files = [SQLITE_PATH, `${SQLITE_PATH}-wal`, `${SQLITE_PATH}-shm`];
  for (const filePath of files) {
    const movedTo = await safeMoveOrDelete(filePath, suffix);
    if (movedTo) backups.push({ from: filePath, to: movedTo });
  }
  return backups;
}

async function runIntegrityCheck(db) {
  const row = await get(db, "PRAGMA integrity_check");
  const value = row ? Object.values(row)[0] : null;
  if (value !== "ok") {
    throw new Error(`SQLITE_INTEGRITY_CHECK_FAILED: ${JSON.stringify(row || null)}`);
  }
}

function normalizeQueryText(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!text) return "";
  try {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    return text;
  }
}

function boolToInt(value, fallback = 0) {
  if (value === true) return 1;
  if (value === false) return 0;
  return fallback;
}

function toNullableText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeFieldKey(value) {
  const base = toNullableText(value);
  if (!base) return "";
  try {
    return base
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  } catch {
    return String(base).toLowerCase().replace(/[^a-z0-9]/g, "");
  }
}

function readPath(obj, pathValue) {
  if (!obj || typeof obj !== "object") return undefined;
  const segments = String(pathValue || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!segments.length) return undefined;
  let cursor = obj;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function getField(product = {}, aliases = []) {
  if (!product || typeof product !== "object") return null;
  for (const alias of aliases) {
    const direct = readPath(product, alias);
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") return direct;
  }
  const entries = Object.entries(product);
  const normalizedMap = new Map(entries.map(([key, value]) => [normalizeFieldKey(key), value]));
  for (const alias of aliases) {
    const normalizedAlias = normalizeFieldKey(alias);
    if (!normalizedAlias) continue;
    if (normalizedMap.has(normalizedAlias)) {
      const value = normalizedMap.get(normalizedAlias);
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
  }
  return null;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFiniteNumberOrNull(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = normalizeLooseNumber(value);
    if (normalized == null) return null;
    return normalized;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLooseNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const sanitized = raw.replace(/[^\d.,-]/g, "");
  if (!sanitized) return null;
  const hasDot = sanitized.includes(".");
  const hasComma = sanitized.includes(",");
  let normalized = sanitized;
  if (hasDot && hasComma) {
    const lastDot = sanitized.lastIndexOf(".");
    const lastComma = sanitized.lastIndexOf(",");
    if (lastComma > lastDot) {
      normalized = sanitized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = sanitized.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = sanitized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = sanitized.replace(/,/g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(values = []) {
  for (const value of values) {
    const parsed = toFiniteNumberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function resolvePriceFields(product = {}) {
  const priceMinorista = firstNumber([
    getField(product, ["price_minorista", "price minorista", "precio_minorista", "precio minorista", "retailPrice", "Precio Minorista"]),
    getField(product, ["precioMinorista", "precio minorista"]),
    getField(product, ["finalPrice", "salePrice", "precioFinal", "precio_final", "Precio Final"]),
    getField(product, ["priceArs", "precioARS", "precio_ars", "finalPriceArs", "precioConIva", "precio_con_iva"]),
    getField(product, ["price", "precio"]),
  ]);
  const priceMayorista = firstNumber([
    getField(product, ["price_mayorista", "precio_mayorista", "Precio Mayorista"]),
    getField(product, ["wholesalePrice", "price_wholesale", "wholesale_price", "precioMayorista"]),
  ]);
  const pricePublic = firstNumber([
    priceMinorista,
    getField(product, ["price", "precio"]),
    getField(product, ["finalPrice", "salePrice", "precioFinal", "precio_final", "Precio Final"]),
    getField(product, ["priceArs", "precioARS", "precio_ars", "finalPriceArs", "precioConIva", "precio_con_iva"]),
  ]);
  return {
    price: pricePublic,
    price_minorista: priceMinorista,
    price_mayorista: priceMayorista,
    precio_minorista: firstNumber([product.precio_minorista, priceMinorista]),
    precio_mayorista: firstNumber([product.precio_mayorista, priceMayorista]),
    precio_final: firstNumber([product.precio_final, product.precioFinal, product.finalPrice, pricePublic]),
    precio_sin_impuestos: firstNumber([
      product.precio_sin_impuestos,
      product.precioSinImpuestos,
      product.precio_sin_impuesto,
    ]),
    cost: firstNumber([product.cost, product.costo, product.costoCaja, product.costo_caja]),
    currency: toNullableText(getField(product, ["currency", "moneda"]) || "ARS"),
    rawPriceFields: {
      price_minorista: product.price_minorista,
      price_mayorista: product.price_mayorista,
      precio_minorista: product.precio_minorista,
      precio_mayorista: product.precio_mayorista,
      price: product.price,
      precio: product.precio,
      finalPrice: product.finalPrice,
      salePrice: product.salePrice,
      precioFinal: product.precioFinal,
      precio_final: product.precio_final,
      priceArs: product.priceArs,
      precioARS: product.precioARS,
      precio_ars: product.precio_ars,
      finalPriceArs: product.finalPriceArs,
      precioConIva: product.precioConIva,
      precio_con_iva: product.precio_con_iva,
      retailPrice: product.retailPrice,
      wholesalePrice: product.wholesalePrice,
      precio_sin_impuestos: product.precio_sin_impuestos,
      precioSinImpuestos: product.precioSinImpuestos,
      costo: product.costo,
      costoCaja: product.costoCaja,
      costo_caja: product.costo_caja,
      cost: product.cost,
      currency: product.currency,
    },
  };
}

function logBusyIfNeeded(error) {
  const message = String(error?.message || error || "");
  if (/busy|locked/i.test(message)) {
    console.warn("[products-db] sqlite busy/locked");
  }
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        logBusyIfNeeded(error);
        reject(error);
      } else {
        resolve(this);
      }
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        logBusyIfNeeded(error);
        reject(error);
      } else {
        resolve(row || null);
      }
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        logBusyIfNeeded(error);
        reject(error);
      } else {
        resolve(Array.isArray(rows) ? rows : []);
      }
    });
  });
}

async function withTransaction(db, callback) {
  await run(db, "BEGIN");
  try {
    const result = await callback();
    await run(db, "COMMIT");
    return result;
  } catch (error) {
    await run(db, "ROLLBACK");
    throw error;
  }
}

async function openDb() {
  if (dbInstance) return dbInstance;
  await fsp.mkdir(path.dirname(SQLITE_PATH), { recursive: true });
  try {
    dbInstance = await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(SQLITE_PATH, (error) => {
        if (error) reject(error);
        else resolve(db);
      });
    });
    await run(dbInstance, "PRAGMA journal_mode = WAL");
    await run(dbInstance, "PRAGMA synchronous = NORMAL");
    await run(dbInstance, "PRAGMA busy_timeout = 5000");
    await run(dbInstance, "PRAGMA temp_store = MEMORY");
    return dbInstance;
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "open_db", reason: "sqlite_open_corrupt" });
    }
    try {
      await closeDbInstance();
    } catch {}
    throw error;
  }
}

async function detectFtsAvailability(db) {
  try {
    await run(
      db,
      "CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(id, sku, code, slug, name, title, brand, model, category, search_text)",
    );
    ftsEnabled = true;
  } catch {
    ftsEnabled = false;
  }
}

async function createSchema(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT,
      sku TEXT,
      code TEXT,
      slug TEXT,
      public_slug TEXT,
      image TEXT,
      name TEXT,
      title TEXT,
      brand TEXT,
      model TEXT,
      category TEXT,
      part_number TEXT,
      mpn TEXT,
      ean TEXT,
      gtin TEXT,
      supplier_code TEXT,
      status TEXT,
      visibility TEXT,
      stock INTEGER,
      price REAL,
      price_minorista REAL,
      price_mayorista REAL,
      precio_minorista REAL,
      precio_mayorista REAL,
      precio_final REAL,
      precio_sin_impuestos REAL,
      cost REAL,
      currency TEXT,
      is_public INTEGER,
      enabled INTEGER,
      deleted INTEGER,
      archived INTEGER,
      vip_only INTEGER,
      wholesale_only INTEGER,
      search_text TEXT,
      raw_json TEXT
    )`,
  );

  const indexSql = [
    "CREATE INDEX IF NOT EXISTS idx_products_id ON products(id)",
    "CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)",
    "CREATE INDEX IF NOT EXISTS idx_products_code ON products(code)",
    "CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug)",
    "CREATE INDEX IF NOT EXISTS idx_products_public_slug ON products(public_slug)",
    "CREATE INDEX IF NOT EXISTS idx_products_part_number ON products(part_number)",
    "CREATE INDEX IF NOT EXISTS idx_products_mpn ON products(mpn)",
    "CREATE INDEX IF NOT EXISTS idx_products_ean ON products(ean)",
    "CREATE INDEX IF NOT EXISTS idx_products_gtin ON products(gtin)",
    "CREATE INDEX IF NOT EXISTS idx_products_supplier_code ON products(supplier_code)",
    "CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand)",
    "CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)",
    "CREATE INDEX IF NOT EXISTS idx_products_is_public ON products(is_public)",
    "CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock)",
    "CREATE INDEX IF NOT EXISTS idx_products_price ON products(price)",
    "CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)",
  ];

  for (const sql of indexSql) {
    await run(db, sql);
  }

  await detectFtsAvailability(db);
}

function computeProductPublicState(product = {}) {
  if (!product || typeof product !== "object") {
    return { isPublic: false, reason: "invalid_product", signals: { missingName: true, missingIdentifier: true } };
  }

  const visibility = normalizeQueryText(getField(product, ["visibility", "visibilidad"]) || "");
  const status = normalizeQueryText(getField(product, ["status", "estado"]) || "");
  const enabledValue = getField(product, ["enabled"]);
  const deletedValue = getField(product, ["deleted"]);
  const archivedValue = getField(product, ["archived"]);
  const vipOnlyValue = getField(product, ["vip_only", "vip only", "vipOnly"]);
  const wholesaleOnlyValue = getField(product, ["wholesaleOnly", "wholesale_only", "wholesale only"]);

  const hasName = Boolean(toNullableText(getField(product, ["name", "title", "productName", "nombre", "model", "shortDescription", "short_description", "description", "descripcion"])));
  const hasIdentifier = Boolean(toNullableText(getField(product, ["id", "sku", "SKU", "code", "Code", "codigo", "Código", "partNumber", "Part Number", "mpn", "ean", "gtin", "supplierCode", "Supplier Part Number"])));

  const signals = {
    visibility,
    status,
    enabledFalse: enabledValue === false,
    deleted: deletedValue === true,
    archived: archivedValue === true,
    vipOnly: vipOnlyValue === true,
    wholesaleOnly: wholesaleOnlyValue === true,
    missingName: !hasName,
    missingIdentifier: !hasIdentifier,
  };

  if (signals.enabledFalse) return { isPublic: false, reason: "enabled_false", signals };
  if (signals.deleted) return { isPublic: false, reason: "deleted", signals };
  if (signals.archived) return { isPublic: false, reason: "archived", signals };
  if (signals.vipOnly) return { isPublic: false, reason: "vip_only", signals };
  if (signals.wholesaleOnly) return { isPublic: false, reason: "wholesale_only", signals };
  if (visibility && REJECTED_STATE_VALUES.has(visibility)) return { isPublic: false, reason: `visibility_${visibility}`, signals };
  if (status && REJECTED_STATE_VALUES.has(status)) return { isPublic: false, reason: `status_${status}`, signals };
  if (!hasName) return { isPublic: false, reason: "missing_name", signals };
  if (!hasIdentifier) return { isPublic: false, reason: "missing_identifier", signals };
  return { isPublic: true, reason: "public", signals };
}

function isProductPublic(product) {
  return computeProductPublicState(product).isPublic;
}

function buildSearchText(product = {}) {
  const metadataText = product?.metadata ? JSON.stringify(product.metadata) : "";
  const fields = [
    getField(product, ["name", "title", "productName", "nombre", "Name", "Title"]),
    getField(product, ["model", "modelo", "Model"]),
    getField(product, ["description", "descripcion", "shortDescription", "short_description"]),
    getField(product, ["brand", "marca", "Brand"]),
    getField(product, ["category", "categoria", "Category"]),
    getField(product, ["sku", "SKU", "Sku"]),
    getField(product, ["code", "Code", "codigo", "Código"]),
    getField(product, ["partNumber", "Part Number", "Supplier Part Number", "mpn", "ean", "gtin", "supplierCode"]),
    getField(product, ["id", "slug"]),
    metadataText,
  ];
  return normalizeQueryText(fields.filter(Boolean).join(" "));
}

function slugifyValue(value) {
  const input = toNullableText(value);
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function firstText(values = []) {
  for (const value of values) {
    const parsed = toNullableText(value);
    if (parsed) return parsed;
  }
  return null;
}

function getProductIdentifier(product = {}, fallbackRow = null) {
  const candidates = [
    product.id,
    product.sku,
    product.code,
    product.partNumber,
    product.mpn,
    product.ean,
    product.gtin,
    product.supplierCode,
    fallbackRow,
  ];
  return toNullableText(candidates.find((value) => toNullableText(value)));
}

function buildPublicSlug(product = {}, fallbackRow = null) {
  const existing = slugifyValue(product.public_slug || product.publicSlug || product.slug);
  if (existing) return existing;
  const nameBase = slugifyValue(
    product.name || product.title || product.productName || product.nombre || product.model,
  );
  const identifier = slugifyValue(getProductIdentifier(product, fallbackRow));
  if (nameBase && identifier) return `${nameBase}-${identifier.slice(-8)}`;
  if (nameBase) return nameBase;
  if (identifier) return `producto-${identifier}`;
  return `producto-${String(fallbackRow || "sin-id").replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
}

function mapProductRow(product = {}, options = {}) {
  const { rowNumber = null, slugCounts = null } = options;
  const mappedCore = {
    id: toNullableText(getField(product, ["id"])),
    sku: toNullableText(getField(product, ["sku", "SKU", "Sku"])),
    code: toNullableText(getField(product, ["code", "Code", "codigo", "Código"])),
    name: toNullableText(getField(product, ["name", "Name", "nombre"])),
    title: toNullableText(getField(product, ["title", "Title", "productName"])),
    model: toNullableText(getField(product, ["model", "Model", "modelo"])),
    partNumber: toNullableText(getField(product, ["partNumber", "Part Number"])),
    mpn: toNullableText(getField(product, ["mpn", "MPN"])),
    ean: toNullableText(getField(product, ["ean", "EAN"])),
    gtin: toNullableText(getField(product, ["gtin", "GTIN"])),
    supplierCode: toNullableText(getField(product, ["supplierCode", "supplier_code", "Supplier Part Number"])),
    slug: toNullableText(getField(product, ["slug"])),
  };
  let publicSlug = buildPublicSlug(mappedCore, rowNumber);
  if (slugCounts instanceof Map) {
    const current = Number(slugCounts.get(publicSlug) || 0) + 1;
    slugCounts.set(publicSlug, current);
    if (current > 1) publicSlug = `${publicSlug}-${current}`;
  }
  const priceFields = resolvePriceFields(product);
  const stock = Math.trunc(toNumber(product.stock, 0));
  if (rowNumber != null && rowNumber <= 3) {
    console.log("[products-price-map]", {
      id: toNullableText(product.id),
      sku: toNullableText(product.sku),
      rawPriceFields: priceFields.rawPriceFields,
      mappedPrice: priceFields.price,
      mappedPriceMinorista: priceFields.price_minorista,
      mappedPriceMayorista: priceFields.price_mayorista,
    });
  }
  return {
    id: toNullableText(getField(product, ["id"])),
    sku: toNullableText(getField(product, ["sku", "SKU", "Sku"])),
    code: toNullableText(getField(product, ["code", "Code", "codigo", "Código"])),
    slug: toNullableText(getField(product, ["slug"])),
    public_slug: publicSlug,
    image: firstText([
      getField(product, ["image", "image_url", "imagen"]),
      getField(product, ["thumbnail", "thumbnail_url"]),
      getField(product, ["picture", "photo", "foto"]),
      Array.isArray(getField(product, ["images", "imagenes", "fotos"])) ? getField(product, ["images", "imagenes", "fotos"])[0] : null,
    ]),
    name: toNullableText(getField(product, ["name", "Name", "nombre"])),
    title: toNullableText(getField(product, ["title", "Title", "productName"])),
    brand: normalizeQueryText(toNullableText(getField(product, ["brand", "Brand", "marca"]))),
    model: normalizeQueryText(toNullableText(getField(product, ["model", "Model", "modelo"]))),
    category: normalizeQueryText(toNullableText(getField(product, ["category", "Category", "categoria"]))),
    part_number: toNullableText(getField(product, ["partNumber", "Part Number"])),
    mpn: toNullableText(getField(product, ["mpn", "MPN"])),
    ean: toNullableText(getField(product, ["ean", "EAN"])),
    gtin: toNullableText(getField(product, ["gtin", "GTIN"])),
    supplier_code: toNullableText(getField(product, ["supplierCode", "supplier_code", "Supplier Part Number"])),
    status: normalizeQueryText(toNullableText(getField(product, ["status", "estado"]))),
    visibility: normalizeQueryText(toNullableText(getField(product, ["visibility", "visibilidad"]))),
    stock,
    price: priceFields.price,
    price_minorista: priceFields.price_minorista,
    price_mayorista: priceFields.price_mayorista,
    precio_minorista: priceFields.precio_minorista,
    precio_mayorista: priceFields.precio_mayorista,
    precio_final: priceFields.precio_final,
    precio_sin_impuestos: priceFields.precio_sin_impuestos,
    cost: priceFields.cost,
    currency: priceFields.currency,
    is_public: computeProductPublicState(product).isPublic ? 1 : 0,
    enabled: boolToInt(getField(product, ["enabled"]), 1),
    deleted: boolToInt(getField(product, ["deleted"]), 0),
    archived: boolToInt(getField(product, ["archived"]), 0),
    vip_only: boolToInt(getField(product, ["vip_only", "vipOnly"]), 0),
    wholesale_only: boolToInt(getField(product, ["wholesaleOnly", "wholesale_only"]), 0),
    search_text: buildSearchText(product),
    raw_json: JSON.stringify(product),
  };
}

function parseImageLikeField(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : item?.url || item?.secure_url || item?.src || ""))
      .map((item) => toNullableText(item))
      .filter(Boolean);
  }
  const one = toNullableText(value);
  if (!one) return [];
  if (one.includes(",")) {
    return one
      .split(",")
      .map((item) => toNullableText(item))
      .filter(Boolean);
  }
  return [one];
}

function normalizeProductForPublic(product = {}, meta = {}) {
  const safe = product && typeof product === "object" ? { ...product } : {};
  const priceFields = resolvePriceFields(safe);
  const name = firstText([
    getField(safe, ["name", "Name", "title", "Title", "productName", "nombre", "model", "Model"]),
  ]) || "Producto";
  const brand = firstText([getField(safe, ["brand", "Brand", "marca", "manufacturer"])]) || "";
  const description =
    firstText([
      getField(safe, ["description", "Description", "descripcion", "details", "detalle", "shortDescription", "longDescription", "meta_description"]),
    ]) || PUBLIC_DESCRIPTION_FALLBACK;
  const identifier = getProductIdentifier(safe, meta.rowid);
  const publicSlug =
    firstText([safe.publicSlug, safe.public_slug, meta.public_slug]) || buildPublicSlug(safe, meta.rowid);
  const images = Array.from(
    new Set(
      [
        ...parseImageLikeField(safe.images),
        ...parseImageLikeField(safe.fotos),
        ...parseImageLikeField(safe.imagenes),
        ...parseImageLikeField(safe.image),
        ...parseImageLikeField(safe.imageUrl),
        ...parseImageLikeField(safe.thumbnail),
        ...parseImageLikeField(safe.thumbnailUrl),
        ...parseImageLikeField(safe.picture),
        ...parseImageLikeField(safe.photo),
        ...parseImageLikeField(safe.foto),
        ...parseImageLikeField(safe.imagen),
      ].filter(Boolean),
    ),
  );
  const image = firstText([safe.image, images[0]]) || "";
  const stock = Math.trunc(
    toNumber(
      safe.stock ?? safe.quantity ?? safe.qty ?? safe.availableQuantity ?? safe.stockQty,
      0,
    ),
  );
  return {
    ...safe,
    id: firstText([safe.id, identifier]) || identifier,
    name,
    brand,
    description,
    images,
    image,
    price: priceFields.price,
    price_minorista: priceFields.price_minorista,
    price_mayorista: priceFields.price_mayorista,
    precio_minorista: priceFields.precio_minorista,
    precio_mayorista: priceFields.precio_mayorista,
    precio_final: priceFields.precio_final,
    precio_sin_impuestos: priceFields.precio_sin_impuestos,
    cost: priceFields.cost,
    currency: priceFields.currency || safe.currency || "ARS",
    stock,
    publicSlug,
    public_slug: publicSlug,
    url: `/p/${encodeURIComponent(publicSlug)}`,
    sku: firstText([getField(safe, ["sku", "SKU", "code", "Code", "partNumber", "Part Number", "mpn", "ean", "gtin", "supplierCode"])]) || "",
    code: firstText([getField(safe, ["code", "Code", "codigo", "Código", "sku", "SKU"])]) || "",
    slug: firstText([safe.slug, safe.publicSlug, safe.public_slug, publicSlug]) || publicSlug,
  };
}

function parseRawItems(rows = [], options = {}) {
  return rows
    .map((row, index) => {
      try {
        const parsed = JSON.parse(row.raw_json);
        if (!options.normalizePublic) return parsed;
        return normalizeProductForPublic(parsed, {
          public_slug: row?.public_slug || null,
          rowid: row?.rowid ?? index + 1,
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeProductForAdminList(product = {}, meta = {}) {
  return normalizeProductForPublic(product, meta);
}

async function updateProductByIdentifier(identifier, patch = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const target = String(identifier || "").trim();
  if (!target) throw new Error("identifier requerido");
  const row = await get(
    db,
    `SELECT rowid, raw_json
     FROM products
     WHERE id = ? OR public_slug = ? OR slug = ? OR sku = ? OR code = ?
     LIMIT 1`,
    [target, target, target, target, target],
  );
  if (!row) return null;
  const current = JSON.parse(row.raw_json || "{}");
  const merged = { ...current, ...patch };
  const mapped = mapProductRow(merged, { rowNumber: row.rowid });
  const changedFields = Object.keys(patch || {}).filter((field) => current[field] !== patch[field]);
  const oldVisibility = firstText([current.visibility, current.Visibility, ""]) || "";
  const newVisibility = firstText([merged.visibility, merged.Visibility, ""]) || "";
  const oldStatus = firstText([current.status, current.Status, ""]) || "";
  const newStatus = firstText([merged.status, merged.Status, ""]) || "";
  const oldIsPublic = isProductPublic(current);
  const newIsPublic = Boolean(mapped.is_public);
  await run(
    db,
    `UPDATE products SET
      id = ?, sku = ?, code = ?, slug = ?, public_slug = ?, image = ?, name = ?, title = ?, brand = ?, model = ?, category = ?,
      part_number = ?, mpn = ?, ean = ?, gtin = ?, supplier_code = ?, status = ?, visibility = ?,
      stock = ?, price = ?, price_minorista = ?, price_mayorista = ?, precio_minorista = ?, precio_mayorista = ?, precio_final = ?, precio_sin_impuestos = ?, cost = ?, currency = ?, is_public = ?, enabled = ?, deleted = ?, archived = ?, vip_only = ?, wholesale_only = ?, search_text = ?, raw_json = ?
      WHERE rowid = ?`,
    [
      mapped.id,
      mapped.sku,
      mapped.code,
      mapped.slug,
      mapped.public_slug,
      mapped.image,
      mapped.name,
      mapped.title,
      mapped.brand,
      mapped.model,
      mapped.category,
      mapped.part_number,
      mapped.mpn,
      mapped.ean,
      mapped.gtin,
      mapped.supplier_code,
      mapped.status,
      mapped.visibility,
      mapped.stock,
      mapped.price,
      mapped.price_minorista,
      mapped.price_mayorista,
      mapped.precio_minorista,
      mapped.precio_mayorista,
      mapped.precio_final,
      mapped.precio_sin_impuestos,
      mapped.cost,
      mapped.currency,
      mapped.is_public,
      mapped.enabled,
      mapped.deleted,
      mapped.archived,
      mapped.vip_only,
      mapped.wholesale_only,
      mapped.search_text,
      mapped.raw_json,
      row.rowid,
    ],
  );
  countCache.clear();
  console.log("[products-admin-update]", {
    identifier: target,
    changedFields,
    oldVisibility,
    newVisibility,
    oldStatus,
    newStatus,
    oldIsPublic,
    newIsPublic,
  });
  return normalizeProductForAdminList(merged, { rowid: row.rowid, public_slug: mapped.public_slug });
}

function buildCatalogPathsInfo() {
  const renderDiskMountPath = (process.env.RENDER_DISK_MOUNT_PATH || "").trim() || null;
  return {
    DATA_DIR: path.dirname(SQLITE_PATH),
    dbPath: SQLITE_PATH,
    productsFilePath: PRODUCTS_JSON_PATH,
    renderDiskMountPath,
    dbExists: fs.existsSync(SQLITE_PATH),
    manifestExists: fs.existsSync(MANIFEST_PATH),
  };
}

function createInitializingError(reason = "sqlite_not_ready") {
  const error = new Error("Catálogo rápido inicializando");
  error.code = "CATALOG_INITIALIZING";
  error.reason = reason;
  error.catalogState = catalogStateSnapshot();
  return error;
}

function createCatalogFailedError(reason = "sqlite_failed", originalError = null) {
  const message = originalError?.message || "Catálogo rápido no disponible";
  const error = new Error(message);
  error.code = "CATALOG_SQLITE_FAILED";
  error.reason = reason;
  error.originalError = originalError || null;
  error.catalogState = catalogStateSnapshot();
  return error;
}

async function rebuildProductsDbFromJson({ force = true, reason = "manual" } = {}) {
  if (rebuildPromise) {
    console.log("[products-db] rebuild already in progress; waiting");
    return rebuildPromise;
  }
  rebuildPromise = (async () => {
    const startedAt = Date.now();
    const activeReason = reason || (force ? "forced" : "unknown");
    catalogState.rebuilding = true;
    catalogState.initializing = true;
    catalogState.ready = false;
    catalogState.lastRebuildStartedAt = new Date(startedAt).toISOString();
    const productsStats = await fsp.stat(PRODUCTS_JSON_PATH);
    const tmpDbPath = `${SQLITE_PATH}.tmp-${process.pid}-${Date.now()}`;
    console.log(`[products-db] rebuild start reason=${activeReason} productsFilePath=${PRODUCTS_JSON_PATH}`);

    const tmpDb = await new Promise((resolve, reject) => {
      const conn = new sqlite3.Database(tmpDbPath, (error) => {
        if (error) reject(error);
        else resolve(conn);
      });
    });

    try {
      await run(tmpDb, "PRAGMA journal_mode = OFF");
      await run(tmpDb, "PRAGMA synchronous = OFF");
      await run(tmpDb, "PRAGMA temp_store = MEMORY");
      await createSchema(tmpDb);
      const insertSql = `INSERT INTO products (
        id, sku, code, slug, public_slug, image, name, title, brand, model, category,
        part_number, mpn, ean, gtin, supplier_code, status, visibility,
        stock, price, price_minorista, price_mayorista, precio_minorista, precio_mayorista, precio_final, precio_sin_impuestos, cost, currency, is_public, enabled, deleted, archived, vip_only, wholesale_only,
        search_text, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      let count = 0;
      let publicCount = 0;
      const slugCounts = new Map();
      const batch = [];
      const BATCH_SIZE = 500;

      const flush = async () => {
        if (!batch.length) return;
        await withTransaction(tmpDb, async () => {
          for (const item of batch) {
            await run(tmpDb, insertSql, [
              item.id,
              item.sku,
              item.code,
              item.slug,
              item.public_slug,
              item.image,
              item.name,
              item.title,
              item.brand,
              item.model,
              item.category,
              item.part_number,
              item.mpn,
              item.ean,
              item.gtin,
              item.supplier_code,
              item.status,
              item.visibility,
              item.stock,
              item.price,
              item.price_minorista,
              item.price_mayorista,
              item.precio_minorista,
              item.precio_mayorista,
              item.precio_final,
              item.precio_sin_impuestos,
              item.cost,
              item.currency,
              item.is_public,
              item.enabled,
              item.deleted,
              item.archived,
              item.vip_only,
              item.wholesale_only,
              item.search_text,
              item.raw_json,
            ]);
          }
        });
        batch.length = 0;
      };

      await productsStreamRepo.streamProducts({
        filePath: PRODUCTS_JSON_PATH,
        onProduct: async (product) => {
          const mapped = mapProductRow(product, { rowNumber: count + 1, slugCounts });
          batch.push(mapped);
          count += 1;
          if (mapped.is_public === 1) publicCount += 1;
          if (count % 5000 === 0) {
            console.log(`[products-db] rebuild progress count=${count}`);
          }
          if (batch.length >= BATCH_SIZE) {
            await flush();
          }
          return true;
        },
      });

      await flush();

      if (ftsEnabled) {
        await run(tmpDb, "DELETE FROM products_fts");
        await run(
          tmpDb,
          `INSERT INTO products_fts(rowid, id, sku, code, slug, name, title, brand, model, category, search_text)
          SELECT rowid, id, sku, code, slug, name, title, brand, model, category, search_text FROM products`,
        );
      }

      await new Promise((resolve, reject) => {
        tmpDb.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      const validateTmpDb = await new Promise((resolve, reject) => {
        const conn = new sqlite3.Database(tmpDbPath, (error) => {
          if (error) reject(error);
          else resolve(conn);
        });
      });
      await runIntegrityCheck(validateTmpDb);
      await new Promise((resolve, reject) => validateTmpDb.close((error) => (error ? reject(error) : resolve())));

      await closeDbInstance();
      await backupAndRemoveSqliteFiles({ suffix: Date.now() });
      await fsp.rename(tmpDbPath, SQLITE_PATH);
      const finalDb = await openDb();
      await runIntegrityCheck(finalDb);

      const manifest = {
        sqliteSchemaVersion: PRODUCTS_SQLITE_SCHEMA_VERSION,
        mappingVersion: CATALOG_MAPPING_VERSION,
        productCount: count,
        publicProductCount: publicCount,
        productsJsonSizeBytes: Number(productsStats.size || 0),
        productsJsonMtimeMs: Number(productsStats.mtimeMs || 0),
        sqliteBuiltAt: new Date().toISOString(),
        sqlitePath: SQLITE_PATH,
        sqliteFtsEnabled: ftsEnabled,
      };
      await fsp.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");

      const durationMs = Date.now() - startedAt;
      console.log(
        `[products-db] rebuild done productCount=${count} publicProductCount=${publicCount} durationMs=${durationMs}`,
      );
      countCache.clear();
      dbReady = true;
      catalogState.ready = true;
      catalogState.lastReadyAt = new Date().toISOString();
      catalogState.lastRebuildFinishedAt = new Date().toISOString();
      catalogState.lastRebuildDurationMs = durationMs;
      clearCatalogError();
      return manifest;
    } catch (error) {
      console.error(`[products-db] rebuild failed reason=${activeReason}`, error);
      if (isSqliteCorruptionError(error)) {
        markSqliteCorruption(error, { phase: "rebuild", reason: activeReason });
      } else {
        setCatalogError(error, { phase: "rebuild", reason: activeReason });
      }
      catalogState.lastRebuildFinishedAt = new Date().toISOString();
      catalogState.lastRebuildDurationMs = Date.now() - startedAt;
      try {
        await new Promise((resolve) => tmpDb.close(() => resolve()));
      } catch {}
      try {
        if (fs.existsSync(tmpDbPath)) await fsp.unlink(tmpDbPath);
      } catch {}
      throw error;
    }
  })();

  try {
    return await rebuildPromise;
  } finally {
    catalogState.rebuilding = false;
    catalogState.initializing = false;
    rebuildPromise = null;
  }
}

async function repairCorruptSqlite({ reason = "sqlite_corrupt" } = {}) {
  if (rebuildPromise) return rebuildPromise;
  console.log("[products-db] repair start");
  try {
    dbReady = false;
    catalogState.ready = false;
    catalogState.initializing = true;
    await closeDbInstance();
    await backupAndRemoveSqliteFiles({ suffix: Date.now() });
    try {
      if (fs.existsSync(MANIFEST_PATH)) await fsp.unlink(MANIFEST_PATH);
    } catch {}
    const manifest = await rebuildProductsDbFromJson({ force: true, reason });
    console.log("[products-db] repair done");
    return manifest;
  } catch (error) {
    console.error("[products-db] repair failed", error);
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "repair", reason });
    } else {
      setCatalogError(error, { phase: "repair", reason });
    }
    throw error;
  } finally {
    catalogState.initializing = false;
  }
}

function isTextSqlType(columnType) {
  const t = String(columnType || "").trim().toUpperCase();
  return t === "TEXT";
}

async function inspectSqliteSchemaIntegrity() {
  if (!fs.existsSync(SQLITE_PATH)) {
    return { ok: false, reason: "sqlite_missing" };
  }
  try {
    const db = await openDb();
    const columns = await all(db, "PRAGMA table_info(products)");
    const columnByName = new Map(
      columns.map((col) => [String(col?.name || "").toLowerCase(), String(col?.type || "").trim()]),
    );
    if (!columnByName.has("public_slug")) {
      return { ok: false, reason: "public_slug_missing" };
    }
    const priceColumns = [
      "price",
      "price_minorista",
      "price_mayorista",
      "precio_minorista",
      "precio_mayorista",
      "precio_final",
      "precio_sin_impuestos",
      "cost",
    ];
    for (const col of priceColumns) {
      const type = columnByName.get(col);
      if (!type) continue;
      if (isTextSqlType(type)) {
        return { ok: false, reason: "price_column_type_mismatch", column: col, currentType: type };
      }
    }
    return { ok: true };
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "inspect_schema", reason: "sqlite_corrupt" });
      return { ok: false, reason: "sqlite_corrupt" };
    }
    throw error;
  }
}

async function ensureProductsDb({ allowRebuild = true } = {}) {
  catalogState.initializing = true;
  console.log("[products-db] paths", buildCatalogPathsInfo());
  console.log("[products-db] ensure start");
  const productsStats = await fsp.stat(PRODUCTS_JSON_PATH);
  let manifest = null;
  try {
    manifest = JSON.parse(await fsp.readFile(MANIFEST_PATH, "utf8"));
  } catch {
    manifest = null;
  }

  let reason = "";
  if (!fs.existsSync(SQLITE_PATH)) {
    reason = "sqlite_missing";
  } else if (!manifest) {
    reason = "manifest_missing";
  } else if (Number(manifest.sqliteSchemaVersion || 0) !== PRODUCTS_SQLITE_SCHEMA_VERSION) {
    reason = "schema_version_changed";
  } else if (Number(manifest.mappingVersion || 0) !== CATALOG_MAPPING_VERSION) {
    reason = "mapping_version_changed";
  } else if (Number(manifest.productsJsonSizeBytes || -1) !== Number(productsStats.size || 0)) {
    reason = "products_json_size_changed";
  } else if (
    Math.floor(Number(manifest.productsJsonMtimeMs || -1)) !==
    Math.floor(Number(productsStats.mtimeMs || 0))
  ) {
    reason = "products_json_mtime_changed";
  }

  if (!reason && fs.existsSync(SQLITE_PATH)) {
    const integrity = await inspectSqliteSchemaIntegrity();
    if (!integrity.ok) {
      reason = integrity.reason;
      if (reason === "price_column_type_mismatch") {
        console.log("[products-db] rebuild required reason=price_column_type_mismatch");
      }
    }
  }

  if (reason) {
    console.log(`[products-db] rebuild required reason=${reason}`);
    if (!allowRebuild) throw createInitializingError(reason);
    if (reason === "sqlite_corrupt") {
      await repairCorruptSqlite({ reason });
    } else {
      await rebuildProductsDbFromJson({ force: true, reason });
    }
  } else {
    console.log("[products-db] already fresh");
  }

  const db = await openDb();
  await createSchema(db);
  dbReady = true;
  catalogState.ready = true;
  catalogState.lastReadyAt = new Date().toISOString();
  catalogState.initializing = false;
  clearCatalogError();
  return {
    dbPath: SQLITE_PATH,
    manifest: await getManifestFromDb(),
    ftsEnabled,
  };
}

async function ensureProductsDbOnce() {
  if (dbReady) return { dbPath: SQLITE_PATH, source: "sqlite", ready: true };
  if (dbReadyPromise) return dbReadyPromise;
  catalogState.initializing = true;
  dbReadyPromise = ensureProductsDb({ allowRebuild: true });
  try {
    return await dbReadyPromise;
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "ensure_once", reason: "bootstrap_corrupt" });
      try {
        return await repairCorruptSqlite({ reason: "ensure_once_corrupt" });
      } catch (repairError) {
        setCatalogError(repairError, { phase: "ensure_once", reason: "repair_failed" });
        throw repairError;
      }
    }
    setCatalogError(error, { phase: "ensure_once", reason: "bootstrap_failed" });
    throw error;
  } finally {
    catalogState.initializing = false;
    dbReadyPromise = null;
  }
}

function ensureProductsDbInBackground(trigger = "request") {
  if (dbReady || dbReadyPromise) return;
  dbReadyPromise = ensureProductsDb({ allowRebuild: true });
  dbReadyPromise
    .then(() => {
      console.log(`[products-db] background ensure completed trigger=${trigger}`);
    })
    .catch((error) => {
      console.warn(`[products-db] background ensure failed trigger=${trigger} reason=${error?.message || error}`);
    })
    .finally(() => {
      dbReadyPromise = null;
    });
}

async function ensureDbReadyForRequest() {
  if (dbReady) return;
  if (catalogState.lastError) {
    if (catalogState.lastError.code === SQLITE_CORRUPT_CODE) {
      try {
        await repairCorruptSqlite({ reason: "request_corrupt_repair" });
        return;
      } catch (repairError) {
        throw createCatalogFailedError("persisted_corrupt_error", repairError);
      }
    }
    throw createCatalogFailedError("persisted_error");
  }
  if (dbReadyPromise) throw createInitializingError("sqlite_bootstrap_in_progress");
  try {
    await ensureProductsDb({ allowRebuild: false });
  } catch (error) {
    if (error?.code === "CATALOG_INITIALIZING") {
      ensureProductsDbInBackground("request-auto-bootstrap");
      throw error;
    }
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "request_readiness", reason: "ensure_corrupt" });
      try {
        await repairCorruptSqlite({ reason: "request_readiness_corrupt" });
        return;
      } catch (repairError) {
        throw createCatalogFailedError("ensure_corrupt_repair_failed", repairError);
      }
    }
    setCatalogError(error, { phase: "request_readiness", reason: "ensure_failed" });
    throw createCatalogFailedError("ensure_failed", error);
  }
}

function buildSort(sort) {
  const priceExpr = "COALESCE(price_minorista, price, precio_minorista, precio_final)";
  const allowedSorts = {
    price_asc: `${priceExpr} ASC, rowid ASC`,
    price_desc: `${priceExpr} DESC, rowid ASC`,
    name_asc: "name ASC, rowid ASC",
    name_desc: "name DESC, rowid ASC",
    stock_desc: "stock DESC, rowid ASC",
    stock_asc: "stock ASC, rowid ASC",
    "price-asc": `${priceExpr} ASC, rowid ASC`,
    "price-desc": `${priceExpr} DESC, rowid ASC`,
    "stock-desc": "stock DESC, rowid ASC",
    name: "name ASC, rowid ASC",
  };
  return allowedSorts[String(sort || "").trim().toLowerCase()] || "rowid ASC";
}

function buildWhereClause({
  search = "",
  isPublicOnly = false,
  category = "",
  brand = "",
  model = "",
  visibility = "",
  status = "",
  stock = "",
  priceMax = null,
} = {}) {
  const where = [];
  const params = [];

  if (isPublicOnly) where.push("is_public = 1");
  if (category) {
    where.push("category = ?");
    params.push(category);
  }
  if (brand) {
    where.push("brand = ?");
    params.push(brand);
  }
  if (model) {
    where.push("model = ?");
    params.push(model);
  }
  if (visibility) {
    where.push("visibility = ?");
    params.push(visibility);
  }
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (stock === "in-stock" || stock === "in") {
    where.push("stock > 0");
  } else if (stock === "out") {
    where.push("stock <= 0");
  }
  if (priceMax !== null && Number.isFinite(Number(priceMax))) {
    where.push("COALESCE(price_minorista, price, precio_minorista, precio_final) <= ?");
    params.push(Number(priceMax));
  }

  const normalizedSearch = normalizeQueryText(search);
  if (normalizedSearch) {
    if (ftsEnabled) {
      where.push("rowid IN (SELECT rowid FROM products_fts WHERE products_fts MATCH ?)");
      const tokens = normalizedSearch
        .replace(/[^a-z0-9\s]/gi, " ")
        .split(" ")
        .filter(Boolean)
        .map((token) => `${token}*`)
        .join(" AND ");
      params.push(tokens || normalizedSearch);
    } else {
      where.push("search_text LIKE ?");
      params.push(`%${normalizedSearch}%`);
    }
  }

  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

function buildProductSummary(row = {}) {
  const publicSlug = firstText([row.public_slug, row.slug]) || "";
  const fallbackId = String(row.id || row.sku || row.code || "producto");
  return {
    id: firstText([row.id]) || "",
    sku: firstText([row.sku]) || "",
    code: firstText([row.code]) || "",
    name: firstText([row.name, row.title]) || "Producto",
    title: firstText([row.title, row.name]) || "Producto",
    brand: row.brand || "",
    model: row.model || "",
    category: row.category || "",
    price: toFiniteNumberOrNull(row.price),
    price_minorista: toFiniteNumberOrNull(row.price_minorista),
    price_mayorista: toFiniteNumberOrNull(row.price_mayorista),
    precio_minorista: toFiniteNumberOrNull(row.precio_minorista),
    precio_mayorista: toFiniteNumberOrNull(row.precio_mayorista),
    precio_final: toFiniteNumberOrNull(row.precio_final),
    precio_sin_impuestos: toFiniteNumberOrNull(row.precio_sin_impuestos),
    cost: toFiniteNumberOrNull(row.cost),
    currency: row.currency || "ARS",
    stock: Math.trunc(toNumber(row.stock, 0)),
    status: row.status || "",
    visibility: row.visibility || "",
    image: row.image || "",
    thumbnail: row.image || "",
    publicSlug,
    public_slug: publicSlug,
    slug: firstText([row.slug, publicSlug]) || "",
    url: `/p/${encodeURIComponent(publicSlug || fallbackId)}`,
    source: "sqlite",
  };
}

async function queryBase({
  page = 1,
  pageSize = 24,
  search = "",
  sort = "",
  isPublicOnly = false,
  category = "",
  brand = "",
  model = "",
  visibility = "",
  status = "",
  stock = "",
  priceMax = null,
} = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || 24);
  const offset = (safePage - 1) * safePageSize;
  const whereClause = buildWhereClause({
    search,
    isPublicOnly,
    category: normalizeQueryText(category),
    brand: normalizeQueryText(brand),
    model: normalizeQueryText(model),
    visibility: normalizeQueryText(visibility),
    status: normalizeQueryText(status),
    stock: normalizeQueryText(stock),
    priceMax,
  });

  const orderBy = buildSort(sort);
  const totalStartedAt = Date.now();

  const countStartedAt = Date.now();
  const countKey = JSON.stringify({ whereSql: whereClause.sql, whereParams: whereClause.params });
  const cachedCount = countCache.get(countKey);
  let totalItems = 0;
  if (cachedCount && Date.now() - cachedCount.t < COUNT_CACHE_TTL_MS) {
    totalItems = Number(cachedCount.totalItems || 0);
  } else {
    const totalRow = await get(
      db,
      `SELECT COUNT(*) AS totalItems FROM products ${whereClause.sql}`,
      whereClause.params,
    );
    totalItems = Number(totalRow?.totalItems || 0);
    countCache.set(countKey, { t: Date.now(), totalItems });
  }
  const countMs = Date.now() - countStartedAt;

  const selectStartedAt = Date.now();
  const rows = await all(
    db,
    `SELECT rowid, id, sku, code, slug, public_slug, image, name, title, brand, model, category, status, visibility, stock, price, price_minorista, price_mayorista, precio_minorista, precio_mayorista, precio_final, precio_sin_impuestos, cost, currency
      FROM products ${whereClause.sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...whereClause.params, safePageSize, offset],
  );
  const selectMs = Date.now() - selectStartedAt;

  const parseStartedAt = Date.now();
  const items = rows.map((row) => buildProductSummary(row));
  const parseItemsMs = Date.now() - parseStartedAt;

  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const totalDurationMs = Date.now() - totalStartedAt;

  return {
    rows,
    items,
    page: safePage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
    source: "sqlite",
    search: search || undefined,
    countMs,
    selectMs,
    parseItemsMs,
    totalDurationMs,
  };
}

async function queryProducts(params = {}) {
  let result;
  try {
    result = await queryBase({ ...params, isPublicOnly: true });
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "query_products", reason: "sqlite_corrupt" });
      await repairCorruptSqlite({ reason: "query_products_corrupt" });
      result = await queryBase({ ...params, isPublicOnly: true });
    } else {
      throw error;
    }
  }
  console.log("[products-sqlite:queryProducts]", {
    page: result.page,
    pageSize: result.pageSize,
    search: params.search || "",
    sort: params.sort || "",
    totalItems: result.totalItems,
    rows: result.rows.length,
    countMs: result.countMs,
    selectMs: result.selectMs,
    parseItemsMs: result.parseItemsMs,
    totalDurationMs: result.totalDurationMs,
  });
  return result;
}

async function queryAdminProducts(params = {}) {
  let result;
  try {
    result = await queryBase({ ...params, isPublicOnly: false });
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "query_admin_products", reason: "sqlite_corrupt" });
      await repairCorruptSqlite({ reason: "query_admin_products_corrupt" });
      result = await queryBase({ ...params, isPublicOnly: false });
    } else {
      throw error;
    }
  }
  console.log("[products-sqlite:queryAdminProducts]", {
    page: result.page,
    pageSize: result.pageSize,
    search: params.search || "",
    sort: params.sort || "",
    totalItems: result.totalItems,
    rows: result.rows.length,
    countMs: result.countMs,
    selectMs: result.selectMs,
    parseItemsMs: result.parseItemsMs,
    totalDurationMs: result.totalDurationMs,
  });
  return result;
}

async function getProductBySlug(slug) {
  try {
    await ensureDbReadyForRequest();
    const db = await openDb();
    const row = await get(
      db,
      "SELECT rowid, raw_json, public_slug FROM products WHERE slug = ? LIMIT 1",
      [String(slug || "").trim()],
    );
    return parseRawItems(row ? [row] : [], { normalizePublic: true })[0] || null;
  } catch (error) {
    if (!isSqliteCorruptionError(error)) throw error;
    markSqliteCorruption(error, { phase: "get_product_by_slug", reason: "sqlite_corrupt" });
    await repairCorruptSqlite({ reason: "get_product_by_slug_corrupt" });
    return getProductBySlug(slug);
  }
}

async function getProductById(id) {
  try {
    await ensureDbReadyForRequest();
    const db = await openDb();
    const row = await get(db, "SELECT rowid, raw_json, public_slug FROM products WHERE id = ? LIMIT 1", [String(id || "").trim()]);
    return parseRawItems(row ? [row] : [], { normalizePublic: true })[0] || null;
  } catch (error) {
    if (!isSqliteCorruptionError(error)) throw error;
    markSqliteCorruption(error, { phase: "get_product_by_id", reason: "sqlite_corrupt" });
    await repairCorruptSqlite({ reason: "get_product_by_id_corrupt" });
    return getProductById(id);
  }
}

async function getProductByCode(code) {
  try {
    await ensureDbReadyForRequest();
    const db = await openDb();
    const target = String(code || "").trim();
    const row = await get(
      db,
      "SELECT rowid, raw_json, public_slug FROM products WHERE code = ? OR sku = ? LIMIT 1",
      [target, target],
    );
    return parseRawItems(row ? [row] : [], { normalizePublic: true })[0] || null;
  } catch (error) {
    if (!isSqliteCorruptionError(error)) throw error;
    markSqliteCorruption(error, { phase: "get_product_by_code", reason: "sqlite_corrupt" });
    await repairCorruptSqlite({ reason: "get_product_by_code_corrupt" });
    return getProductByCode(code);
  }
}

async function getProductByPublicSlugOrAnyIdentifier(value) {
  try {
    await ensureDbReadyForRequest();
    const db = await openDb();
    const target = String(value || "").trim();
    if (!target) return { foundBy: "none", source: "sqlite", product: null };
    const checks = [
    { field: "public_slug", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE public_slug = ? LIMIT 1" },
    { field: "slug", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE slug = ? LIMIT 1" },
    { field: "id", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE id = ? LIMIT 1" },
    { field: "sku", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE sku = ? LIMIT 1" },
    { field: "code", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE code = ? LIMIT 1" },
    { field: "partNumber", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE part_number = ? LIMIT 1" },
    { field: "mpn", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE mpn = ? LIMIT 1" },
    { field: "ean", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE ean = ? LIMIT 1" },
    { field: "gtin", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE gtin = ? LIMIT 1" },
    { field: "supplierCode", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE supplier_code = ? LIMIT 1" },
  ];
    for (const check of checks) {
      const row = await get(db, check.sql, [target]);
      const product = parseRawItems(row ? [row] : [], { normalizePublic: true })[0] || null;
      if (product) return { foundBy: check.field, source: "sqlite", product };
    }
    return { foundBy: "none", source: "sqlite", product: null };
  } catch (error) {
    if (!isSqliteCorruptionError(error)) throw error;
    markSqliteCorruption(error, { phase: "get_product_by_any_identifier", reason: "sqlite_corrupt" });
    await repairCorruptSqlite({ reason: "get_product_by_any_identifier_corrupt" });
    return getProductByPublicSlugOrAnyIdentifier(value);
  }
}

async function getManifestFromDb() {
  try {
    const raw = await fsp.readFile(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function getCatalogHealth() {
  const paths = buildCatalogPathsInfo();
  const productsJsonExists = fs.existsSync(PRODUCTS_JSON_PATH);
  const sqliteExists = fs.existsSync(SQLITE_PATH);
  let totalRow = { total: 0 };
  let publicRow = { total: 0 };
  let privateExplicitRow = { total: 0 };
  let hiddenExplicitRow = { total: 0 };
  let missingVisibilityRow = { total: 0 };
  let missingStatusRow = { total: 0 };
  if (sqliteExists) {
    try {
      const db = await openDb();
      totalRow = await get(db, "SELECT COUNT(*) AS total FROM products");
      publicRow = await get(db, "SELECT COUNT(*) AS total FROM products WHERE is_public = 1");
      privateExplicitRow = await get(
        db,
        "SELECT COUNT(*) AS total FROM products WHERE visibility = 'private' OR status = 'private'",
      );
      hiddenExplicitRow = await get(
        db,
        "SELECT COUNT(*) AS total FROM products WHERE visibility = 'hidden' OR status = 'hidden'",
      );
      missingVisibilityRow = await get(
        db,
        "SELECT COUNT(*) AS total FROM products WHERE visibility IS NULL OR visibility = ''",
      );
      missingStatusRow = await get(
        db,
        "SELECT COUNT(*) AS total FROM products WHERE status IS NULL OR status = ''",
      );
    } catch (error) {
      if (isSqliteCorruptionError(error)) {
        markSqliteCorruption(error, { phase: "health", reason: "sqlite_query_failed" });
      } else {
        setCatalogError(error, { phase: "health", reason: "sqlite_query_failed" });
      }
    }
  }
  const manifest = await getManifestFromDb();
  let productsStats = null;
  try {
    productsStats = await fsp.stat(PRODUCTS_JSON_PATH);
  } catch {
    productsStats = null;
  }
  let isFresh = true;
  let freshnessReason = null;
  if (!manifest) {
    isFresh = false;
    freshnessReason = "manifest_missing";
  } else if (Number(manifest.sqliteSchemaVersion || 0) !== PRODUCTS_SQLITE_SCHEMA_VERSION) {
    isFresh = false;
    freshnessReason = "schema_version_changed";
  } else if (Number(manifest.mappingVersion || 0) !== CATALOG_MAPPING_VERSION) {
    isFresh = false;
    freshnessReason = "mapping_version_changed";
  } else if (Number(manifest.productsJsonSizeBytes || -1) !== Number(productsStats.size || 0)) {
    isFresh = false;
    freshnessReason = "products_json_size_changed";
  } else if (
    Math.floor(Number(manifest.productsJsonMtimeMs || -1)) !==
    Math.floor(Number(productsStats.mtimeMs || 0))
  ) {
    isFresh = false;
    freshnessReason = "products_json_mtime_changed";
  }
  const manifestPublicCount = Number(manifest?.publicProductCount || 0);
  const productCount = Number(totalRow?.total || 0);
  const publicProductCount = Number(publicRow?.total || 0);
  if (
    manifest &&
    manifestPublicCount > 0 &&
    productCount > 0 &&
    manifestPublicCount <= 125 &&
    productCount >= manifestPublicCount * 5
  ) {
    console.warn("[products-db] suspicious public count", {
      productCount,
      manifestPublicCount,
      ratio: Number((productCount / manifestPublicCount).toFixed(2)),
    });
  }
  return {
    source: "sqlite",
    ...paths,
    ready: Boolean(dbReady && sqliteExists && !catalogState.lastError),
    initializing: Boolean(catalogState.initializing),
    rebuilding: Boolean(catalogState.rebuilding),
    lastError: catalogState.lastError,
    lastErrorCode: catalogState.lastError?.code || null,
    lastErrorAt: catalogState.lastErrorAt,
    corruptDetected: Boolean(catalogState.corruptDetected),
    lastReadyAt: catalogState.lastReadyAt,
    lastRebuildStartedAt: catalogState.lastRebuildStartedAt,
    lastRebuildFinishedAt: catalogState.lastRebuildFinishedAt,
    lastRebuildDurationMs: catalogState.lastRebuildDurationMs,
    productsJsonExists,
    sqlitePath: SQLITE_PATH,
    sqliteExists,
    productCount,
    publicProductCount,
    privateExplicitCount: Number(privateExplicitRow?.total || 0),
    hiddenExplicitCount: Number(hiddenExplicitRow?.total || 0),
    missingVisibilityCount: Number(missingVisibilityRow?.total || 0),
    missingStatusCount: Number(missingStatusRow?.total || 0),
    sqliteSchemaVersion: PRODUCTS_SQLITE_SCHEMA_VERSION,
    catalogMappingVersion: CATALOG_MAPPING_VERSION,
    manifestSchemaVersion: Number(manifest?.sqliteSchemaVersion || 0) || null,
    manifestMappingVersion: Number(manifest?.mappingVersion || 0) || null,
    sqliteBuiltAt: manifest?.sqliteBuiltAt || null,
    productsJsonSizeBytes: Number(productsStats?.size || 0),
    productsJsonMtimeMs: Number(productsStats?.mtimeMs || 0),
    isFresh,
    freshnessReason,
    manifest,
    lastBuilt: manifest?.sqliteBuiltAt || null,
  };
}

async function getCatalogPublicityAudit() {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const rows = await all(db, `SELECT rowid, id, sku, code, name, title, status, visibility, enabled, deleted, archived, vip_only, wholesale_only, raw_json, is_public FROM products`);
  const rejectedCounts = { explicitPrivate: 0, explicitHidden: 0, explicitDraft: 0, explicitDisabled: 0, enabledFalse: 0, deleted: 0, archived: 0, vipOnly: 0, wholesaleOnly: 0, missingName: 0, missingIdentifier: 0 };
  const visibilityDistribution = {};
  const statusDistribution = {};
  const examplesRejected = [];
  for (const row of rows) {
    const v = normalizeQueryText(row.visibility || "") || "(empty)";
    const st = normalizeQueryText(row.status || "") || "(empty)";
    visibilityDistribution[v] = (visibilityDistribution[v] || 0) + 1;
    statusDistribution[st] = (statusDistribution[st] || 0) + 1;
    let raw = {};
    try { raw = JSON.parse(row.raw_json || "{}"); } catch {}
    const computed = computeProductPublicState(raw);
    if (!computed.isPublic) {
      if (v === 'private' || st === 'private') rejectedCounts.explicitPrivate += 1;
      if (v === 'hidden' || st === 'hidden') rejectedCounts.explicitHidden += 1;
      if (v === 'draft' || st === 'draft') rejectedCounts.explicitDraft += 1;
      if (v === 'disabled' || st === 'disabled') rejectedCounts.explicitDisabled += 1;
      if (computed.signals.enabledFalse) rejectedCounts.enabledFalse += 1;
      if (computed.signals.deleted) rejectedCounts.deleted += 1;
      if (computed.signals.archived) rejectedCounts.archived += 1;
      if (computed.signals.vipOnly) rejectedCounts.vipOnly += 1;
      if (computed.signals.wholesaleOnly) rejectedCounts.wholesaleOnly += 1;
      if (computed.signals.missingName) rejectedCounts.missingName += 1;
      if (computed.signals.missingIdentifier) rejectedCounts.missingIdentifier += 1;
      if (examplesRejected.length < 20) examplesRejected.push({ rowid: row.rowid, id: row.id, sku: row.sku, code: row.code, name: row.name || row.title || null, visibility: row.visibility || null, status: row.status || null, is_public: row.is_public, reason: computed.reason });
    }
  }
  const publicProductCount = rows.filter((r)=>Number(r.is_public||0)===1).length;
  return { productCount: rows.length, publicProductCount, rejectedCounts, visibilityDistribution, statusDistribution, examplesRejected };
}

async function getCatalogFieldAudit({ sampleSize = 300 } = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const safeSampleSize = Math.max(50, Math.min(2000, Number(sampleSize) || 300));
  const summary = await get(
    db,
    "SELECT COUNT(*) AS productCount, SUM(CASE WHEN is_public = 1 THEN 1 ELSE 0 END) AS publicProductCount FROM products",
  );
  const rows = await all(
    db,
    `SELECT rowid, id, sku, code, name, title, is_public, search_text, raw_json
     FROM products
     ORDER BY rowid ASC
     LIMIT ?`,
    [safeSampleSize],
  );
  const rejectedRows = await all(
    db,
    `SELECT rowid, id, sku, code, name, title, visibility, status, enabled, deleted, archived, vip_only, wholesale_only, raw_json
     FROM products
     WHERE is_public = 0
     ORDER BY rowid ASC
     LIMIT 20`,
  );
  const topKeysCounter = new Map();
  const priceKeysCounter = new Map();
  const nameKeysCounter = new Map();
  const skuKeysCounter = new Map();
  const inc = (map, key) => map.set(key, Number(map.get(key) || 0) + 1);
  for (const row of rows) {
    let raw = {};
    try {
      raw = JSON.parse(row.raw_json || "{}");
    } catch {
      raw = {};
    }
    for (const key of Object.keys(raw)) {
      inc(topKeysCounter, key);
      const nk = normalizeFieldKey(key);
      if (
        [
          "price",
          "precio",
          "preciofinal",
          "priceminorista",
          "pricemayorista",
          "preciominorista",
          "preciomayorista",
          "retailprice",
          "wholesaleprice",
        ].includes(nk)
      ) {
        inc(priceKeysCounter, key);
      }
      if (["name", "title", "nombre", "productname", "description", "model"].includes(nk)) inc(nameKeysCounter, key);
      if (["sku", "code", "codigo", "partnumber", "mpn", "ean", "gtin", "suppliercode"].includes(nk)) inc(skuKeysCounter, key);
    }
  }
  const topMap = (map, limit = 20) =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, count]) => ({ key, count }));
  return {
    productCount: Number(summary?.productCount || 0),
    publicProductCount: Number(summary?.publicProductCount || 0),
    sampledRows: rows.length,
    topKeys: topMap(topKeysCounter, 30),
    detectedPriceFields: topMap(priceKeysCounter, 20),
    detectedNameFields: topMap(nameKeysCounter, 20),
    detectedSkuCodeModelFields: topMap(skuKeysCounter, 20),
    sampleImportedProducts: rows.slice(0, 10).map((row) => ({
      rowid: row.rowid,
      id: row.id,
      sku: row.sku,
      code: row.code,
      name: row.name || row.title || null,
      searchTextPreview: String(row.search_text || "").slice(0, 180),
    })),
    sampleRejectedByPublicity: rejectedRows.map((row) => ({
      rowid: row.rowid,
      id: row.id,
      sku: row.sku,
      code: row.code,
      name: row.name || row.title || null,
      visibility: row.visibility || null,
      status: row.status || null,
      enabled: row.enabled,
      deleted: row.deleted,
      archived: row.archived,
      vip_only: row.vip_only,
      wholesale_only: row.wholesale_only,
    })),
  };
}

async function debugCatalogSearch({ search = "", limit = 20 } = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const whereClause = buildWhereClause({ search, isPublicOnly: true });
  const totalRow = await get(db, `SELECT COUNT(*) AS total FROM products ${whereClause.sql}`, whereClause.params);
  const sampleMatches = await all(
    db,
    `SELECT id, sku, code, name, title, model, public_slug, search_text
     FROM products ${whereClause.sql}
     ORDER BY rowid ASC
     LIMIT ?`,
    [...whereClause.params, Math.max(1, Math.min(100, Number(limit) || 20))],
  );
  const normalizedSearch = normalizeQueryText(search || "");
  const sqliteMatchesAny = await get(db, `SELECT COUNT(*) AS total FROM products WHERE search_text LIKE ?`, [`%${normalizedSearch}%`]);
  const sqlitePublicMatches = await get(db, `SELECT COUNT(*) AS total FROM products WHERE is_public = 1 AND search_text LIKE ?`, [`%${normalizedSearch}%`]);
  let diagnosis = "match_public";
  if (Number(sqliteMatchesAny?.total || 0) === 0) diagnosis = "no_existe_en_sqlite";
  else if (Number(sqlitePublicMatches?.total || 0) === 0) diagnosis = "matchea_pero_is_public_0";
  else if (Number(totalRow?.total || 0) === 0) diagnosis = "no_matchea_search_text";
  return {
    search,
    totalMatches: Number(totalRow?.total || 0),
    diagnosis,
    sampleMatches: sampleMatches.map((row) => ({
      id: row.id || null,
      sku: row.sku || null,
      code: row.code || null,
      name: row.name || null,
      title: row.title || null,
      model: row.model || null,
      publicSlug: row.public_slug || null,
      searchTextPreview: String(row.search_text || "").slice(0, 220),
    })),
  };
}


async function debugPublicationByIdentifier(identifier = "") {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const term = String(identifier || "").trim();
  if (!term) return { identifier: term, found: false };
  const q = `%${normalizeQueryText(term)}%`;
  const row = await get(db, `SELECT rowid, * FROM products WHERE
      LOWER(COALESCE(id,'')) = LOWER(?) OR LOWER(COALESCE(sku,'')) = LOWER(?) OR LOWER(COALESCE(code,'')) = LOWER(?) OR LOWER(COALESCE(public_slug,'')) = LOWER(?) OR LOWER(COALESCE(slug,'')) = LOWER(?)
      OR LOWER(COALESCE(name,'')) LIKE ? OR LOWER(COALESCE(title,'')) LIKE ? OR LOWER(COALESCE(model,'')) LIKE ? OR LOWER(COALESCE(part_number,'')) LIKE ?
      OR LOWER(COALESCE(mpn,'')) LIKE ? OR LOWER(COALESCE(ean,'')) LIKE ? OR LOWER(COALESCE(gtin,'')) LIKE ? OR LOWER(COALESCE(supplier_code,'')) LIKE ? OR LOWER(COALESCE(search_text,'')) LIKE ? LIMIT 1`,
    [term, term, term, term, term, q, q, q, q, q, q, q, q, q]);
  if (!row) return { identifier: term, found: false };
  let raw = {};
  try { raw = JSON.parse(row.raw_json || "{}"); } catch {}
  const computed = computeProductPublicState(raw);
  const normalizedSearch = normalizeQueryText(term);
  return {
    identifier: term, found: true, foundBy: "sqlite",
    raw: {
      id: raw.id || null, sku: raw.sku || raw.SKU || null, code: raw.code || raw.Code || null, name: raw.name || raw.Name || null, title: raw.title || raw.Title || null, model: raw.model || null,
      description: raw.description || raw.descripcion || null, shortDescription: raw.shortDescription || raw.short_description || null,
      visibility: raw.visibility || raw.visibilidad || null, status: raw.status || raw.estado || null, enabled: raw.enabled, deleted: raw.deleted, archived: raw.archived, vip_only: raw.vip_only ?? raw.vipOnly, wholesaleOnly: raw.wholesaleOnly ?? raw.wholesale_only,
    },
    sqlite: {
      rowid: row.rowid, id: row.id, sku: row.sku, code: row.code, name: row.name, title: row.title, model: row.model, public_slug: row.public_slug, visibility: row.visibility, status: row.status, enabled: row.enabled, deleted: row.deleted, archived: row.archived, vip_only: row.vip_only, wholesale_only: row.wholesale_only, is_public: row.is_public, search_text: row.search_text,
    },
    computed,
    wouldAppearInPublicQuery: Number(row.is_public || 0) === 1,
    wouldMatchSearch: String(row.search_text || "").includes(normalizedSearch),
  };
}
async function getCatalogPriceAudit({ limit = 20 } = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  const totals = await get(
    db,
    `SELECT
      COUNT(*) AS totalProducts,
      SUM(CASE WHEN COALESCE(price_minorista, price, precio_minorista, precio_final) = 0 THEN 1 ELSE 0 END) AS zeroPriceCount,
      SUM(CASE WHEN COALESCE(price_minorista, price, precio_minorista, precio_final) IS NULL THEN 1 ELSE 0 END) AS nullPriceCount,
      SUM(CASE WHEN COALESCE(price_minorista, price, precio_minorista, precio_final) > 0 THEN 1 ELSE 0 END) AS pricedCount
    FROM products`,
  );
  const examplesZeroPrice = await all(
    db,
    `SELECT id, sku, name, price, price_minorista, price_mayorista, precio_final, raw_json
     FROM products
     WHERE COALESCE(price_minorista, price, precio_minorista, precio_final) = 0
     ORDER BY rowid ASC
     LIMIT ?`,
    [safeLimit],
  );
  const examplesPriced = await all(
    db,
    `SELECT id, sku, name, price, price_minorista, price_mayorista, precio_final, raw_json
     FROM products
     WHERE COALESCE(price_minorista, price, precio_minorista, precio_final) > 0
     ORDER BY rowid ASC
     LIMIT ?`,
    [safeLimit],
  );
  const pickRawAliases = (raw) => {
    const aliases = {};
    const keys = [
      "price",
      "precio",
      "precio_final",
      "precioFinal",
      "finalPrice",
      "salePrice",
      "priceArs",
      "precioARS",
      "precio_ars",
      "precioConIva",
      "precio_con_iva",
      "price_minorista",
      "precio_minorista",
      "price_mayorista",
      "precio_mayorista",
      "retailPrice",
      "wholesalePrice",
    ];
    for (const key of keys) {
      if (raw && Object.prototype.hasOwnProperty.call(raw, key)) aliases[key] = raw[key];
    }
    return aliases;
  };
  const serialize = (row) => {
    let raw = {};
    try {
      raw = JSON.parse(row.raw_json || "{}");
    } catch {
      raw = {};
    }
    return {
      id: row.id || null,
      sku: row.sku || null,
      name: row.name || null,
      rawPriceAliases: pickRawAliases(raw),
      mappedPrice: toFiniteNumberOrNull(row.price),
      price_minorista: toFiniteNumberOrNull(row.price_minorista),
      price_mayorista: toFiniteNumberOrNull(row.price_mayorista),
      precio_final: toFiniteNumberOrNull(row.precio_final),
    };
  };
  return {
    totalProducts: Number(totals?.totalProducts || 0),
    zeroPriceCount: Number(totals?.zeroPriceCount || 0),
    nullPriceCount: Number(totals?.nullPriceCount || 0),
    pricedCount: Number(totals?.pricedCount || 0),
    examplesZeroPrice: examplesZeroPrice.map(serialize),
    examplesPriced: examplesPriced.map(serialize),
  };
}

function isRebuildInProgress() {
  return Boolean(rebuildPromise);
}

module.exports = {
  ensureProductsDb,
  ensureProductsDbOnce,
  rebuildProductsDbFromJson,
  isRebuildInProgress,
  repairCorruptSqlite,
  isSqliteCorruptionError,
  catalogStateSnapshot,
  setCatalogError,
  clearCatalogError,
  queryProducts,
  queryAdminProducts,
  getProductBySlug,
  getProductById,
  getProductByCode,
  getProductByPublicSlugOrAnyIdentifier,
  getManifestFromDb,
  getCatalogHealth,
  getCatalogPriceAudit,
  getCatalogPublicityAudit,
  getCatalogFieldAudit,
  debugCatalogSearch,
  debugPublicationByIdentifier,
  computeProductPublicState,
  updateProductByIdentifier,
  normalizeProductForPublic,
  normalizeProductForAdminList,
  normalizeQueryText,
  PRODUCTS_SQLITE_SCHEMA_VERSION,
  CATALOG_MAPPING_VERSION,
  getField,
  isProductPublic,
  mapProductRow,
  SQLITE_PATH,
  createInitializingError,
  SQLITE_CORRUPT_CODE,
};
