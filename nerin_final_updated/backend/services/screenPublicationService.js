const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const sqlite3 = require("sqlite3");
const productsSqliteRepo = require("../data/productsSqliteRepo");
const { dataPath } = require("../utils/dataDir");
const {
  isRealScreenProduct,
  isScreenAdhesiveProduct,
  normalizeClassifierText,
} = require("../utils/screenProductClassifier");
const {
  resolveProductAvailability,
  getPublicPriceValue,
} = require("../utils/productAvailability");
const {
  normalizeMerchantImageUrl,
} = require("../utils/merchantFeed");

const DEFAULT_BASE_URL = "https://nerinparts.com.ar";
const GOOGLE_CATEGORY = "Electrónica > Comunicaciones > Telefonía > Accesorios para móviles";
const VALID_AVAILABILITY = new Set(["in_stock", "preorder", "backorder", "out_of_stock"]);
const DEFAULT_SCAN_LIMIT = 250000;

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows || [])));
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row || null)));
  });
}

function openReadonly(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (error) => (error ? reject(error) : resolve(db)));
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

function parseRaw(row = {}) {
  try {
    return row.raw_json ? JSON.parse(row.raw_json) : {};
  } catch {
    return {};
  }
}

function mergeRow(row = {}) {
  const raw = parseRaw(row);
  return { ...raw, ...row, raw_json: row.raw_json };
}

function firstText(values = []) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function boolish(value) {
  return value === true || value === 1 || ["1", "true", "yes", "si", "sí"].includes(String(value || "").toLowerCase());
}

function optionEnabled(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === false || value === 0) return false;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function publicationBucket(product = {}) {
  const state = productsSqliteRepo.computePublicationState(product);
  return state.admin_visibility_bucket || (state.is_public ? "public" : "not_public");
}

function isPublicProduct(product = {}) {
  return Boolean(productsSqliteRepo.computePublicationState(product).is_public);
}

function getIdentifier(product = {}) {
  return firstText([product.id, product.sku, product.code, product.public_slug, product.publicSlug, product.slug, product.mpn, product.part_number, product.rowid]);
}

function getTitle(product = {}) {
  return firstText([product.title, product.name, product.description, product.model]);
}

function getSlug(product = {}) {
  return firstText([product.public_slug, product.publicSlug, product.slug]);
}

function getImage(product = {}) {
  const images = Array.isArray(product.images) ? product.images : [];
  return firstText([product.image, product.image_url, product.thumbnail, ...images]);
}

function hasPrice(product = {}) {
  const price = getPublicPriceValue(product);
  return Number.isFinite(price) && price > 0;
}

function hasImage(product = {}) {
  return Boolean(getImage(product));
}

function availability(product = {}) {
  return resolveProductAvailability(product);
}

function isRemoteOrderable(product = {}) {
  const av = availability(product);
  return av.merchantAvailability === "preorder" || av.merchantAvailability === "backorder";
}

function isStockReal(product = {}) {
  const av = availability(product);
  return av.merchantAvailability === "in_stock" && Number(product.stock || 0) > 0;
}

function hasAvailabilityDateIfNeeded(product = {}) {
  const av = availability(product);
  if (av.merchantAvailability !== "preorder" && av.merchantAvailability !== "backorder") return true;
  return Boolean(av.availabilityDateFeed || av.availabilityStarts || product.availability_date || product.preorder_date);
}

