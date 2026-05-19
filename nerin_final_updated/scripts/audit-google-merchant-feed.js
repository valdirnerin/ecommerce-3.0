#!/usr/bin/env node

const sqlite3 = require("sqlite3");
const productsSqliteRepo = require("../backend/data/productsSqliteRepo");
const {
  buildMerchantFeedEntries,
  isEligibleState,
  normalizeMerchantImageUrl,
} = require("../backend/utils/merchantFeed");
const {
  resolveProductAvailability,
  getPublicPriceValue,
  parseAvailabilityDate,
} = require("../backend/utils/productAvailability");

const BASE_URL = process.env.PUBLIC_BASE_URL || "https://nerinparts.com.ar";
const PREORDER_DAYS = Math.max(1, Number(process.env.MERCHANT_PREORDER_DAYS || 30) || 30);
const DAY_MS = 24 * 60 * 60 * 1000;

function sqliteAll(dbConn, sql, params = []) {
  return new Promise((resolve, reject) => {
    dbConn.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows || []);
    });
  });
}

function openReadonly(dbPath) {
  return new Promise((resolve, reject) => {
    const dbConn = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (error) => {
      if (error) reject(error);
      else resolve(dbConn);
    });
  });
}

function closeDb(dbConn) {
  return new Promise((resolve) => dbConn.close(() => resolve()));
}

function extractRaw(row = {}) {
  try {
    return JSON.parse(row.raw_json || "{}");
  } catch {
    return {};
  }
}

function mergeProductData(row = {}, raw = {}) {
  const merged = { ...raw };
  for (const [key, value] of Object.entries(row || {})) {
    if (value !== undefined && value !== null && value !== "") merged[key] = value;
  }
  return merged;
}

function isPublic(row = {}, raw = {}) {
  const truthy = (value) => value === true || value === 1 || String(value).toLowerCase() === "true";
  return Number(row.is_public) === 1 || truthy(raw.is_public) || truthy(raw.publicable);
}

function getIdentifier(row = {}, raw = {}) {
  return String(row.sku || row.id || row.mpn || row.part_number || raw.sku || raw.id || raw.mpn || raw.part_number || "").trim();
}

function getLandingUrl(row = {}, raw = {}) {
  const slug = String(row.public_slug || row.slug || raw.public_slug || raw.slug || "").trim();
  return slug ? `${BASE_URL}/p/${encodeURIComponent(slug)}` : "";
}

function getImageLink(row = {}, raw = {}) {
  const image = [row.image, row.image_url, raw.image, raw.image_url, ...(Array.isArray(raw.images) ? raw.images : [])].filter(Boolean)[0];
  return normalizeMerchantImageUrl(image || "", BASE_URL);
}

