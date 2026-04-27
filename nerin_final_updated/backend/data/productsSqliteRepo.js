const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const sqlite3 = require("sqlite3");
const productsStreamRepo = require("./productsStreamRepo");
const { dataPath } = require("../utils/dataDir");

const PRODUCTS_JSON_PATH = dataPath("products.json");
const SQLITE_PATH = dataPath("products.sqlite");
const MANIFEST_PATH = dataPath("products.manifest.json");

const REJECTED_STATE_VALUES = new Set([
  "hidden",
  "private",
  "draft",
  "disabled",
  "archived",
  "deleted",
]);

let dbInstance = null;
let ftsEnabled = false;
let ensuringPromise = null;

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

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row || null);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(Array.isArray(rows) ? rows : []);
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
      name TEXT,
      title TEXT,
      brand TEXT,
      model TEXT,
      category TEXT,
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

  const indexSql = [
    "CREATE INDEX IF NOT EXISTS idx_products_id ON products(id)",
    "CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)",
    "CREATE INDEX IF NOT EXISTS idx_products_code ON products(code)",
    "CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug)",
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

  const hasTitle = Boolean(toNullableText(product.name) || toNullableText(product.title));
  if (!hasTitle) return false;

  const hasIdentifier = Boolean(
    toNullableText(product.id) ||
      toNullableText(product.sku) ||
      toNullableText(product.code) ||
      toNullableText(product.slug) ||
      toNullableText(product.partNumber),
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

function mapProductRow(product = {}) {
  const price = toNumber(product.price_minorista ?? product.price, 0);
  const stock = Math.trunc(toNumber(product.stock, 0));
  return {
    id: toNullableText(product.id),
    sku: toNullableText(product.sku),
    code: toNullableText(product.code),
    slug: toNullableText(product.slug),
    name: toNullableText(product.name),
    title: toNullableText(product.title),
    brand: normalizeQueryText(toNullableText(product.brand)),
    model: normalizeQueryText(toNullableText(product.model)),
    category: normalizeQueryText(toNullableText(product.category)),
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

function parseRawItems(rows = []) {
  return rows
    .map((row) => {
      try {
        return JSON.parse(row.raw_json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function rebuildProductsDbFromJson() {
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
      id, sku, code, slug, name, title, brand, model, category, status, visibility,
      stock, price, currency, is_public, enabled, deleted, archived, vip_only, wholesale_only,
      search_text, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    let count = 0;
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
            item.name,
            item.title,
            item.brand,
            item.model,
            item.category,
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
        batch.push(mapProductRow(product));
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

    if (fs.existsSync(SQLITE_PATH)) {
      await fsp.unlink(SQLITE_PATH);
    }
    await fsp.rename(tmpDbPath, SQLITE_PATH);

    if (dbInstance) {
      await new Promise((resolve) => {
        dbInstance.close(() => resolve());
      });
      dbInstance = null;
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[products-db] rebuild done count=${count} durationMs=${durationMs}`);
    return manifest;
  } catch (error) {
    try {
      await new Promise((resolve) => {
        tmpDb.close(() => resolve());
      });
    } catch {}
    try {
      if (fs.existsSync(tmpDbPath)) await fsp.unlink(tmpDbPath);
    } catch {}
    throw error;
  }
}

async function ensureProductsDb() {
  if (ensuringPromise) return ensuringPromise;
  ensuringPromise = (async () => {
    console.log("[products-db] checking sqlite catalog");
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
    } else if (Math.floor(Number(manifest.productsJsonMtimeMs || -1)) !== Math.floor(Number(productsStats.mtimeMs || 0))) {
      reason = "products_json_mtime_changed";
    }

    if (reason) {
      console.log(`[products-db] rebuild required reason=${reason}`);
      await rebuildProductsDbFromJson();
    }

    const db = await openDb();
    await createSchema(db);
    console.log(`[products-db] ready dbPath=${SQLITE_PATH}`);
    return {
      dbPath: SQLITE_PATH,
      manifest: await getManifestFromDb(),
      ftsEnabled,
    };
  })();

  try {
    return await ensuringPromise;
  } finally {
    ensuringPromise = null;
  }
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

async function buildWhereClause({ search = "", isPublicOnly = false, category = "", brand = "", model = "", visibility = "", status = "", stock = "", priceMax = null } = {}) {
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
      params.push(tokens || normalizedSearch.replace(/[^a-z0-9\s]/gi, " ").trim() || normalizedSearch);
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

async function queryBase({ page = 1, pageSize = 24, search = "", sort = "", isPublicOnly = false, category = "", brand = "", model = "", visibility = "", status = "", stock = "", priceMax = null } = {}) {
  await ensureProductsDb();
  const db = await openDb();
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || 24);
  const offset = (safePage - 1) * safePageSize;
  const whereClause = await buildWhereClause({
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
  const rows = await all(
    db,
    `SELECT raw_json FROM products ${whereClause.sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...whereClause.params, safePageSize, offset],
  );
  const totalRow = await get(
    db,
    `SELECT COUNT(*) AS totalItems FROM products ${whereClause.sql}`,
    whereClause.params,
  );
  const totalItems = Number(totalRow?.totalItems || 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));

  return {
    items: parseRawItems(rows),
    page: safePage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
    source: "sqlite",
    search: search || undefined,
  };
}

async function queryProducts(params = {}) {
  return queryBase({ ...params, isPublicOnly: true });
}

async function queryAdminProducts(params = {}) {
  return queryBase({ ...params, isPublicOnly: false });
}

async function getProductBySlug(slug) {
  await ensureProductsDb();
  const db = await openDb();
  const row = await get(
    db,
    "SELECT raw_json FROM products WHERE slug = ? LIMIT 1",
    [String(slug || "").trim()],
  );
  return parseRawItems(row ? [row] : [])[0] || null;
}

async function getProductById(id) {
  await ensureProductsDb();
  const db = await openDb();
  const row = await get(db, "SELECT raw_json FROM products WHERE id = ? LIMIT 1", [String(id || "").trim()]);
  return parseRawItems(row ? [row] : [])[0] || null;
}

async function getProductByCode(code) {
  await ensureProductsDb();
  const db = await openDb();
  const target = String(code || "").trim();
  const row = await get(
    db,
    "SELECT raw_json FROM products WHERE code = ? OR sku = ? LIMIT 1",
    [target, target],
  );
  return parseRawItems(row ? [row] : [])[0] || null;
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

module.exports = {
  ensureProductsDb,
  rebuildProductsDbFromJson,
  queryProducts,
  queryAdminProducts,
  getProductBySlug,
  getProductById,
  getProductByCode,
  getManifestFromDb,
  normalizeQueryText,
  SQLITE_PATH,
};
