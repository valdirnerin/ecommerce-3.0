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

async function seedDb(db) {
  await run(
    db,
    `CREATE TABLE products (
      id TEXT, sku TEXT, code TEXT, slug TEXT, public_slug TEXT, image TEXT,
      name TEXT, title TEXT, brand TEXT, model TEXT, category TEXT,
      status TEXT, visibility TEXT, stock INTEGER, price REAL,
      price_minorista REAL, price_mayorista REAL, precio_minorista REAL,
      precio_mayorista REAL, precio_final REAL, precio_sin_impuestos REAL,
      cost REAL, currency TEXT, enabled INTEGER, deleted INTEGER,
      archived INTEGER, vip_only INTEGER, wholesale_only INTEGER,
      is_public INTEGER, search_text TEXT, raw_json TEXT
    )`,
  );
  await run(
    db,
    `CREATE TABLE product_search_index (
      product_id TEXT, product_rowid INTEGER, public_slug TEXT, title TEXT,
      normalized_title TEXT, sku TEXT, mpn TEXT, part_number TEXT, brand TEXT,
      device_brand TEXT, compatible_brand TEXT, official_brand TEXT,
      is_compatible_for_brand INTEGER, part_type TEXT, model_family TEXT,
      model_base TEXT, model_generation TEXT, model_variant TEXT,
      network_variant TEXT, quality_tier TEXT, has_frame INTEGER, color TEXT,
      stock INTEGER, stock_status TEXT, is_stock_real INTEGER, price REAL,
      has_image INTEGER, is_public INTEGER, classification_confidence REAL,
      search_blob TEXT, filters_blob TEXT, updated_at TEXT
    )`,
  );

  const heavyRawJson = JSON.stringify({
    id: "admin-1",
    description: "x".repeat(250000),
    compatibilities: Array.from({ length: 1000 }, (_, index) => ({ model: `iphone-${index}` })),
  });

  for (let index = 1; index <= 80; index += 1) {
    const isPrivate = index <= 65;
    const productId = `admin-${index}`;
    const title = index <= 65 ? `Display iPhone ${index}` : `Bateria Samsung ${index}`;
    await run(
      db,
      `INSERT INTO products (
        id, sku, code, slug, public_slug, image, name, title, brand, model,
        category, status, visibility, stock, price, price_minorista,
        price_mayorista, precio_minorista, precio_mayorista, precio_final,
        precio_sin_impuestos, cost, currency, enabled, deleted, archived,
        vip_only, wholesale_only, is_public, search_text, raw_json
      ) VALUES (${Array.from({ length: 31 }, () => "?").join(", ")})`,
      [
        productId,
        `SKU-${index}`,
        `SKU-${index}`,
        `slug-${index}`,
        `slug-${index}`,
        `/img/${index}.jpg`,
        title,
        title,
        index <= 65 ? "Apple" : "Samsung",
        index <= 65 ? "iPhone" : "Galaxy",
        "Pantallas",
        isPrivate ? "private" : "active",
        isPrivate ? "private" : "public",
        10 + index,
        1000 + index,
        1000 + index,
        900 + index,
        1000 + index,
        900 + index,
        1000 + index,
        800 + index,
        700 + index,
        "ARS",
        1,
        0,
        0,
        0,
        0,
        isPrivate ? 0 : 1,
        `${title} apple iphone display`,
        index === 1 ? heavyRawJson : JSON.stringify({ id: productId, title }),
      ],
    );
    await run(
      db,
      `INSERT INTO product_search_index (
        product_id, product_rowid, public_slug, title, normalized_title, sku,
        mpn, part_number, brand, device_brand, compatible_brand, official_brand,
        is_compatible_for_brand, part_type, model_family, model_base,
        model_generation, model_variant, network_variant, quality_tier,
        has_frame, color, stock, stock_status, is_stock_real, price,
        has_image, is_public, classification_confidence, search_blob,
        filters_blob, updated_at
      ) VALUES (${Array.from({ length: 32 }, () => "?").join(", ")})`,
      [
        productId,
        index,
        `slug-${index}`,
        title,
        title.toLowerCase(),
        `SKU-${index}`,
        "",
        "",
        index <= 65 ? "apple" : "samsung",
        index <= 65 ? "apple" : "samsung",
        index <= 65 ? "apple" : "samsung",
        index <= 65 ? "apple" : "samsung",
        0,
        index <= 65 ? "display" : "battery",
        "",
        index <= 65 ? "iphone" : "galaxy",
        "",
        "",
        "",
        "standard",
        0,
        "",
        10 + index,
        "in_stock",
        1,
        1000 + index,
        1,
        isPrivate ? 0 : 1,
        1,
        `${title.toLowerCase()} apple iphone display sku-${index}`,
        "{}",
        new Date(Date.now() - index * 1000).toISOString(),
      ],
    );
  }
}