function baseEligibility(product, classification, type) {
  const blockers = [];
  const warnings = [];
  const state = productsSqliteRepo.computePublicationState(product);
  const bucket = state.admin_visibility_bucket;
  const priceOk = hasPrice(product);
  const imageOk = hasImage(product);
  const titleOk = Boolean(getTitle(product));
  const slugOk = Boolean(getSlug(product) || state.public_slug);
  const modelOk = Boolean(classification.modelBase);
  const brandOk = Boolean(classification.deviceBrand);
  const confidenceOk = Number(classification.confidence || 0) >= 0.55;
  const av = availability(product);

  if (state.public_blockers?.includes("deleted")) blockers.push("deleted");
  if (state.public_blockers?.includes("archived")) blockers.push("archived");
  if (state.public_blockers?.includes("draft")) blockers.push("draft");
  if (state.public_blockers?.includes("disabled")) blockers.push("disabledNotOrderable");
  if (!titleOk) blockers.push("missingTitle");
  if (!priceOk) blockers.push("missingPrice");
  if (!imageOk) blockers.push("missingImage");
  if (!slugOk) blockers.push("missingSlug");
  if (!modelOk && !brandOk && !confidenceOk) blockers.push("lowClassificationConfidence");
  if (!isStockReal(product) && !isRemoteOrderable(product)) blockers.push("outOfStockNotOrderable");
  if (!hasAvailabilityDateIfNeeded(product)) blockers.push("merchantAvailabilityDateMissing");
  if (!VALID_AVAILABILITY.has(av.merchantAvailability || "")) blockers.push("merchantAvailabilityInvalid");

  const merchantReady = blockers.filter((b) => /^missing|merchant|outOfStock|lowClassification/.test(b)).length === 0;
  const indexReady = Boolean(product.product_rowid || product.rowid);
  const publishable = blockers.length === 0;
  return {
    eligible: publishable,
    publishable,
    blockers,
    warnings,
    publicationState: state,
    merchantReadiness: {
      ready: merchantReady,
      availability: av.merchantAvailability || "",
      availability_date: av.availabilityDateFeed || "",
      price: getPublicPriceValue(product),
      hasImage: imageOk,
      link: getSlug(product) ? `/p/${encodeURIComponent(getSlug(product))}` : "",
    },
    indexReadiness: { ready: indexReady, product_rowid: product.product_rowid || product.rowid || null },
    bucket,
    type,
  };
}

function computeScreenPublicationEligibility(product = {}) {
  const screenClassification = isRealScreenProduct(product);
  const base = baseEligibility(product, screenClassification, "screen");
  if (!screenClassification.isScreen) base.blockers.unshift(screenClassification.excludedAsAccessory ? "likelyAccessory" : "notRealScreen");
  if (screenClassification.excludedAsAccessory && !base.blockers.includes("likelyAccessory")) base.blockers.unshift("likelyAccessory");
  base.eligible = base.publishable = base.blockers.length === 0;
  return { ...base, screenClassification };
}

function computeScreenAdhesivePublicationEligibility(product = {}) {
  const adhesiveClassification = isScreenAdhesiveProduct(product);
  const base = baseEligibility(product, adhesiveClassification, "screen_adhesive");
  if (!adhesiveClassification.isScreenAdhesive) base.blockers.unshift(adhesiveClassification.excludedReason || "notScreenAdhesive");
  base.eligible = base.publishable = base.blockers.length === 0;
  return { ...base, adhesiveClassification };
}

function matchesFilters(item, filters = {}, type = "screen") {
  const cls = type === "screen" ? item.screenClassification : item.adhesiveClassification;
  const brand = normalizeClassifierText(filters.brand || "");
  const model = normalizeClassifierText(filters.model || "");
  const stockMode = String(filters.stockMode || "all");
  const bucket = publicationBucket(item.product);
  if (brand && normalizeClassifierText(cls.deviceBrand) !== brand) return false;
  if (model && !normalizeClassifierText(cls.modelBase).includes(model)) return false;
  if (type === "screen" && filters.qualityTier && normalizeClassifierText(cls.qualityTier) !== normalizeClassifierText(filters.qualityTier)) return false;
  if (type !== "screen" && filters.adhesiveType && normalizeClassifierText(cls.adhesiveType) !== normalizeClassifierText(filters.adhesiveType)) return false;
  if (!optionEnabled(filters.includePrivate, true) && bucket === "private") return false;
  if (!optionEnabled(filters.includeHidden, true) && bucket === "hidden") return false;
  if (!optionEnabled(filters.includeRemoteOrderable, true) && isRemoteOrderable(item.product)) return false;
  if (optionEnabled(filters.onlyWithImage, false) && !hasImage(item.product)) return false;
  if (optionEnabled(filters.onlyWithPrice, false) && !hasPrice(item.product)) return false;
  if (stockMode === "stock_real" && !isStockReal(item.product)) return false;
  if (stockMode === "remote_orderable" && !isRemoteOrderable(item.product)) return false;
  return true;
}

function counterAdd(map, key) {
  const safe = key || "unknown";
  map[safe] = (map[safe] || 0) + 1;
}

