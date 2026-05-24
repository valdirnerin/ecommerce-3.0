const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const productsRepo = require("../backend/data/productsSqliteRepo");

function openDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(productsRepo.SQLITE_PATH, sqlite3.OPEN_READONLY, (error) => {
      if (error) reject(error);
      else resolve(db);
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

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function parseRaw(row) {
  try {
    return row.raw_json ? JSON.parse(row.raw_json) : {};
  } catch {
    return {};
  }
}

async function main() {
  await productsRepo.ensureProductsDb();
  const db = await openDb();
  try {
    const rows = await all(
      db,
      `SELECT p.rowid, p.id, p.sku, p.code, p.name, p.title, p.visibility, p.status, p.enabled, p.is_public AS sqlite_is_public,
              p.public_slug, p.raw_json, si.product_rowid AS index_rowid, si.is_public AS index_is_public,
              si.public_slug AS index_public_slug, si.updated_at AS index_updated_at
       FROM products p
       LEFT JOIN product_search_index si ON si.product_rowid = p.rowid
       ORDER BY p.rowid ASC`,
    );

    const inconsistencies = [];
    let publicByVisibility = 0;
    let publicByIsPublic = 0;
    let publicInSearchIndex = 0;
    let privateVisibleInPublicApi = 0;
    let publicMissingFromPublicApi = 0;
    let indexStaleCount = 0;

    for (const row of rows) {
      const raw = parseRaw(row);
      const state = productsRepo.computePublicationState(raw);
      const sqlitePublic = Number(row.sqlite_is_public || 0) === 1;
      const indexPublic = Number(row.index_is_public || 0) === 1;
      if (state.visibility === "public") publicByVisibility += 1;
      if (sqlitePublic) publicByIsPublic += 1;
      if (indexPublic) publicInSearchIndex += 1;

      const reasons = [];
      if (!state.is_public && indexPublic) {
        privateVisibleInPublicApi += 1;
        reasons.push("private_visible_in_public_api");
      }
      if (state.is_public && !indexPublic) {
        publicMissingFromPublicApi += 1;
        reasons.push("public_missing_from_public_api");
      }
      if (sqlitePublic !== indexPublic || sqlitePublic !== state.is_public) {
        indexStaleCount += 1;
        reasons.push("index_or_sqlite_stale");
      }
      if (!row.index_rowid) reasons.push("missing_search_index_row");

      if (reasons.length) {
        inconsistencies.push({
          rowid: row.rowid,
          id: row.id || "",
          sku: row.sku || "",
          code: row.code || "",
          title: row.name || row.title || "",
          visibility: row.visibility || "",
          status: row.status || "",
          enabled: row.enabled,
          sqlite_is_public: sqlitePublic,
          computed_is_public: state.is_public,
          index_is_public: indexPublic,
          admin_visibility_bucket: state.admin_visibility_bucket,
          public_slug: row.public_slug || "",
          index_public_slug: row.index_public_slug || "",
          blockers: state.public_blockers.join("|"),
          reasons: reasons.join("|"),
        });
      }
    }

    const privateFilter = await productsRepo.queryAdminProducts({ page: 1, pageSize: 50000, visibility: "private", structuredSearch: "1" });
    const publicReturnedByPrivateFilter = (privateFilter.items || []).filter((item) => item.is_public === true || item.visibility === "public");
    const publicVisibleInApi = publicInSearchIndex;

    const exportDir = path.join(process.cwd(), "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    const csvPath = path.join(exportDir, "publication-consistency-audit.csv");
    const headers = [
      "rowid", "id", "sku", "code", "title", "visibility", "status", "enabled",
      "sqlite_is_public", "computed_is_public", "index_is_public", "admin_visibility_bucket",
      "public_slug", "index_public_slug", "blockers", "reasons",
    ];
    const csv = [
      headers.join(","),
      ...inconsistencies.map((row) => headers.map((key) => csvEscape(row[key])).join(",")),
    ].join("\n");
    fs.writeFileSync(csvPath, csv, "utf8");

    const summary = {
      total: rows.length,
      public_by_visibility: publicByVisibility,
      public_by_is_public: publicByIsPublic,
      public_in_search_index: publicInSearchIndex,
      public_visible_in_api: publicVisibleInApi,
      private_visible_in_public_api: privateVisibleInPublicApi,
      public_missing_from_public_api: publicMissingFromPublicApi,
      private_returned_by_private_filter: Number(privateFilter.totalItems || privateFilter.items?.length || 0),
      public_returned_by_private_filter: publicReturnedByPrivateFilter.length,
      index_stale_count: indexStaleCount,
      sample_inconsistencies: inconsistencies.slice(0, 20),
      csv: csvPath,
      criticalErrors:
        privateVisibleInPublicApi +
        publicMissingFromPublicApi +
        publicReturnedByPrivateFilter.length +
        indexStaleCount,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (summary.criticalErrors > 0) process.exitCode = 1;
  } finally {
    await closeDb(db);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
