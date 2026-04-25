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
  const supplierImport = previous?.supplierImport || {};
  const catalogImportable =
    Boolean(supplierImport?.canBeOrdered) &&
    Boolean(supplierImport?.isAvailable) &&
    Number(supplierImport?.maximumQuantityInOrder || 0) > 0;
  return {
    ...previous,
    stockQuantity: stock.stockQuantity,
    stockRaw: stock.stockRaw,
    stockIsAtLeast: stock.stockIsAtLeast,
    stockUpdatedAt,
    stockSource,
    stockArticleNumber: articleNumber,
    needsStockSync: false,
    catalogImportableByRules: catalogImportable,
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
        const supplierImport = metadata?.supplierImport || {};
        const catalogImportable =
          Boolean(supplierImport?.canBeOrdered) &&
          Boolean(supplierImport?.isAvailable) &&
          Number(supplierImport?.maximumQuantityInOrder || 0) > 0;
        const isPublicByRealStock = catalogImportable && item.stock.stockQuantity > 0;
        byId.set(id, {
          ...existing,
          stock: item.stock.stockQuantity,
          remote_stock: item.stock.stockQuantity,
          stockQuantity: item.stock.stockQuantity,
          stockRaw: item.stock.stockRaw,
          stockIsAtLeast: item.stock.stockIsAtLeast,
          stockUpdatedAt: metadata.stockUpdatedAt,
          stockSource,
          visibility: isPublicByRealStock ? "public" : "private",
          enabled: isPublicByRealStock,
          available: item.stock.stockQuantity > 0,
          needsStockSync: false,
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
      safeWriteJsonWithBackup(filePath, { products: all });
    },
  };
}

function safeWriteJsonWithBackup(filePath, payload) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  );
  const backupPath = `${filePath}.bak`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath);
    }
    fs.renameSync(tmpPath, filePath);
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

async function importStockXlsxFile({
  filePath,
  maxReportedErrors = 500,
  zeroMissingProducts = false,
  onProgress = null,
  progressEveryRows = 250,
}) {
  const summary = createBaseSummary();
  const { rows, articleIndex, stockIndex } = readWorksheet(filePath, "Price list");
  const persistence = await buildJsonPersistenceLayer();

  const updates = [];
  const seenPartNumbers = new Set();
  let processedRows = 0;
  const notifyProgress = () => {
    if (typeof onProgress !== "function") return;
    onProgress({
      totalRows: Math.max(0, rows.length - 1),
      processedRows,
      matchedProducts: summary.matchedProducts,
      updatedProducts: summary.updatedProducts,
      unmatchedRows: summary.unmatchedRows,
      failedRows: summary.failedRows,
    });
  };

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
      processedRows += 1;
      if (processedRows % progressEveryRows === 0) notifyProgress();
      continue;
    }
    const key = articleNumber.toLowerCase();
    seenPartNumbers.add(key);

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
      processedRows += 1;
      if (processedRows % progressEveryRows === 0) notifyProgress();
      continue;
    }

    if (stock.stockIsAtLeast) summary.stockWithPlus += 1;
    if (stock.stockQuantity === 0) summary.zeroStockRows += 1;

    const productId = persistence.partNumberToId.get(key);
    if (!productId) {
      summary.unmatchedRows += 1;
      processedRows += 1;
      if (processedRows % progressEveryRows === 0) notifyProgress();
      continue;
    }

    summary.matchedProducts += 1;
    updates.push({ id: productId, articleNumber, stock });
    processedRows += 1;
    if (processedRows % progressEveryRows === 0) notifyProgress();
  }

  summary.updatedProducts = await persistence.updateStockBatch(updates, "mps_xlsx_nl");

  if (zeroMissingProducts && typeof persistence.zeroMissing === "function") {
    summary.zeroedMissingProducts = await persistence.zeroMissing(seenPartNumbers);
  }

  await persistence.finalize();
  processedRows = summary.totalRows;
  notifyProgress();
  return summary;
}

module.exports = {
  REQUIRED_COLUMNS,
  parseSupplierStock,
  importStockXlsxFile,
};