function sampleItem(item) {
  const cls = item.screenClassification || item.adhesiveClassification || {};
  return {
    id: item.product.id || item.product.sku || item.product.rowid,
    sku: item.product.sku || "",
    title: getTitle(item.product),
    public_slug: getSlug(item.product),
    brand: cls.deviceBrand || "",
    model: cls.modelBase || "",
    qualityTier: cls.qualityTier || "",
    adhesiveType: cls.adhesiveType || "",
    blockers: item.blockers || [],
    warnings: item.warnings || [],
  };
}

async function loadRows({ limit = DEFAULT_SCAN_LIMIT, scanLimit } = {}) {
  await productsSqliteRepo.ensureProductsDbOnce();
  const db = await openReadonly(productsSqliteRepo.SQLITE_PATH);
  try {
    const rows = await dbAll(
      db,
      `SELECT p.rowid, p.*, si.product_rowid, si.part_type, si.device_brand, si.compatible_brand, si.model_base, si.quality_tier, si.has_frame, si.stock_status, si.is_stock_real, si.classification_confidence, si.search_blob
       FROM products p
       LEFT JOIN product_search_index si ON si.product_rowid = p.rowid
       ORDER BY p.rowid ASC
       LIMIT ?`,
      [Math.max(1, Number(scanLimit || limit) || DEFAULT_SCAN_LIMIT)],
    );
    return rows;
  } finally {
    await closeDb(db);
  }
}

function analyzeRows(rows, filters = {}, type = "screen") {
  const summary = {
    ok: true,
    totalProducts: rows.length,
    scannedRows: rows.length,
    blockedCount: 0,
    warningCount: 0,
    byBrand: {},
    byQualityTier: {},
    byAdhesiveType: {},
    byStockStatus: {},
    byPublicationState: {},
    blockersBreakdown: {},
    eligibleSamples: [],
    blockedSamples: [],
    accessoryExcludedSamples: [],
    excludedSamples: [],
    items: [],
  };
  for (const row of rows) {
    const product = mergeRow(row);
    const eligibility = type === "screen" ? computeScreenPublicationEligibility(product) : computeScreenAdhesivePublicationEligibility(product);
    const cls = type === "screen" ? eligibility.screenClassification : eligibility.adhesiveClassification;
    const detected = type === "screen" ? cls.isScreen || cls.excludedAsAccessory : cls.isScreenAdhesive || cls.excludedReason;
    if (!detected) continue;
    const item = { ...eligibility, product };
    if (!matchesFilters(item, filters, type)) continue;
    summary.items.push(item);
    counterAdd(summary.byBrand, cls.deviceBrand || "otros");
    counterAdd(summary.byStockStatus, isStockReal(product) ? "stock_real" : isRemoteOrderable(product) ? "a_pedido" : "no_vendible");
    counterAdd(summary.byPublicationState, publicationBucket(product));
    if (type === "screen") counterAdd(summary.byQualityTier, cls.qualityTier || "unknown");
    else counterAdd(summary.byAdhesiveType, cls.adhesiveType || "adhesive");
    if (item.warnings.length) summary.warningCount += 1;
    if (item.blockers.length) {
      summary.blockedCount += 1;
      for (const blocker of item.blockers) counterAdd(summary.blockersBreakdown, blocker);
      if (summary.blockedSamples.length < 20) summary.blockedSamples.push(sampleItem(item));
    } else if (summary.eligibleSamples.length < 20) {
      summary.eligibleSamples.push(sampleItem(item));
    }
    if (type === "screen" && cls.excludedAsAccessory && summary.accessoryExcludedSamples.length < 20) summary.accessoryExcludedSamples.push(sampleItem(item));
    if (type !== "screen" && cls.excludedReason && summary.excludedSamples.length < 20) summary.excludedSamples.push(sampleItem(item));
  }
  const publicCurrent = summary.items.filter((i) => {
    const realType = type === "screen" ? i.screenClassification.isScreen : i.adhesiveClassification.isScreenAdhesive;
    return realType && isPublicProduct(i.product);
  }).length;
  const eligible = summary.items.filter((i) => i.eligible);
  summary.eligibleCount = eligible.length;
  if (type === "screen") {
    summary.totalScreensDetected = summary.items.filter((i) => i.screenClassification.isScreen).length;
    summary.publicScreensCurrent = publicCurrent;
    summary.privateScreensEligible = eligible.filter((i) => i.bucket === "private").length;
    summary.hiddenScreensEligible = eligible.filter((i) => i.bucket === "hidden").length;
    summary.remoteScreensEligible = eligible.filter((i) => isRemoteOrderable(i.product)).length;
    summary.stockRealScreensEligible = eligible.filter((i) => isStockReal(i.product)).length;
  } else {
    summary.totalScreenAdhesivesDetected = summary.items.filter((i) => i.adhesiveClassification.isScreenAdhesive).length;
    summary.publicScreenAdhesivesCurrent = publicCurrent;
    summary.privateScreenAdhesivesEligible = eligible.filter((i) => i.bucket === "private").length;
    summary.hiddenScreenAdhesivesEligible = eligible.filter((i) => i.bucket === "hidden").length;
    summary.remoteScreenAdhesivesEligible = eligible.filter((i) => isRemoteOrderable(i.product)).length;
    summary.stockRealScreenAdhesivesEligible = eligible.filter((i) => isStockReal(i.product)).length;
  }
  return summary;
}

