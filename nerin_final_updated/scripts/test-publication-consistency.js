const assert = require("assert");
const fs = require("fs");
const sqlite3 = require("sqlite3");
const { dataPath } = require("../backend/utils/dataDir");
const repo = require("../backend/data/productsSqliteRepo");

const overridesPath = dataPath("products.overrides.json");

function openDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(repo.SQLITE_PATH, sqlite3.OPEN_READWRITE, (error) => {
      if (error) reject(error);
      else resolve(db);
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
      else resolve(rows || []);
    });
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function main() {
  const originalOverrides = fs.existsSync(overridesPath) ? fs.readFileSync(overridesPath, "utf8") : null;
  await repo.ensureProductsDb();
  const db = await openDb();
  const touched = [];
  try {
    const publicState = repo.computePublicationState({
      id: "pub-1",
      name: "Display Test Public",
      slug: "display-test-public",
      visibility: "public",
      status: "active",
      enabled: true,
    });
    assert.strictEqual(publicState.is_public, true, "visibility public + enabled true debe ser publico");

    const privateState = repo.computePublicationState({
      id: "priv-1",
      name: "Display Test Private",
      slug: "display-test-private",
      visibility: "private",
      status: "private",
      enabled: true,
    });
    assert.strictEqual(privateState.is_public, false, "visibility private no debe ser publico");
    assert.strictEqual(privateState.admin_visibility_bucket, "private", "private debe caer en bucket private");

    const rows = await all(db, "SELECT rowid, id, sku, code, public_slug, visibility, status, enabled, is_public, raw_json FROM products ORDER BY rowid ASC LIMIT 3");
    assert(rows.length >= 2, "se necesitan al menos 2 productos para testear publicacion");
    for (const row of rows.slice(0, 2)) touched.push(row);

    const first = touched[0];
    const firstId = first.id || first.sku || first.code || first.public_slug || String(first.rowid);
    await repo.setProductVisibility(firstId, "private", { reason: "test_private" });
    let privateDebug = await repo.debugPublicationByIdentifier(firstId);
    assert.strictEqual(privateDebug.computePublicationState.is_public, false, "PATCH public->private debe dejar is_public false");
    assert.strictEqual(privateDebug.appearsInPublicApi, false, "private no debe aparecer en API publica");

    let adminPrivate = await repo.queryAdminProducts({ page: 1, pageSize: 50, visibility: "private", structuredSearch: "1" });
    assert((adminPrivate.items || []).some((item) => String(item.id || item.sku) === String(first.id || first.sku)), "private debe aparecer en filtro admin privado");
    assert(!(adminPrivate.items || []).some((item) => item.is_public === true), "filtro admin private no debe devolver publicos");

    await repo.setProductVisibility(firstId, "public", { reason: "test_public" });
    const publicDebug = await repo.debugPublicationByIdentifier(firstId);
    assert.strictEqual(publicDebug.computePublicationState.is_public, true, "PATCH private->public debe dejar is_public true");
    assert.strictEqual(publicDebug.appearsInPublicApi, true, "publicado debe aparecer en API publica");
    assert.strictEqual(publicDebug.indexPublicMatchesSqlite, true, "indice y SQLite deben coincidir");

    const publicSearch = await repo.queryProducts({ page: 1, pageSize: 20, search: first.sku || first.id || first.public_slug });
    assert((publicSearch.items || []).some((item) => String(item.id || item.sku) === String(first.id || first.sku)), "producto publicado debe aparecer en busqueda publica");

    const second = touched[1];
    const secondId = second.id || second.sku || second.code || second.public_slug || String(second.rowid);
    await repo.setProductVisibility(secondId, "private", { reason: "test_bulk_private" });
    const bulk = await repo.bulkPublishEligible({
      dryRun: false,
      filters: { search: second.sku || second.id || second.public_slug },
      limit: 1,
      includePrivateHidden: true,
      confirmPrivateHiddenPublish: true,
    });
    assert.strictEqual(bulk.updatedCount, 1, "bulk publish debe contar solo productos realmente publicados");
    assert.strictEqual(bulk.verificationOk, true, "bulk publish debe verificar visibilidad real");
    const bulkDebug = await repo.debugPublicationByIdentifier(secondId);
    assert.strictEqual(bulkDebug.appearsInPublicApi, true, "bulk publish debe actualizar indice publico");

    adminPrivate = await repo.queryAdminProducts({ page: 1, pageSize: 50, visibility: "private", structuredSearch: "1" });
    assert(!(adminPrivate.items || []).some((item) => String(item.id || item.sku) === String(second.id || second.sku)), "bulk publicado no debe seguir en filtro private");

    const structuredPrivate = await repo.queryAdminProducts({ page: 1, pageSize: 50, visibility: "private", structuredSearch: "1", search: second.sku || second.id || "" });
    assert(!(structuredPrivate.items || []).some((item) => item.is_public === true), "structuredSearch + visibility private no debe devolver publicos");

    const indexRow = await get(db, "SELECT is_public FROM product_search_index WHERE product_rowid = ?", [second.rowid]);
    assert.strictEqual(Number(indexRow?.is_public || 0), 1, "product_search_index debe quedar publico despues de publicar");

    console.log(JSON.stringify({ ok: true, tests: 10, message: "publication consistency tests passed" }, null, 2));
  } finally {
    for (const row of touched) {
      const identifier = row.id || row.sku || row.code || row.public_slug || String(row.rowid);
      await repo.updateProductByIdentifier(identifier, {
        visibility: row.visibility,
        status: row.status,
        enabled: row.enabled === 1,
        is_public: row.is_public === 1,
      });
    }
    await closeDb(db);
    if (originalOverrides == null) {
      try { fs.unlinkSync(overridesPath); } catch {}
    } else {
      fs.writeFileSync(overridesPath, originalOverrides, "utf8");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
