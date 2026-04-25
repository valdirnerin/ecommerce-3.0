const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { DATA_DIR } = require("../utils/dataDir");

const REQUIRED_COLUMNS = ["Article number", "Quantity in stock (NL)"];

function normalizeCell(value) {
  if (value == null) return null;
  const text = String(value).replace(/\u0000/g, "").trim();
  return text === "" ? null : text;
}

function parseSupplierStock(value) {
  const normalized = normalizeCell(value);
  if (normalized == null) {
    return {
      stockQuantity: 0,
      stockRaw: null,
      stockIsAtLeast: false,
    };
  }

  const raw = String(normalized);
  if (/^\d+\+$/.test(raw)) {
    const stockQuantity = Number.parseInt(raw.slice(0, -1), 10);
    return {
      stockQuantity,
      stockRaw: raw,
      stockIsAtLeast: true,
    };
  }

  if (/^\d+$/.test(raw)) {
    return {
      stockQuantity: Number.parseInt(raw, 10),
      stockRaw: raw,
      stockIsAtLeast: false,
    };
  }

  throw new Error(`Invalid stock value (${raw})`);
}

function createBaseSummary() {
  return {
    totalRows: 0,
    matchedProducts: 0,
    updatedProducts: 0,
    unmatchedRows: 0,
    failedRows: 0,
    stockWithPlus: 0,
    zeroStockRows: 0,
    zeroedMissingProducts: 0,
    errors: [],
  };
}

function readWorksheet(filePath, sheetName = "Price list") {
  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    const err = new Error(`No se encontró la hoja \"${sheetName}\" en el XLSX`);
    err.code = "MISSING_SHEET";
    throw err;
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: null });
  const headerRow = rows[0] || [];
  const headerMap = new Map(
    headerRow.map((name, index) => [normalizeCell(name), index]).filter(([name]) => Boolean(name)),
  );

  const missing = REQUIRED_COLUMNS.filter((column) => !headerMap.has(column));
  if (missing.length) {
    const err = new Error(`Faltan columnas obligatorias: ${missing.join(", ")}`);
    err.code = "MISSING_REQUIRED_COLUMNS";
    throw err;
  }

  return {
    rows,
    articleIndex: headerMap.get("Article number"),
    stockIndex: headerMap.get("Quantity in stock (NL)"),
  };
}

function buildStockMetadata(product, stock, stockSource, articleNumber) {
  const previous = product?.metadata || {};
  const stockUpdatedAt = new Date().toISOString();
  return {
    ...previous,
    stockQuantity: stock.stockQuantity,
    stockRaw: stock.stockRaw,
    stockIsAtLeast: stock.stockIsAtLeast,
    stockUpdatedAt,
    stockSource,
    stockArticleNumber: articleNumber,
  };
}

async function buildJsonPersistenceLayer() {
  const filePath = path.join(DATA_DIR, "products.json");
  let current = [];
  try {
    current = JSON.parse(fs.readFileSync(filePath, "utf8")).products || [];
  } catch {
    current = [];
  }

  const byId = new Map(current.map((product) => [String(product.id), { ...product }]));
  const partNumberToId = new Map();
  for (const product of byId.values()) {
    const supplierPartNumber =
      normalizeCell(product?.metadata?.supplierImport?.supplierPartNumber) ||
      normalizeCell(product?.metadata?.supplierPartNumber) ||
      normalizeCell(product?.sku) ||
      normalizeCell(product?.partNumber);
    if (supplierPartNumber) {
      partNumberToId.set(supplierPartNumber.toLowerCase(), String(product.id));
    }
  }

  return {
    partNumberToId,
    async updateStockBatch(batch, stockSource = "mps_xlsx_nl") {
      const touched = new Set();
      for (const item of batch) {
        const id = String(item.id);
        const existing = byId.get(id);
        if (!existing) continue;
        const metadata = buildStockMetadata(existing, item.stock, stockSource, item.articleNumber);
        byId.set(id, {
          ...existing,
          stock: item.stock.stockQuantity,
          remote_stock: item.stock.stockQuantity,
          stockQuantity: item.stock.stockQuantity,
          stockRaw: item.stock.stockRaw,
          stockIsAtLeast: item.stock.stockIsAtLeast,
          stockUpdatedAt: metadata.stockUpdatedAt,
          stockSource,
          metadata,
        });
        touched.add(id);
      }
      return touched.size;
    },
    async zeroMissing(seenPartNumbers = new Set()) {
      const missingBatch = [];
      for (const [partNumber, id] of partNumberToId.entries()) {
        if (!seenPartNumbers.has(partNumber)) {
          missingBatch.push({
            id,
            articleNumber: partNumber,
            stock: {
              stockQuantity: 0,
              stockRaw: null,
              stockIsAtLeast: false,
            },
          });
        }
      }
      if (!missingBatch.length) return 0;
      return this.updateStockBatch(missingBatch, "mps_xlsx_nl_zero_missing");
    },
    async finalize() {
      const all = Array.from(byId.values());
      fs.writeFileSync(filePath, JSON.stringify({ products: all }, null, 2), "utf8");
    },
  };
}