async function previewPublication(type, filters = {}) {
  const startedAt = Date.now();
  const rows = await loadRows({ scanLimit: filters.scanLimit || filters.maxScanRows || DEFAULT_SCAN_LIMIT });
  const summary = analyzeRows(rows, filters, type);
  delete summary.items;
  summary.durationMs = Date.now() - startedAt;
  console.info("[screen-publisher:preview]", { type, scannedRows: summary.scannedRows, eligibleCount: summary.eligibleCount || 0, blockedCount: summary.blockedCount || 0, durationMs: summary.durationMs });
  return summary;
}

async function publishEligible(type, filters = {}) {
  const confirm = type === "screen" ? filters.confirmScreenBulkPublish : filters.confirmScreenAdhesiveBulkPublish;
  if (!confirm) {
    const error = new Error(type === "screen" ? "confirmScreenBulkPublish requerido" : "confirmScreenAdhesiveBulkPublish requerido");
    error.statusCode = 400;
    throw error;
  }
  const startedAt = Date.now();
  const rows = await loadRows({ scanLimit: filters.scanLimit || filters.maxScanRows || DEFAULT_SCAN_LIMIT });
  const summary = analyzeRows(rows, filters, type);
  const eligible = summary.items.filter((i) => i.eligible);
  const result = { ok: true, attemptedCount: eligible.length, eligibleCount: eligible.length, blockedCount: summary.blockedCount || 0, warningCount: summary.warningCount || 0, updatedCount: 0, verifiedPublicCount: 0, failedCount: 0, samplePublished: [], sampleFailed: [], blockersBreakdown: summary.blockersBreakdown || {} };
  for (const item of eligible) {
    const identifier = getIdentifier(item.product);
    try {
      const publication = await productsSqliteRepo.setProductVisibility(identifier, "public", { reason: type === "screen" ? "final_screen_publish" : "final_screen_adhesive_publish" });
      await productsSqliteRepo.reindexProduct(identifier);
      const debug = await productsSqliteRepo.debugPublicationByIdentifier(identifier);
      const verified = Boolean(debug?.appearsInPublicApi || debug?.computePublicationState?.is_public || debug?.publicationState?.is_public || publication?.publicApiVisible || publication?.after?.is_public);
      if (verified) {
        result.updatedCount += 1;
        result.verifiedPublicCount += 1;
        if (result.samplePublished.length < 15) result.samplePublished.push(sampleItem(item));
      } else {
        result.failedCount += 1;
        if (result.sampleFailed.length < 15) result.sampleFailed.push({ ...sampleItem(item), reason: "postVerificationFailed" });
      }
    } catch (error) {
      result.failedCount += 1;
      if (result.sampleFailed.length < 15) result.sampleFailed.push({ ...sampleItem(item), reason: error?.message || "publishFailed" });
    }
  }
  result.durationMs = Date.now() - startedAt;
  console.info("[screen-publisher:publish]", { type, eligibleCount: result.eligibleCount, updatedCount: result.updatedCount, verifiedPublicCount: result.verifiedPublicCount, failedCount: result.failedCount, durationMs: result.durationMs });
  return result;
}

