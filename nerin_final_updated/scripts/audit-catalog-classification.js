#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const productsSqliteRepo = require("../backend/data/productsSqliteRepo");

const root = path.resolve(__dirname, "..");
const exportDir = path.join(root, "exports");
const csvPath = path.join(exportDir, "catalog-classification-audit.csv");

function openDb(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (error) => {
      if (error) reject(error);
      else resolve(db);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows || [])));
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

function pct(part, total) {
  return total > 0 ? Number(((part / total) * 100).toFixed(2)) : 0;
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function topCounts(rows, key, limit = 12) {
  return rows
    .filter((row) => row[key])
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
    .slice(0, limit);
}

async function main() {
  await productsSqliteRepo.ensureProductsDbOnce();
  const db = await openDb(productsSqliteRepo.SQLITE_PATH);
  try {
    const total = (await all(db, "SELECT COUNT(*) AS count FROM product_search_index WHERE is_public = 1"))[0]?.count || 0;
    const stats = (await all(db, `SELECT
      SUM(CASE WHEN part_type != '' THEN 1 ELSE 0 END) AS partType,
      SUM(CASE WHEN device_brand != '' THEN 1 ELSE 0 END) AS brand,
      SUM(CASE WHEN model_base != '' THEN 1 ELSE 0 END) AS model,
      SUM(CASE WHEN quality_tier != '' THEN 1 ELSE 0 END) AS quality,
      SUM(CASE WHEN color != '' THEN 1 ELSE 0 END) AS color,
      SUM(CASE WHEN classification_confidence < 0.55 THEN 1 ELSE 0 END) AS lowConfidence
      FROM product_search_index WHERE is_public = 1`))[0] || {};
    const missing = await all(db, `SELECT product_id, sku, title, public_slug, part_type, device_brand, model_base, model_variant, quality_tier, color, has_frame, stock_status, classification_confidence, filters_blob
      FROM product_search_index
      WHERE is_public = 1 AND (part_type = '' OR device_brand = '' OR model_base = '' OR classification_confidence < 0.55)
      ORDER BY classification_confidence ASC, title ASC LIMIT 50`);
    const brandCounts = await all(db, "SELECT device_brand AS value, COUNT(*) AS count FROM product_search_index WHERE is_public = 1 AND device_brand != '' GROUP BY device_brand ORDER BY count DESC LIMIT 20");
    const modelCounts = await all(db, "SELECT model_base AS value, COUNT(*) AS count FROM product_search_index WHERE is_public = 1 AND model_base != '' GROUP BY model_base ORDER BY count DESC LIMIT 20");
    const partCounts = await all(db, "SELECT part_type AS value, COUNT(*) AS count FROM product_search_index WHERE is_public = 1 AND part_type != '' GROUP BY part_type ORDER BY count DESC LIMIT 20");
    const examples = await all(db, `SELECT part_type, product_id, sku, title, device_brand, model_base, quality_tier, color, classification_confidence
      FROM product_search_index WHERE is_public = 1 AND part_type != ''
      ORDER BY part_type, classification_confidence DESC LIMIT 120`);
    const csvRows = await all(db, `SELECT product_id, sku, title, public_slug, part_type, device_brand, model_base, model_variant, quality_tier, color, has_frame, stock_status, classification_confidence, filters_blob
      FROM product_search_index WHERE is_public = 1 ORDER BY product_rowid ASC`);
    await fs.promises.mkdir(exportDir, { recursive: true });
    const lines = [
      ["id", "sku", "title", "public_slug", "part_type", "device_brand", "model_base", "model_variant", "quality_tier", "color", "has_frame", "stock_status", "confidence", "blockers"].join(","),
      ...csvRows.map((row) => {
        let blockers = [];
        try {
          blockers = JSON.parse(row.filters_blob || "{}").blockers || [];
        } catch {}
        return [
          row.product_id,
          row.sku,
          row.title,
          row.public_slug,
          row.part_type,
          row.device_brand,
          row.model_base,
          row.model_variant,
          row.quality_tier,
          row.color,
          row.has_frame,
          row.stock_status,
          row.classification_confidence,
          blockers.join("|"),
        ].map(csvEscape).join(",");
      }),
    ];
    await fs.promises.writeFile(csvPath, `${lines.join("\n")}\n`, "utf8");
    const report = {
      totalProducts: Number(total),
      publicProducts: Number(total),
      classifiedPartTypePercent: pct(Number(stats.partType || 0), total),
      brandDetectedPercent: pct(Number(stats.brand || 0), total),
      modelDetectedPercent: pct(Number(stats.model || 0), total),
      qualityDetectedPercent: pct(Number(stats.quality || 0), total),
      colorDetectedPercent: pct(Number(stats.color || 0), total),
      productsWithoutClassification: missing.length,
      lowConfidenceCount: Number(stats.lowConfidence || 0),
      commonBrands: topCounts(brandCounts, "value"),
      commonModels: topCounts(modelCounts, "value"),
      commonPartTypes: topCounts(partCounts, "value"),
      probableErrors: missing.slice(0, 12).map((row) => ({ id: row.product_id, sku: row.sku, title: row.title, confidence: row.classification_confidence })),
      examplesByCategory: examples.slice(0, 30),
      csvExport: path.relative(root, csvPath).replace(/\\/g, "/"),
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await closeDb(db);
  }
}

main().catch((error) => {
  console.error("[audit-catalog-classification]", error?.stack || error?.message || error);
  process.exit(1);
});