async function main() {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "nerin-admin-products-perf-"));
  process.env.NODE_ENV = "production";
  process.env.CATALOG_AUTO_REBUILD = "false";
  process.env.DATA_DIR = tempDir;
  process.env.DATABASE_PATH = path.join(tempDir, "products.sqlite");

  await fsp.writeFile(path.join(tempDir, "products.json"), JSON.stringify([{ id: "admin-1" }]), "utf8");
  await fsp.writeFile(
    path.join(tempDir, "products.manifest.json"),
    JSON.stringify({
      sqliteSchemaVersion: 6,
      mappingVersion: 5,
      productCount: 80,
      publicProductCount: 15,
    }),
    "utf8",
  );

  const db = await openDb(process.env.DATABASE_PATH);
  try {
    await seedDb(db);
  } finally {
    await closeDb(db);
  }

  const repo = require("../backend/data/productsSqliteRepo");
  const result = await repo.queryAdminProducts({
    page: 1,
    pageSize: 100,
    sort: "recent",
    debugQueryPlan: true,
  });

  assert.strictEqual(result.source, "sqlite_search_index_admin");
  assert.strictEqual(result.items.length, 80);
  assert.strictEqual(result.pageSize, 100);
  assert.ok(Number.isFinite(result.countMs), "countMs debe estar presente");
  assert.ok(Number.isFinite(result.selectMs), "selectMs debe estar presente");
  assert.ok(Number.isFinite(result.mapMs), "mapMs debe estar presente");
  assert.ok(Number.isFinite(result.totalDurationMs), "totalDurationMs debe estar presente");
  assert.ok(result.queryPlan?.select?.length > 0, "debugQueryPlan debe devolver EXPLAIN QUERY PLAN");
  assert.deepStrictEqual(result.facets, {}, "facetas no deben calcularse salvo includeFacets");

  const first = result.items[0];
  assert.ok(first.id && first.sku && first.title, "admin list debe devolver campos livianos basicos");
  assert.strictEqual(first.raw_json, undefined, "admin list no debe exponer raw_json");
  assert.strictEqual(first.description, undefined, "admin list no debe traer descripcion pesada");
  assert.strictEqual(first.compatibilities, undefined, "admin list no debe parsear compatibilidades pesadas");

  const filtered = await repo.queryAdminProducts({
    page: 1,
    pageSize: 50,
    search: "iphone",
    visibility: "private",
    partType: "display",
    sort: "recent",
  });
  assert.strictEqual(filtered.items.length, 50);
  assert.ok(filtered.totalItems >= 65, "filtro admin debe encontrar productos privados consultables");

  const facets = await repo.queryAdminProducts({
    page: 1,
    pageSize: 50,
    includeFacets: true,
  });
  assert.ok(Array.isArray(facets.facets?.part_type), "includeFacets debe mantener facetas disponibles");

  await repo.closeProductsDbForTests();
  await fsp.rm(tempDir, { recursive: true, force: true });
  console.log("[test-admin-products-sqlite-performance] ok");
}

main().catch((error) => {
  console.error("[test-admin-products-sqlite-performance] failed", error);
  process.exit(1);
});