function labelBrand(brand) {
  return normalizeClassifierText(brand || "otros").replace(/^apple$/, "iphone") || "otros";
}

function priority(item) {
  const cls = item.screenClassification || item.adhesiveClassification || {};
  if (isStockReal(item.product) && hasImage(item.product) && hasPrice(item.product) && cls.deviceBrand && cls.modelBase) return "priority_high";
  if (isRemoteOrderable(item.product) && cls.deviceBrand && cls.modelBase) return "priority_medium";
  return "priority_low";
}

function feedEntry(item, type, baseUrl = DEFAULT_BASE_URL) {
  const product = item.product;
  const cls = item.screenClassification || item.adhesiveClassification || {};
  const slug = getSlug(product);
  const image = normalizeMerchantImageUrl(getImage(product), baseUrl);
  const price = getPublicPriceValue(product);
  const av = availability(product);
  if (!slug || !image.valid || !Number.isFinite(price) || price <= 0 || !VALID_AVAILABILITY.has(av.merchantAvailability || "")) return null;
  if ((av.merchantAvailability === "preorder" || av.merchantAvailability === "backorder") && !av.availabilityDateFeed) return null;
  const brand = labelBrand(cls.deviceBrand || product.brand);
  const quality = type === "screen" ? (cls.qualityTier || "compatible") : cls.adhesiveType || "adhesive";
  const model = cls.modelBase || product.model || "";
  const stockLabel = isStockReal(product) ? "stock_real" : "a_pedido";
  const title = type === "screen"
    ? `${/original|service_pack/.test(quality) ? "Pantalla" : "Pantalla compatible"} ${model || getTitle(product)} ${quality.replace(/_/g, " ")}`.trim()
    : `${quality === "gasket" ? "Gasket" : quality === "seal" ? "Seal" : quality === "tape" ? "Display Adhesive Tape" : "Adhesivo de pantalla"} para ${model || getTitle(product)}`.trim();
  return {
    id: firstText([product.sku, product.id, product.mpn, product.rowid]),
    title,
    description: type === "screen"
      ? `Pantalla/modulo para ${model || "celular"}. Repuesto ${quality.replace(/_/g, " ")}. Verifica compatibilidad antes de comprar. Factura A/B y soporte tecnico.`
      : `Adhesivo/cinta/gasket para instalacion de pantalla en ${model || "celular"}. Verifica compatibilidad antes de comprar. Factura A/B y soporte tecnico.`,
    link: `${baseUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(slug)}`,
    image_link: image.normalized,
    additional_image_link: "",
    availability: av.merchantAvailability,
    availability_date: av.merchantAvailability === "preorder" || av.merchantAvailability === "backorder" ? av.availabilityDateFeed : "",
    price: `${price.toFixed(2)} ARS`,
    condition: "new",
    brand: brand === "iphone" ? "Apple" : brand,
    mpn: firstText([product.mpn, product.part_number, product.sku]),
    identifier_exists: firstText([product.mpn, product.part_number]) ? "yes" : "no",
    google_product_category: GOOGLE_CATEGORY,
    product_type: type === "screen"
      ? `Pantallas celulares > ${brand} > ${model || "otros"} > ${quality}`
      : `Adhesivos de pantalla > ${brand} > ${model || "otros"} > ${quality}`,
    custom_label_0: type === "screen" ? "screens" : "screen_adhesives",
    custom_label_1: stockLabel,
    custom_label_2: quality,
    custom_label_3: brand,
    custom_label_4: priority(item),
  };
}

