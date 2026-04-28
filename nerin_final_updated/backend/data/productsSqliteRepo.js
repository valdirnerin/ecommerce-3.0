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

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

  const columns = await all(db, "PRAGMA table_info(products)");
  const columnSet = new Set(columns.map((col) => String(col?.name || "").toLowerCase()));
  const optionalColumns = [
    "public_slug",
    "image",
    "part_number",
    "mpn",
    "ean",
    "gtin",
    "supplier_code",
  ];
  for (const col of optionalColumns) {
    if (!columnSet.has(col)) {
      await run(db, `ALTER TABLE products ADD COLUMN ${col} TEXT`);
    }
  }

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

function isProductPublic(product) {
  if (!product || typeof product !== "object") return false;

  const visibility = normalizeQueryText(product.visibility || "");
  if (visibility && REJECTED_STATE_VALUES.has(visibility)) return false;

  const status = normalizeQueryText(product.status || "");
  if (status && REJECTED_STATE_VALUES.has(status)) return false;

  if (product.enabled === false) return false;
  if (product.deleted === true) return false;
  if (product.archived === true) return false;
  if (product.vip_only === true) return false;
  if (product.wholesaleOnly === true || product.wholesale_only === true) return false;

  const hasTitle = Boolean(
    toNullableText(product.name) ||
      toNullableText(product.title) ||
      toNullableText(product.productName) ||
      toNullableText(product.nombre) ||
      toNullableText(product.shortDescription) ||
      toNullableText(product.model),
  );
  if (!hasTitle) return false;

  const hasIdentifier = Boolean(
    toNullableText(product.id) ||
      toNullableText(product.sku) ||
      toNullableText(product.code) ||
      toNullableText(product.slug) ||
      toNullableText(product.partNumber) ||
      toNullableText(product.mpn) ||
      toNullableText(product.ean) ||
      toNullableText(product.gtin) ||
      toNullableText(product.supplierCode),
  );

  return hasIdentifier;
}

