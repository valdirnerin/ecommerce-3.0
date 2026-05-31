const assert = require("assert");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");

function openDb(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (error) => {
      if (error) reject(error);
      else resolve(db);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve(this);
    });
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function main() {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "nerin-catalog-legacy-"));
  process.env.NODE_ENV = "production";
  process.env.CATALOG_AUTO_REBUILD = "false";
  process.env.DATA_DIR = tempDir;
  process.env.DATABASE_PATH = path.join(tempDir, "products.sqlite");

  await fsp.writeFile(path.join(tempDir, "products.json"), JSON.stringify([{ id: "legacy-1" }]), "utf8");
  await fsp.writeFile(
    path.join(tempDir, "products.manifest.json"),
    JSON.stringify({
      sqliteSchemaVersion: 6,
      mappingVersion: 5,
      productCount: 1,
      publicProductCount: 1,
      productsJsonSizeBytes: 0,
      productsJsonMtimeMs: 0,
    }),
    "utf8",
  );

  const db = await openDb(process.env.DATABASE_PATH);
  try {
    await run(
      db,
      `CREATE TABLE products (
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
        enabled INTEGER,
        deleted INTEGER,
        archived INTEGER,
        vip_only INTEGER,
        wholesale_only INTEGER,
        is_public INTEGER,
        search_text TEXT,
        raw_json TEXT
      )`,
    );
    await run(
      db,
      "INSERT INTO products (id, sku, public_slug, name, title, status, visibility, stock, price, price_minorista, price_mayorista, precio_minorista, precio_mayorista, precio_final, precio_sin_impuestos, cost, currency, enabled, deleted, archived, vip_only, wholesale_only, is_public, search_text, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "legacy-1",
        "LEG-1",
        "legacy-product",
        "Legacy Product",
        "Legacy Product",
        "active",
        "public",
        3,
        100,
        100,
        90,
        100,
        90,
        100,
        82,
        70,
        "ARS",
        1,
        0,
        0,
        0,
        0,
        1,
        "legacy product",
        JSON.stringify({ id: "legacy-1", name: "Legacy Product", is_public: true }),
      ],
    );
    await run(
      db,
      `CREATE TABLE product_search_index (
        product_id TEXT,
        product_rowid INTEGER,
        public_slug TEXT,
        title TEXT,
        normalized_title TEXT,
        sku TEXT,
        mpn TEXT,
        part_number TEXT,
        brand TEXT,
        device_brand TEXT,
        compatible_brand TEXT,
        official_brand TEXT,
        is_compatible_for_brand INTEGER,
        part_type TEXT,
        model_family TEXT,
        model_base TEXT,
        model_generation TEXT,
        model_variant TEXT,
        network_variant TEXT,
        quality_tier TEXT,
        has_frame INTEGER,
        color TEXT,
        stock INTEGER,
        stock_status TEXT,
        is_stock_real INTEGER,
        price REAL,
        has_image INTEGER,
        is_public INTEGER,
        classification_confidence REAL,
        search_blob TEXT,
        filters_blob TEXT,
        updated_at TEXT
      )`,
    );
    await run(
      db,
      "INSERT INTO product_search_index (product_id, product_rowid, public_slug, title, normalized_title, sku, stock, stock_status, is_stock_real, price, has_image, is_public, classification_confidence, search_blob, filters_blob, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["legacy-1", 1, "legacy-product", "Legacy Product", "legacy product", "LEG-1", 3, "in_stock", 1, 100, 0, 1, 1, "legacy product", "{}", new Date().toISOString()],
    );
  } finally {
    await closeDb(db);
  }

  const repo = require("../backend/data/productsSqliteRepo");
  const ensured = await repo.ensureProductsDbOnce();
  assert.strictEqual(ensured.ready, true);
  assert.strictEqual(ensured.source, "sqlite_legacy_usable");
  assert.strictEqual(ensured.freshnessReason, "schema_version_changed");

  const health = await repo.getCatalogHealth();
  assert.strictEqual(health.ready, true);
  assert.strictEqual(health.failed, false);
  assert.strictEqual(health.dbExists, true);
  assert.strictEqual(health.manifestExists, true);
  assert.strictEqual(health.productsCount, 1);
  assert.strictEqual(health.freshnessReason, "schema_version_changed");
  assert.ok(health.tables.includes("products"));

  const result = await repo.queryProducts({ page: 1, pageSize: 10 });
  assert.strictEqual(result.totalItems, 1);
  assert.strictEqual(result.items[0].id, "legacy-1");

  await repo.closeProductsDbForTests();
  await fsp.rm(tempDir, { recursive: true, force: true });
  console.log("[test-catalog-schema-version-legacy-ready] ok");
}

main().catch((error) => {
  console.error("[test-catalog-schema-version-legacy-ready] failed", error);
  process.exit(1);
});