function utcDateOnly(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isDateOlderThanToday(value, now = new Date()) {
  const parsed = parseAvailabilityDate(value);
  return Boolean(parsed && parsed <= utcDateOnly(now));
}

function isDateMoreThanOneYearAhead(value, now = new Date()) {
  const parsed = parseAvailabilityDate(value);
  if (!parsed) return false;
  return parsed > new Date(utcDateOnly(now).getTime() + 365 * DAY_MS);
}

function pushSample(errors, entry) {
  if (errors.length < 20) errors.push(entry);
}

async function main() {
  await productsSqliteRepo.ensureProductsDbOnce();
  const dbConn = await openReadonly(productsSqliteRepo.SQLITE_PATH);
  try {
    const tableInfo = await sqliteAll(dbConn, "PRAGMA table_info(products)");
    const availableColumns = new Set(tableInfo.map((col) => String(col.name || "").trim()).filter(Boolean));
    const preferredColumns = [
      "id","sku","slug","public_slug","name","title","description","brand","stock","remote_stock","stock_remote","available_remote",
      "remote_lead_days","remote_lead_min_days","remote_lead_max_days","stock_mode","fulfillment_mode","availability","availability_date",
      "preorder_date","price","price_minorista","price_mayorista","precio_minorista","precio_mayorista","precio_final","image","image_url",
      "raw_json","status","visibility","enabled","deleted","archived","vip_only","wholesale_only","is_public","part_number","mpn","category",
    ];
    const selected = ["rowid", ...preferredColumns.map((col) => availableColumns.has(col) ? col : `NULL AS ${col}`)];
    const rows = await sqliteAll(dbConn, `SELECT ${selected.join(", ")} FROM products ORDER BY rowid ASC`);
    const feed = buildMerchantFeedEntries(rows, { limit: Math.max(rows.length, 1), offset: 0, preorderDays: PREORDER_DAYS, baseUrl: BASE_URL });
    const entriesById = new Map(feed.entries.map((entry) => [String(entry.id), entry]));
    const summary = {
      totalProducts: rows.length,
      publicProducts: 0,
      preorderProducts: 0,
      preorderMissingAvailabilityDate: 0,
      preorderMissingVisibleDate: 0,
      preorderMissingJsonLdAvailabilityStarts: 0,
      productsWithAvailabilityDateOlderThanToday: 0,
      productsWithAvailabilityDateMoreThanOneYearAhead: 0,
      productsWithPriceMismatch: 0,
      productsWithMissingImage: 0,
      productsWithMissingLandingUrl: 0,
      criticalErrorCount: 0,
      sampleErrors: [],
    };

    for (const row of rows) {
      const raw = extractRaw(row);
      if (!isPublic(row, raw)) continue;
      summary.publicProducts += 1;
      const product = mergeProductData(row, raw);
      const id = getIdentifier(row, raw) || `row:${row.rowid}`;
      const title = row.name || row.title || raw.name || raw.title || "";
      const landingUrl = getLandingUrl(row, raw);
      const image = getImageLink(row, raw);
      if (!landingUrl) {
        summary.productsWithMissingLandingUrl += 1;
        pushSample(summary.sampleErrors, { id, title, reason: "missingLandingUrl" });
      }
      if (!image.valid) {
        summary.productsWithMissingImage += 1;
        pushSample(summary.sampleErrors, { id, title, reason: `missingImage:${image.reason}` });
      }
      if (!isEligibleState(row, raw)) continue;
      const availability = resolveProductAvailability(product);
      const feedEntry = entriesById.get(String(id));
      if (["preorder", "backorder"].includes(availability.merchantAvailability)) {
        summary.preorderProducts += 1;
        const feedDate = feedEntry?.availability_date || "";
        if (!feedDate) {
          summary.preorderMissingAvailabilityDate += 1;
          pushSample(summary.sampleErrors, { id, title, reason: "preorderMissingAvailabilityDate" });
        }
        if (!availability.availabilityDateDisplay || !availability.visibleAvailabilityText.includes(availability.availabilityDateDisplay)) {
          summary.preorderMissingVisibleDate += 1;
          pushSample(summary.sampleErrors, { id, title, reason: "preorderMissingVisibleDate" });
        }
        if (!availability.availabilityStarts) {
          summary.preorderMissingJsonLdAvailabilityStarts += 1;
          pushSample(summary.sampleErrors, { id, title, reason: "preorderMissingJsonLdAvailabilityStarts" });
        }
        if (isDateOlderThanToday(feedDate)) {
          summary.productsWithAvailabilityDateOlderThanToday += 1;
          pushSample(summary.sampleErrors, { id, title, reason: "availabilityDateOlderThanToday", availabilityDate: feedDate });
        }
        if (isDateMoreThanOneYearAhead(feedDate)) {
          summary.productsWithAvailabilityDateMoreThanOneYearAhead += 1;
          pushSample(summary.sampleErrors, { id, title, reason: "availabilityDateMoreThanOneYearAhead", availabilityDate: feedDate });
        }
      }
      if (feedEntry) {
        const visiblePrice = `${getPublicPriceValue(product).toFixed(2)} ARS`;
        if (feedEntry.price !== visiblePrice) {
          summary.productsWithPriceMismatch += 1;
          pushSample(summary.sampleErrors, { id, title, reason: "priceMismatch", feedPrice: feedEntry.price, visiblePrice });
        }
      }
    }

    summary.criticalErrorCount =
      summary.preorderMissingAvailabilityDate +
      summary.preorderMissingVisibleDate +
      summary.preorderMissingJsonLdAvailabilityStarts +
      summary.productsWithAvailabilityDateOlderThanToday +
      summary.productsWithAvailabilityDateMoreThanOneYearAhead +
      summary.productsWithPriceMismatch +
      summary.productsWithMissingLandingUrl;

    console.log(JSON.stringify(summary, null, 2));
    if (summary.criticalErrorCount > 0) process.exitCode = 1;
  } finally {
    await closeDb(dbConn);
  }
}

main().catch((error) => {
  console.error("[audit-google-merchant-feed] failed", error);
  process.exit(1);
});