function buildSearchText(product = {}) {
  const fields = [
    product.name,
    product.title,
    product.brand,
    product.model,
    product.category,
    product.sku,
    product.code,
    product.id,
    product.slug,
    product.partNumber,
    product.ean,
    product.gtin,
    product.mpn,
    product.supplierCode,
    product?.metadata?.supplierPartNumber,
    product?.metadata?.supplierImport?.supplierPartNumber,
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
  let publicSlug = buildPublicSlug(product, rowNumber);
  if (slugCounts instanceof Map) {
    const current = Number(slugCounts.get(publicSlug) || 0) + 1;
    slugCounts.set(publicSlug, current);
    if (current > 1) publicSlug = `${publicSlug}-${current}`;
  }
  const price = toNumber(product.price_minorista ?? product.price, 0);
  const stock = Math.trunc(toNumber(product.stock, 0));
  return {
    id: toNullableText(product.id),
    sku: toNullableText(product.sku),
    code: toNullableText(product.code),
    slug: toNullableText(product.slug),
    public_slug: publicSlug,
    image: firstText([
      product.image,
      product.image_url,
      product.thumbnail,
      product.picture,
      Array.isArray(product.images) ? product.images[0] : null,
    ]),
    name: toNullableText(product.name),
    title: toNullableText(product.title),
    brand: normalizeQueryText(toNullableText(product.brand)),
    model: normalizeQueryText(toNullableText(product.model)),
    category: normalizeQueryText(toNullableText(product.category)),
    part_number: toNullableText(product.partNumber),
    mpn: toNullableText(product.mpn),
    ean: toNullableText(product.ean),
    gtin: toNullableText(product.gtin),
    supplier_code: toNullableText(product.supplierCode),
    status: normalizeQueryText(toNullableText(product.status)),
    visibility: normalizeQueryText(toNullableText(product.visibility)),
    stock,
    price,
    currency: toNullableText(product.currency || "ARS"),
    is_public: isProductPublic(product) ? 1 : 0,
    enabled: boolToInt(product.enabled, 1),
    deleted: boolToInt(product.deleted, 0),
    archived: boolToInt(product.archived, 0),
    vip_only: boolToInt(product.vip_only, 0),
    wholesale_only: boolToInt(product.wholesaleOnly === true || product.wholesale_only === true, 0),
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
  const name = firstText([safe.name, safe.title, safe.productName, safe.nombre, safe.model]) || "Producto";
  const brand = firstText([safe.brand, safe.marca, safe.manufacturer]) || "";
  const description =
    firstText([
      safe.description,
      safe.descripcion,
      safe.details,
      safe.detalle,
      safe.shortDescription,
      safe.longDescription,
      safe.meta_description,
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
  const price = toNumber(
    safe.price ?? safe.precio ?? safe.salePrice ?? safe.finalPrice ?? safe.price_minorista,
    0,
  );
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
    price,
    stock,
    publicSlug,
    public_slug: publicSlug,
    url: `/p/${encodeURIComponent(publicSlug)}`,
    sku: firstText([safe.sku, safe.code, safe.partNumber, safe.mpn, safe.ean, safe.gtin, safe.supplierCode]) || "",
    code: firstText([safe.code, safe.sku]) || "",
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
  return error;
}

async function rebuildProductsDbFromJson() {
  if (rebuildPromise) {
    console.log("[products-db] rebuild already in progress; waiting");
    return rebuildPromise;
  }
  rebuildPromise = (async () => {
    const startedAt = Date.now();
    const db = await openDb();
    const productsStats = await fsp.stat(PRODUCTS_JSON_PATH);
    const tmpDbPath = `${SQLITE_PATH}.tmp-${process.pid}-${Date.now()}`;

    console.log(`[products-db] rebuild start productsFilePath=${PRODUCTS_JSON_PATH}`);

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
        stock, price, currency, is_public, enabled, deleted, archived, vip_only, wholesale_only,
        search_text, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      let count = 0;
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
          batch.push(mapProductRow(product, { rowNumber: count + 1, slugCounts }));
          count += 1;
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

      const manifest = {
        productCount: count,
        productsJsonSizeBytes: Number(productsStats.size || 0),
        productsJsonMtimeMs: Number(productsStats.mtimeMs || 0),
        sqliteBuiltAt: new Date().toISOString(),
        sqlitePath: SQLITE_PATH,
        sqliteFtsEnabled: ftsEnabled,
      };

      await fsp.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");

      await new Promise((resolve, reject) => {
        tmpDb.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      if (fs.existsSync(SQLITE_PATH)) await fsp.unlink(SQLITE_PATH);
      await fsp.rename(tmpDbPath, SQLITE_PATH);

      if (dbInstance) {
        await new Promise((resolve) => dbInstance.close(() => resolve()));
        dbInstance = null;
      }

      const durationMs = Date.now() - startedAt;
      console.log(`[products-db] rebuild done count=${count} durationMs=${durationMs}`);
      countCache.clear();
      dbReady = true;
      return manifest;
    } catch (error) {
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
    rebuildPromise = null;
  }
}

async function ensureProductsDb({ allowRebuild = true } = {}) {
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
  } else if (Number(manifest.productsJsonSizeBytes || -1) !== Number(productsStats.size || 0)) {
    reason = "products_json_size_changed";
  } else if (
    Math.floor(Number(manifest.productsJsonMtimeMs || -1)) !==
    Math.floor(Number(productsStats.mtimeMs || 0))
  ) {
    reason = "products_json_mtime_changed";
  }

  if (reason) {
    console.log(`[products-db] rebuild required reason=${reason}`);
    if (!allowRebuild) throw createInitializingError(reason);
    await rebuildProductsDbFromJson();
  } else {
    console.log("[products-db] already fresh");
  }

  const db = await openDb();
  await createSchema(db);
  dbReady = true;
  return {
    dbPath: SQLITE_PATH,
    manifest: await getManifestFromDb(),
    ftsEnabled,
  };
}

async function ensureProductsDbOnce() {
  if (dbReady) return { dbPath: SQLITE_PATH, source: "sqlite", ready: true };
  if (dbReadyPromise) return dbReadyPromise;
  dbReadyPromise = ensureProductsDb({ allowRebuild: true });
  try {
    return await dbReadyPromise;
  } finally {
    dbReadyPromise = null;
  }
}

async function ensureDbReadyForRequest() {
  if (dbReady) return;
  if (dbReadyPromise) throw createInitializingError("sqlite_bootstrap_in_progress");
  await ensureProductsDb({ allowRebuild: false });
}

function buildSort(sort) {
  const allowedSorts = {
    price_asc: "price ASC, rowid ASC",
    price_desc: "price DESC, rowid ASC",
    name_asc: "name ASC, rowid ASC",
    name_desc: "name DESC, rowid ASC",
    stock_desc: "stock DESC, rowid ASC",
    stock_asc: "stock ASC, rowid ASC",
    "price-asc": "price ASC, rowid ASC",
    "price-desc": "price DESC, rowid ASC",
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
    where.push("price <= ?");
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
    price: toNumber(row.price, 0),
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
    `SELECT rowid, id, sku, code, slug, public_slug, image, name, title, brand, model, category, status, visibility, stock, price
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
  const result = await queryBase({ ...params, isPublicOnly: true });
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
  const result = await queryBase({ ...params, isPublicOnly: false });
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
  await ensureDbReadyForRequest();
  const db = await openDb();
  const row = await get(
    db,
    "SELECT rowid, raw_json, public_slug FROM products WHERE slug = ? LIMIT 1",
    [String(slug || "").trim()],
  );
  return parseRawItems(row ? [row] : [], { normalizePublic: true })[0] || null;
}

async function getProductById(id) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const row = await get(db, "SELECT rowid, raw_json, public_slug FROM products WHERE id = ? LIMIT 1", [String(id || "").trim()]);
  return parseRawItems(row ? [row] : [], { normalizePublic: true })[0] || null;
}

async function getProductByCode(code) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const target = String(code || "").trim();
  const row = await get(
    db,
    "SELECT rowid, raw_json, public_slug FROM products WHERE code = ? OR sku = ? LIMIT 1",
    [target, target],
  );
  return parseRawItems(row ? [row] : [], { normalizePublic: true })[0] || null;
}

async function getProductByPublicSlugOrAnyIdentifier(value) {
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
  if (!fs.existsSync(SQLITE_PATH)) {
    throw createInitializingError("sqlite_missing");
  }
  const db = await openDb();
  const totalRow = await get(db, "SELECT COUNT(*) AS total FROM products");
  const publicRow = await get(db, "SELECT COUNT(*) AS total FROM products WHERE is_public = 1");
  const manifest = await getManifestFromDb();
  return {
    source: "sqlite",
    sqlitePath: SQLITE_PATH,
    productCount: Number(totalRow?.total || 0),
    publicProductCount: Number(publicRow?.total || 0),
    manifest,
    lastBuilt: manifest?.sqliteBuiltAt || null,
  };
}

module.exports = {
  ensureProductsDb,
  ensureProductsDbOnce,
  rebuildProductsDbFromJson,
  queryProducts,
  queryAdminProducts,
  getProductBySlug,
  getProductById,
  getProductByCode,
  getProductByPublicSlugOrAnyIdentifier,
  getManifestFromDb,
  getCatalogHealth,
  normalizeProductForPublic,
  normalizeQueryText,
  SQLITE_PATH,
  createInitializingError,
};
