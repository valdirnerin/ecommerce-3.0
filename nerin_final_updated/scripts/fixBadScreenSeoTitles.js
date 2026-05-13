const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const productsSqliteRepo = require("../backend/data/productsSqliteRepo");
const { detectProductType } = require("../backend/utils/productTaxonomy");
const { generateProductSeo } = require("../backend/utils/productSeo");
const { hasBadScreenSeoSignal } = require("./auditBadScreenSeoTitles");

const root = path.resolve(__dirname, "..");
const reportDir = path.join(root, "nerin-data");
const reportPath = path.join(reportDir, "bad-screen-seo-titles-report.json");
function normalizeText(value) { return value == null ? "" : String(value).replace(/\s+/g, " ").trim(); }
function parseArgs(argv = process.argv.slice(2)) {
  const args = { dryRun: true, apply: false, limit: 100 };
  for (const arg of argv) {
    if (arg === "--dry-run") { args.dryRun = true; args.apply = false; }
    else if (arg === "--apply") { args.apply = true; args.dryRun = false; }
    else if (arg.startsWith("--limit=")) {
      const limit = Number(arg.slice("--limit=".length));
      if (Number.isFinite(limit) && limit > 0) args.limit = Math.floor(limit);
    }
  }
  return args;
}
function openDb(dbPath, mode) { return new Promise((resolve, reject) => { const db = new sqlite3.Database(dbPath, mode, (error) => error ? reject(error) : resolve(db)); }); }
function all(db, sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []))); }
function run(db, sql, params = []) { return new Promise((resolve, reject) => db.run(sql, params, function done(error) { error ? reject(error) : resolve({ changes: this.changes || 0 }); })); }
function closeDb(db) { return new Promise((resolve) => db.close(() => resolve())); }
function buildReportItem(row, product, detectedProductType, generated) {
  return {
    id: normalizeText(product.id || row.id),
    sku: normalizeText(product.sku || row.sku),
    name: normalizeText(product.name || row.name),
    title: normalizeText(product.title || row.title),
    seoTitle: normalizeText(product.seoTitle || product.seo_title || product.meta_title),
    seoDescription: normalizeText(product.seoDescription || product.seo_description || product.meta_description),
    detectedProductType,
    suggestedTitle: generated.title,
    suggestedSeoDescription: generated.description,
  };
}
async function fixBadScreenSeoTitles(options = parseArgs()) {
  const dbPath = productsSqliteRepo.SQLITE_PATH;
  if (!fs.existsSync(dbPath)) return { scanned: 0, candidates: 0, updated: 0, reportPath, missingDb: true };
  const db = await openDb(dbPath, options.apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY);
  let scanned = 0;
  let updated = 0;
  const reportItems = [];
  try {
    const rows = await all(db, "SELECT rowid, id, sku, name, title, raw_json FROM products ORDER BY rowid ASC", []);
    for (const row of rows) {
      if (reportItems.length >= options.limit) break;
      scanned += 1;
      let product = {};
      try { product = JSON.parse(row.raw_json || "{}"); } catch {}
      product = { id: row.id, sku: row.sku, name: row.name, title: row.title, ...product };
      const detectedProductType = detectProductType(product);
      if (detectedProductType === "Pantalla / display") continue;
      if (!hasBadScreenSeoSignal(product)) continue;
      const generated = generateProductSeo(product);
      reportItems.push(buildReportItem(row, product, detectedProductType, generated));
      if (options.apply) {
        const nextProduct = { ...product, seoTitle: generated.title, seoDescription: generated.description };
        const result = await run(db, "UPDATE products SET raw_json = ? WHERE rowid = ?", [JSON.stringify(nextProduct), row.rowid]);
        updated += result.changes;
      }
    }
  } finally { await closeDb(db); }
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), mode: options.apply ? "apply" : "dry-run", scanned, count: reportItems.length, updated, items: reportItems }, null, 2), "utf8");
  return { scanned, candidates: reportItems.length, updated, reportPath };
}
if (require.main === module) {
  const options = parseArgs();
  fixBadScreenSeoTitles(options).then((result) => {
    console.log(`[bad-screen-seo-fix] mode=${options.apply ? "apply" : "dry-run"}`);
    console.log(`[bad-screen-seo-fix] scanned=${result.scanned} candidates=${result.candidates} updated=${result.updated}`);
    console.log(`[bad-screen-seo-fix] report=${result.reportPath}`);
  }).catch((error) => { console.error("[bad-screen-seo-fix] failed", error?.message || error); process.exitCode = 1; });
}
module.exports = { fixBadScreenSeoTitles, parseArgs };