async function buildPgPersistenceLayer(pool) {
  const { rows } = await pool.query(
    `SELECT id,
            metadata->>'supplierPartNumber' AS supplier_part_number,
            metadata->'supplierImport'->>'supplierPartNumber' AS nested_supplier_part_number
     FROM products`,
  );

  const partNumberToId = new Map();
  for (const row of rows) {
    const candidate =
      normalizeCell(row.nested_supplier_part_number) || normalizeCell(row.supplier_part_number);
    if (candidate) {
      partNumberToId.set(candidate.toLowerCase(), String(row.id));
    }
  }

  return {
    partNumberToId,
    async updateStockBatch(batch, stockSource = "mps_xlsx_nl") {
      if (!batch.length) return 0;
      const values = [];
      const placeholders = [];
      let i = 1;
      for (const item of batch) {
        placeholders.push(`($${i},$${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5})`);
        values.push(
          String(item.id),
          item.stock.stockQuantity,
          item.stock.stockRaw,
          item.stock.stockIsAtLeast,
          stockSource,
          item.articleNumber,
        );
        i += 6;
      }

      const sql = `
        UPDATE products p
        SET stock = v.stock,
            metadata = COALESCE(p.metadata, '{}'::jsonb) || jsonb_build_object(
              'stockQuantity', v.stock,
              'stockRaw', v.stock_raw,
              'stockIsAtLeast', v.stock_is_at_least,
              'stockUpdatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'stockSource', v.stock_source,
              'stockArticleNumber', v.article_number
            ),
            updated_at = now()
        FROM (VALUES ${placeholders.join(",")}) AS v(
          id,
          stock,
          stock_raw,
          stock_is_at_least,
          stock_source,
          article_number
        )
        WHERE p.id::text = v.id
      `;

      const result = await pool.query(sql, values);
      return result.rowCount || 0;
    },
    async zeroMissing(seenPartNumbers = new Set()) {
      const missingBatch = [];
      for (const [partNumber, id] of partNumberToId.entries()) {
        if (!seenPartNumbers.has(partNumber)) {
          missingBatch.push({
            id,
            articleNumber: partNumber,
            stock: {
              stockQuantity: 0,
              stockRaw: null,
              stockIsAtLeast: false,
            },
          });
        }
      }
      if (!missingBatch.length) return 0;
      return this.updateStockBatch(missingBatch, "mps_xlsx_nl_zero_missing");
    },
    async finalize() {},
  };
}

async function importStockXlsxFile({
  filePath,
  pool = null,
  maxReportedErrors = 500,
  zeroMissingProducts = false,
}) {
  const summary = createBaseSummary();
  const { rows, articleIndex, stockIndex } = readWorksheet(filePath, "Price list");
  const persistence = pool
    ? await buildPgPersistenceLayer(pool)
    : await buildJsonPersistenceLayer();

  const updates = [];
  const seenPartNumbers = new Set();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const rowNumber = i + 1;
    summary.totalRows += 1;

    const articleNumber = normalizeCell(row[articleIndex]);
    if (!articleNumber) {
      summary.failedRows += 1;
      if (summary.errors.length < maxReportedErrors) {
        summary.errors.push({
          row: rowNumber,
          articleNumber: null,
          reason: "Article number vacío",
        });
      }
      continue;
    }

    let stock;
    try {
      stock = parseSupplierStock(row[stockIndex]);
    } catch (error) {
      summary.failedRows += 1;
      if (summary.errors.length < maxReportedErrors) {
        summary.errors.push({
          row: rowNumber,
          articleNumber,
          reason: error.message || "Invalid stock value",
        });
      }
      continue;
    }

    if (stock.stockIsAtLeast) summary.stockWithPlus += 1;
    if (stock.stockQuantity === 0) summary.zeroStockRows += 1;

    const key = articleNumber.toLowerCase();
    seenPartNumbers.add(key);
    const productId = persistence.partNumberToId.get(key);
    if (!productId) {
      summary.unmatchedRows += 1;
      continue;
    }

    summary.matchedProducts += 1;
    updates.push({ id: productId, articleNumber, stock });
  }

  summary.updatedProducts = await persistence.updateStockBatch(updates, "mps_xlsx_nl");

  if (zeroMissingProducts && typeof persistence.zeroMissing === "function") {
    summary.zeroedMissingProducts = await persistence.zeroMissing(seenPartNumbers);
  }

  await persistence.finalize();
  return summary;
}

module.exports = {
  REQUIRED_COLUMNS,
  parseSupplierStock,
  importStockXlsxFile,
};
