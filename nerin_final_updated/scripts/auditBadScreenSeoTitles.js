const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const productsSqliteRepo = require("../backend/data/productsSqliteRepo");
const { detectProductType } = require("../backend/utils/productTaxonomy");
const { generateProductSeo } = require("../backend/utils/productSeo");

const root = path.resolve(__dirname, "..");
const reportDir = path.join(root, "nerin-data");
const reportPath = path.join(reportDir, "bad-screen-seo-titles-report.json");

function normalizeText(value) { return value == null ? "" : String(value).replace(/\s+/g, " ").trim(); }
function hasBadScreenSeoSignal(product = {}) {
  const haystack = [product.seoTitle, product.seo_title, product.meta_title, product.name, product.title].map(normalizeText).join(" ");
  return /\b(m[oó]dulo\s+pantalla|modulo\s+pantalla|pantalla|original\s+service\s+pack)\b/i.test(haystack);
}
function getRows(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (error) => { if (error) reject(error); });
    db.all("SELECT rowid, id, sku, name, title, raw_json FROM products ORDER BY rowid ASC", [], (error, rows) => {
      db.close();
      if (error) reject(error); else resolve(rows || []);
    });
  });
}
function buildReportItem(row, product, detectedProductType) {
  const generated = generateProductSeo(product);
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
async function auditBadScreenSeoTitles() {
  const dbPath = productsSqliteRepo.SQLITE_PATH;
  const rows = fs.existsSync(dbPath) ? await getRows(dbPath) : [];
  const findings = [];
  for (const row of rows) {
    let product = {};
    try { product = JSON.parse(row.raw_json || "{}"); } catch {}
    product = { id: row.id, sku: row.sku, name: row.name, title: row.title, ...product };
    const detectedProductType = detectProductType(product);
    if (detectedProductType === "Pantalla / display") continue;
    if (!hasBadScreenSeoSignal(product)) continue;
    findings.push(buildReportItem(row, product, detectedProductType));
  }
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), count: findings.length, items: findings }, null, 2), "utf8");
  return { count: findings.length, reportPath };
}
if (require.main === module) {
  auditBadScreenSeoTitles().then((result) => {
    console.log(`[bad-screen-seo-audit] findings=${result.count}`);
    console.log(`[bad-screen-seo-audit] report=${result.reportPath}`);
  }).catch((error) => { console.error("[bad-screen-seo-audit] failed", error?.message || error); process.exitCode = 1; });
}
module.exports = { auditBadScreenSeoTitles, hasBadScreenSeoSignal };