async function buildFeed(type, options = {}) {
  const startedAt = Date.now();
  const outputLimit = Math.max(1, Number(options.outputLimit || options.limit || 100000) || 100000);
  const rows = await loadRows({ scanLimit: options.scanLimit || options.maxScanRows || DEFAULT_SCAN_LIMIT });
  const summary = analyzeRows(rows, {}, type);
  const entries = summary.items
    .filter((item) => type === "screen" ? item.screenClassification?.isScreen : item.adhesiveClassification?.isScreenAdhesive)
    .filter((item) => isPublicProduct(item.product))
    .filter((item) => item.merchantReadiness?.ready)
    .map((item) => feedEntry(item, type, options.baseUrl || DEFAULT_BASE_URL))
    .filter(Boolean)
    .slice(0, outputLimit);
  const headers = ["id","title","description","link","image_link","additional_image_link","availability","availability_date","price","condition","brand","mpn","identifier_exists","google_product_category","product_type","custom_label_0","custom_label_1","custom_label_2","custom_label_3","custom_label_4"];
  const csv = [headers.join(",")].concat(entries.map((entry) => headers.map((h) => csvCell(entry[h])).join(","))).join("\n") + "\n";
  console.info("[screen-publisher:feed]", { type, scannedRows: summary.scannedRows, feedReadyCount: entries.length, outputLimit, durationMs: Date.now() - startedAt });
  return { entries, csv, scannedRows: summary.scannedRows, feedReadyCount: entries.length };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function writeAuditCsv() {
  const rows = await loadRows({ limit: 100000 });
  const screens = analyzeRows(rows, {}, "screen");
  const adhesives = analyzeRows(rows, {}, "screen_adhesive");
  const exportDir = path.join(path.dirname(dataPath("x")), "..", "exports");
  await fsp.mkdir(exportDir, { recursive: true });
  const screenHeaders = ["id","sku","title","public_slug","visibility","is_public","part_type","device_brand","model_base","quality_tier","stock_status","price","has_image","availability","availability_date","eligible","merchantReady","custom_label_0","custom_label_1","custom_label_2","custom_label_3","custom_label_4","blockers","warnings"];
  const adhesiveHeaders = ["id","sku","title","public_slug","visibility","is_public","part_type","adhesive_context","device_brand","model_base","adhesive_type","stock_status","price","has_image","availability","availability_date","eligible","merchantReady","custom_label_0","custom_label_1","custom_label_2","custom_label_3","custom_label_4","blockers","warnings"];
  await fsp.writeFile(path.join(exportDir, "screens-final-audit.csv"), toAuditCsv(screens.items, "screen", screenHeaders), "utf8");
  await fsp.writeFile(path.join(exportDir, "screen-adhesives-final-audit.csv"), toAuditCsv(adhesives.items, "screen_adhesive", adhesiveHeaders), "utf8");
  return { screens, adhesives, exportDir };
}

function toAuditCsv(items, type, headers) {
  return [headers.join(",")].concat(items.map((item) => {
    const p = item.product;
    const cls = item.screenClassification || item.adhesiveClassification || {};
    const av = availability(p);
    const entry = feedEntry(item, type, DEFAULT_BASE_URL) || {};
    const values = {
      id: p.id || p.rowid, sku: p.sku || "", title: getTitle(p), public_slug: getSlug(p), visibility: p.visibility || "", is_public: isPublicProduct(p) ? 1 : 0,
      part_type: type === "screen" ? "display" : "display_adhesive", adhesive_context: type === "screen_adhesive" ? "display" : "",
      device_brand: cls.deviceBrand || "", model_base: cls.modelBase || "", quality_tier: cls.qualityTier || "", adhesive_type: cls.adhesiveType || "",
      stock_status: isStockReal(p) ? "stock_real" : isRemoteOrderable(p) ? "a_pedido" : "out_of_stock", price: getPublicPriceValue(p) || "", has_image: hasImage(p),
      availability: av.merchantAvailability || "", availability_date: av.availabilityDateFeed || "", eligible: item.eligible, merchantReady: item.merchantReadiness?.ready,
      custom_label_0: entry.custom_label_0 || "", custom_label_1: entry.custom_label_1 || "", custom_label_2: entry.custom_label_2 || "", custom_label_3: entry.custom_label_3 || "", custom_label_4: entry.custom_label_4 || "",
      blockers: (item.blockers || []).join("|"), warnings: (item.warnings || []).join("|"),
    };
    return headers.map((h) => csvCell(values[h])).join(",");
  })).join("\n") + "\n";
}

module.exports = {
  computeScreenPublicationEligibility,
  computeScreenAdhesivePublicationEligibility,
  previewPublication,
  publishEligible,
  buildFeed,
  writeAuditCsv,
  analyzeRows,
  feedEntry,
  isPublicProduct,
};
