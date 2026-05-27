const fs = require("fs");
const path = require("path");

const servicePath = path.join(__dirname, "..", "backend", "services", "screenPublicationService.js");
let src = fs.readFileSync(servicePath, "utf8");
const original = src;

function replaceOnce(search, replacement, label) {
  if (!src.includes(search)) {
    console.warn(`[screen-publisher-hotfix] skipped ${label}`);
    return;
  }
  src = src.replace(search, replacement);
}

replaceOnce('const VALID_AVAILABILITY = new Set(["in_stock", "preorder", "backorder", "out_of_stock"]);', 'const VALID_AVAILABILITY = new Set(["in_stock", "preorder", "backorder", "out_of_stock"]);\nconst DEFAULT_SCAN_LIMIT = 250000;\n// __SCREEN_PUBLISHER_PRODUCTION_HOTFIX__', "constants");

replaceOnce(`function publicationBucket(product = {}) {
  const state = productsSqliteRepo.computePublicationState(product);
  return state.admin_visibility_bucket || (state.is_public ? "public" : "not_public");
}`, `function publicationBucket(product = {}) {
  const state = productsSqliteRepo.computePublicationState(product);
  return state.admin_visibility_bucket || (state.is_public ? "public" : "not_public");
}

function isPublicProduct(product = {}) {
  return Boolean(productsSqliteRepo.computePublicationState(product).is_public);
}`, "publication-state-helper");

replaceOnce('async function loadRows({ limit = 100000 } = {}) {', 'async function loadRows({ limit = DEFAULT_SCAN_LIMIT, scanLimit } = {}) {', "loadRows-signature");
replaceOnce('[Math.max(1, Number(limit) || 100000)],', '[Math.max(1, Number(scanLimit || limit) || DEFAULT_SCAN_LIMIT)],', "loadRows-limit");
replaceOnce('totalProducts: rows.length,\n    blockedCount: 0,', 'totalProducts: rows.length,\n    scannedRows: rows.length,\n    blockedCount: 0,', "summary-scannedRows");

replaceOnce(`  const publicCurrent = summary.items.filter((i) => {
    const realType = type === "screen" ? i.screenClassification.isScreen : i.adhesiveClassification.isScreenAdhesive;
    return realType && (Number(i.product.is_public) === 1 || boolish(i.product.is_public));
  }).length;`, `  const publicCurrent = summary.items.filter((i) => {
    const realType = type === "screen" ? i.screenClassification.isScreen : i.adhesiveClassification.isScreenAdhesive;
    return realType && isPublicProduct(i.product);
  }).length;`, "public-current");

replaceOnce('const rows = await loadRows({ limit: filters.limit || 100000 });\n  const summary = analyzeRows(rows, filters, type);\n  delete summary.items;\n  return summary;', 'const startedAt = Date.now();\n  const rows = await loadRows({ scanLimit: filters.scanLimit || filters.maxScanRows || DEFAULT_SCAN_LIMIT });\n  const summary = analyzeRows(rows, filters, type);\n  delete summary.items;\n  summary.durationMs = Date.now() - startedAt;\n  console.info("[screen-publisher:preview]", { type, scannedRows: summary.scannedRows, eligibleCount: summary.eligibleCount || 0, blockedCount: summary.blockedCount || 0, durationMs: summary.durationMs });\n  return summary;', "preview-scanLimit");

replaceOnce('const rows = await loadRows({ limit: filters.limit || 100000 });\n  const summary = analyzeRows(rows, filters, type);\n  const eligible = summary.items.filter((i) => i.eligible);\n  const result = { ok: true, attemptedCount: eligible.length, updatedCount: 0, verifiedPublicCount: 0, failedCount: 0, samplePublished: [], sampleFailed: [] };', 'const startedAt = Date.now();\n  const rows = await loadRows({ scanLimit: filters.scanLimit || filters.maxScanRows || DEFAULT_SCAN_LIMIT });\n  const summary = analyzeRows(rows, filters, type);\n  const eligible = summary.items.filter((i) => i.eligible);\n  const result = { ok: true, attemptedCount: eligible.length, eligibleCount: eligible.length, blockedCount: summary.blockedCount || 0, warningCount: summary.warningCount || 0, updatedCount: 0, verifiedPublicCount: 0, failedCount: 0, samplePublished: [], sampleFailed: [], blockersBreakdown: summary.blockersBreakdown || {} };', "publish-result");

replaceOnce('const verified = Boolean(debug?.appearsInPublicApi || publication?.publicApiVisible || publication?.after?.is_public);', 'const verified = Boolean(debug?.appearsInPublicApi || debug?.computePublicationState?.is_public || debug?.publicationState?.is_public || publication?.publicApiVisible || publication?.after?.is_public);', "publish-verification");

replaceOnce('  return result;\n}', '  result.durationMs = Date.now() - startedAt;\n  console.info("[screen-publisher:publish]", { type, eligibleCount: result.eligibleCount, updatedCount: result.updatedCount, verifiedPublicCount: result.verifiedPublicCount, failedCount: result.failedCount, durationMs: result.durationMs });\n  return result;\n}', "publish-logs");

src = src.replace(/async function buildFeed\(type, options = \{\}\) \{[\s\S]*?\n\}\n\nfunction csvCell/, `async function buildFeed(type, options = {}) {
  const startedAt = Date.now();
  const outputLimit = Math.max(1, Number(options.outputLimit || options.limit || 100000) || 100000);
  const rows = await loadRows({ scanLimit: options.scanLimit || options.maxScanRows || DEFAULT_SCAN_LIMIT });
  const summary = analyzeRows(rows, {}, type);
  const entries = summary.items
    .filter((item) => isPublicProduct(item.product))
    .filter((item) => item.merchantReadiness?.ready)
    .map((item) => feedEntry(item, type, options.baseUrl || DEFAULT_BASE_URL))
    .filter(Boolean)
    .slice(0, outputLimit);
  const headers = ["id","title","description","link","image_link","additional_image_link","availability","availability_date","price","condition","brand","mpn","identifier_exists","google_product_category","product_type","custom_label_0","custom_label_1","custom_label_2","custom_label_3","custom_label_4"];
  const csv = [headers.join(",")].concat(entries.map((entry) => headers.map((h) => csvCell(entry[h])).join(","))).join("\\n") + "\\n";
  console.info("[screen-publisher:feed]", { type, scannedRows: summary.scannedRows, feedReadyCount: entries.length, outputLimit, durationMs: Date.now() - startedAt });
  return { entries, csv, scannedRows: summary.scannedRows, feedReadyCount: entries.length };
}

function csvCell`);

replaceOnce('is_public: p.is_public || 0,', 'is_public: isPublicProduct(p) ? 1 : 0,', "audit-is-public");

if (src !== original) {
  fs.writeFileSync(servicePath, src, "utf8");
  console.log("[screen-publisher-hotfix] updated backend/services/screenPublicationService.js");
} else {
  console.log("[screen-publisher-hotfix] already up to date");
}
