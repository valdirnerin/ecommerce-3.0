const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { once } = require("events");
const Decimal = require("decimal.js");
const { parse } = require("csv-parse");
const { DATA_DIR } = require("../utils/dataDir");
const { readJsonFile } = require("../utils/jsonFile");
const {
  computePricingForRow,
  createPricingSummaryAccumulator,
} = require("./catalogPricing");

const REQUIRED_COLUMNS = [
  "PartId",
  "ManufacturerName",
  "ManufacturerId",
  "PartNumber",
  "Description",
  "Status",
  "CanBeOrdered",
  "UnitPrice",
  "StockQuantity",
  "MaximumQuantityInOrder",
];

const IMAGE_COLUMNS = ["ImageUrl", "ImageUrl2", "ImageUrl3", "ImageUrl4", "ImageUrl5"];

function normalizeCell(value) {
  if (value == null) return null;
  const text = String(value).replace(/\u0000/g, "").trim();
  return text === "" ? null : text;
}

function isRowFullyEmpty(row) {
  return Object.values(row || {}).every((value) => normalizeCell(value) == null);
}

function parseStrictInteger(value, fieldName) {
  const text = normalizeCell(value);
  if (text == null) throw new Error(`${fieldName} es obligatorio`);
  if (!/^-?\d+$/.test(text)) {
    throw new Error(`${fieldName} debe ser entero`);
  }
  return Number.parseInt(text, 10);
}

function parseEuropeanDecimal(value, fieldName = "UnitPrice") {
  const raw = normalizeCell(value);
  if (raw == null) throw new Error(`${fieldName} es obligatorio`);
  let text = raw.replace(/\s+/g, "");

  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(text)) {
    text = text.replace(/\./g, "");
  }

  if (text.includes(",")) {
    text = text.replace(",", ".");
  }

  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new Error(`${fieldName} inválido (${raw})`);
  }

  return Number(new Decimal(text).toString());
}

function parseCanBeOrdered(value) {
  const normalized = normalizeCell(value);
  if (normalized === "Yes") return true;
  if (normalized === "No") return false;
  throw new Error(`CanBeOrdered inválido (${normalized ?? "vacío"})`);
}

function deriveStatusFlags(status) {
  const source = String(status || "");
  const lowered = source.toLowerCase();
  const hasAvailableWord = /\bavailable\b/i.test(source);
  const hasUnavailableWord =
    /\bunavailable\b/i.test(source) ||
    /\bnot\s+available\b/i.test(source) ||
    /\bout\s+of\s+stock\b/i.test(source);
  return {
    isAvailable: hasAvailableWord && !hasUnavailableWord,
    hasLongerDeliveryTime: lowered.includes("longer delivery time"),
    isExpiring: source.trim() === "Expiring",
  };
}

function extractImages(row) {
  return IMAGE_COLUMNS.map((key) => normalizeCell(row?.[key])).filter(Boolean);
}

function validateRequiredColumns(columns = []) {
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  return {
    ok: missing.length === 0,
    missing,
  };
}

function toImportedRecord(row, line) {
  const partId = parseStrictInteger(row.PartId, "PartId");
  const manufacturerId = parseStrictInteger(row.ManufacturerId, "ManufacturerId");
  const supplierPartNumber = normalizeCell(row.PartNumber);
  if (!supplierPartNumber) {
    throw new Error("PartNumber es obligatorio");
  }
  const description = normalizeCell(row.Description);
  if (!description) {
    throw new Error("Description es obligatoria");
  }
  const supplierStatus = normalizeCell(row.Status);
  if (!supplierStatus) {
    throw new Error("Status es obligatorio");
  }

  const unitPrice = parseEuropeanDecimal(row.UnitPrice, "UnitPrice");
  const stockQuantity = parseStrictInteger(row.StockQuantity, "StockQuantity");
  const maximumQuantityInOrder = parseStrictInteger(
    row.MaximumQuantityInOrder,
    "MaximumQuantityInOrder",
  );
  const canBeOrdered = parseCanBeOrdered(row.CanBeOrdered);
  const images = extractImages(row);

  const record = {
    externalId: partId,
    supplierPartNumber,
    manufacturerName: normalizeCell(row.ManufacturerName),
    externalManufacturerId: manufacturerId,
    manufacturerArticleCode: normalizeCell(row.ManufacturerArticleCode),
    mainCategory: normalizeCell(row.MainCategory),
    subCategory: normalizeCell(row.SubCategory),
    description,
    supplierStatus,
    ...deriveStatusFlags(supplierStatus),
    canBeOrdered,
    unitPrice,
    stockQuantity,
    maximumQuantityInOrder,
    quality: normalizeCell(row.Quality),
    remarks: normalizeCell(row.Remarks),
    eanNumber: normalizeCell(row.EanNumber),
    countryOfOrigin: normalizeCell(row.CountryOfOrigin),
    productGroup: normalizeCell(row.ProductGroup),
    images,
    pricing: null,
  };

  if (!record.manufacturerName) {
    throw new Error("ManufacturerName es obligatorio");
  }

  return {
    line,
    record,
    rowKey: String(partId),
    supplierPartNumberKey: supplierPartNumber.toLowerCase(),
  };
}

function isImportableByAvailability(record) {
  const stock = Number(record?.stockQuantity || 0);
  const maxOrder = Number(record?.maximumQuantityInOrder || 0);
  return Boolean(record?.canBeOrdered) && Boolean(record?.isAvailable) && stock > 0 && maxOrder > 0;
}

function classifyAvailabilitySkip(record) {
  const stock = Number(record?.stockQuantity || 0);
  const maxOrder = Number(record?.maximumQuantityInOrder || 0);
  return {
    noStock: stock <= 0,
    notOrderable: !Boolean(record?.canBeOrdered),
    statusNotAvailable: !Boolean(record?.isAvailable),
    maxOrderZero: maxOrder <= 0,
  };
}

function createBaseSummary() {
  return {
    totalRows: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errorsCount: 0,
    errorsSample: [],
    safety: {
      skippedUnavailable: 0,
      skippedNoStock: 0,
      skippedNotOrderable: 0,
      skippedStatusNotAvailable: 0,
      skippedMaxOrderZero: 0,
      importedVisibleOrPublishable: 0,
      importedHiddenNoStockOrNotOrderable: 0,
      archivedMissing: 0,
    },
    catalog: {
      totalProductsAfterImport: 0,
      withSupplierPartNumber: 0,
      potentialXlsxMatches: 0,
      visibleOrPublishable: 0,
      hiddenNoStockOrNotOrderable: 0,
    },
    options: {
      includeOutOfStock: false,
      archiveMissing: false,
    },
  };
}

async function estimateCsvRows(filePath) {
  let lineCount = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (String(line || "").trim()) lineCount += 1;
  }
  return Math.max(0, lineCount - 1);
}

function createImportError(line, message, context = null) {
  return {
    line,
    message,
    ...(context ? { context } : {}),
  };
}

function isCatalogImportedProduct(product) {
  const source = normalizeCell(product?.metadata?.importSource);
  return source === "catalog_csv" || Boolean(product?.metadata?.supplierImport?.externalId);
}

function mapImportedRecordToStoreProduct(imported, importedAtIso) {
  const finalPrice = Number(imported?.pricing?.precio_final_ars);
  const safePrice =
    Number.isFinite(finalPrice) && finalPrice > 0 ? finalPrice : imported.unitPrice;
  const leadDays = Number(imported?.pricing?.tiempo_demora_dias || 20);
  const safeLeadDays = Number.isFinite(leadDays) && leadDays > 0 ? Math.floor(leadDays) : 20;
  const metadata = {
    supplierImport: {
      source: "parts_csv",
      externalId: imported.externalId,
      supplierPartNumber: imported.supplierPartNumber,
      csvImportedAt: importedAtIso,
      csvStatus: imported.supplierStatus,
      csvCanBeOrdered: imported.canBeOrdered,
      csvStockQuantity: imported.stockQuantity,
      csvMaximumQuantityInOrder: imported.maximumQuantityInOrder,
      pricing: imported.pricing || null,
    },
    supplierPartNumber: imported.supplierPartNumber,
    csvStockQuantity: imported.stockQuantity,
    importSource: "catalog_csv",
    importVersion: 2,
    importedAt: importedAtIso,
    needsStockSync: true,
  };
  const isPublishableByCatalogSignals = isImportableByAvailability(imported);

  return {
    id: String(imported.externalId),
    sku: imported.supplierPartNumber,
    name: imported.description,
    description: imported.description,
    brand: imported.manufacturerName,
    price: safePrice,
    price_minorista: safePrice,
    price_mayorista: safePrice,
    stock: 0,
    min_stock: 0,
    stock_mode: "remote",
    fulfillment_mode: "remote",
    remote_stock: 0,
    remote_lead_days: safeLeadDays,
    remote_lead_min_days: safeLeadDays,
    remote_lead_max_days: safeLeadDays,
    visibility: isPublishableByCatalogSignals ? "public" : "private",
    enabled: isPublishableByCatalogSignals,
    available: false,
    needsStockSync: true,
    image: imported.images[0] || null,
    images: imported.images,
    metadata,
  };
}

async function buildPgPersistenceLayer(pool) {
  const { rows } = await pool.query(
    `SELECT id, metadata->>'supplierPartNumber' AS supplier_part_number,
            metadata->'supplierImport'->>'supplierPartNumber' AS nested_supplier_part_number
     FROM products`,
  );
  const partNumberToId = new Map();
  for (const row of rows) {
    const candidate =
      normalizeCell(row.nested_supplier_part_number) || normalizeCell(row.supplier_part_number);
    if (candidate) partNumberToId.set(candidate.toLowerCase(), String(row.id));
  }
  return {
    partNumberToId,
    async upsertBatch(batch, importedAtIso) {
      if (!batch.length) return { inserted: 0, updated: 0 };
      const values = [];
      const placeholders = [];
      let i = 1;
      for (const item of batch) {
        const mapped = mapImportedRecordToStoreProduct(item.record, importedAtIso);
        placeholders.push(`($${i},$${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5})`);
        values.push(mapped.id, mapped.name, mapped.price, mapped.stock, mapped.image, mapped.metadata);
        i += 6;
      }
      const sql = `INSERT INTO products (id, name, price, stock, image_url, metadata)
        VALUES ${placeholders.join(",")}
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, price = EXCLUDED.price, stock = EXCLUDED.stock,
          image_url = EXCLUDED.image_url, metadata = EXCLUDED.metadata, updated_at = now()
        RETURNING (xmax = 0) AS inserted`;
      const result = await pool.query(sql, values);
      const inserted = result.rows.filter((row) => row.inserted).length;
      return { inserted, updated: result.rowCount - inserted };
    },
  };
}

async function writeJsonArrayItem(writeStream, state, item) {
  const prefix = state.count > 0 ? "," : "";
  const serialized = `${prefix}${JSON.stringify(item)}`;
  if (!writeStream.write(serialized)) {
    await once(writeStream, "drain");
  }
  state.count += 1;
}


function writeProductsManifest({
  productsFilePath,
  productCount,
  supplierProductCount,
  withSupplierPartNumber,
  publicableCount,
  hiddenCount,
  source,
}) {
  const manifestPath = path.join(DATA_DIR, "products.manifest.json");
  const sizeBytes = fs.existsSync(productsFilePath)
    ? Number(fs.statSync(productsFilePath).size || 0)
    : 0;
  const payload = {
    productCount: Number(productCount || 0),
    supplierProductCount: Number(supplierProductCount || 0),
    withSupplierPartNumber: Number(withSupplierPartNumber || 0),
    publicableCount: Number(publicableCount || 0),
    hiddenCount: Number(hiddenCount || 0),
    updatedAt: new Date().toISOString(),
    source: String(source || "catalogCsvImport"),
    productsFileSizeBytes: sizeBytes,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2), "utf8");
}
async function importCatalogCsvFile({
  filePath,
  pool = null,
  chunkSize = 400,
  maxReportedErrors = 100,
  includeOutOfStock = false,
  archiveMissing = false,
  onProgress = null,
  progressEveryRows = 250,
  jobId = `manual_${Date.now()}`,
}) {
  const summary = createBaseSummary();
  summary.options.includeOutOfStock = Boolean(includeOutOfStock);
  summary.options.archiveMissing = Boolean(archiveMissing);
  const pricingSummary = createPricingSummaryAccumulator();
  const seenPartIds = new Set();
  const seenPartNumbers = new Set();

  const productsFilePath = path.join(DATA_DIR, "products.json");
  const stagingPath = path.join(DATA_DIR, `products.importing.${jobId}.json`);
  const importedAtIso = new Date().toISOString();

  if (pool) {
    const persistence = await buildPgPersistenceLayer(pool);
    let pendingBatch = [];
    let processedRows = 0;
    const seenPartIds = new Set();
    const seenPartNumbers = new Set();
    const importedAtIsoPg = new Date().toISOString();
    const parseStream = fs.createReadStream(filePath, { encoding: "utf8" }).pipe(parse({
      columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, info: true,
    }));
    const flushBatch = async () => {
      if (!pendingBatch.length) return;
      const { inserted, updated } = await persistence.upsertBatch(pendingBatch, importedAtIsoPg);
      summary.inserted += inserted;
      summary.updated += updated;
      pendingBatch = [];
    };
    for await (const data of parseStream) {
      const row = data.record || {};
      const line = data.info?.lines || null;
      if (isRowFullyEmpty(row)) continue;
      summary.totalRows += 1;
      try {
        const transformed = toImportedRecord(row, line);
        transformed.record.pricing = computePricingForRow(row, undefined, {
          costColumn: "UnitPrice",
          currencyHeuristics: { assumeEuropeanSupplier: true },
        }).pricing;
        pricingSummary.add(row, transformed.record.pricing);
        if (seenPartIds.has(transformed.rowKey)) throw new Error(`PartId duplicado dentro del CSV (${transformed.rowKey})`);
        seenPartIds.add(transformed.rowKey);
        if (seenPartNumbers.has(transformed.supplierPartNumberKey)) throw new Error(`PartNumber duplicado dentro del CSV (${transformed.record.supplierPartNumber})`);
        seenPartNumbers.add(transformed.supplierPartNumberKey);
        if (!includeOutOfStock && !isImportableByAvailability(transformed.record)) {
          const skipReason = classifyAvailabilitySkip(transformed.record);
          summary.skipped += 1;
          summary.safety.skippedUnavailable += 1;
          if (skipReason.noStock) summary.safety.skippedNoStock += 1;
          if (skipReason.notOrderable) summary.safety.skippedNotOrderable += 1;
          if (skipReason.statusNotAvailable) summary.safety.skippedStatusNotAvailable += 1;
          if (skipReason.maxOrderZero) summary.safety.skippedMaxOrderZero += 1;
          continue;
        }
        pendingBatch.push(transformed);
        if (pendingBatch.length >= chunkSize) await flushBatch();
      } catch (error) {
        summary.failed += 1;
        summary.errorsCount += 1;
        if (summary.errorsSample.length < maxReportedErrors) summary.errorsSample.push(createImportError(line, error.message));
      }
      processedRows += 1;
      if (onProgress && processedRows % progressEveryRows === 0) onProgress({ processedRows, totalRows: summary.totalRows, inserted: summary.inserted, updated: summary.updated, skipped: summary.skipped, failed: summary.failed });
    }
    await flushBatch();
    summary.pricing = pricingSummary.finalize();
    summary.errors = summary.errorsSample;
    summary.catalog.totalProductsAfterImport = summary.inserted + summary.updated;
    summary.catalog.withSupplierPartNumber = summary.inserted + summary.updated;
    summary.catalog.potentialXlsxMatches = summary.inserted + summary.updated;
    try {
      writeProductsManifest({
        productsFilePath,
        productCount: summary.catalog.totalProductsAfterImport,
        supplierProductCount: summary.catalog.totalProductsAfterImport,
        withSupplierPartNumber: summary.catalog.withSupplierPartNumber,
        publicableCount: summary.catalog.visibleOrPublishable || summary.catalog.totalProductsAfterImport,
        hiddenCount: summary.catalog.hiddenNoStockOrNotOrderable || 0,
        source: "catalogCsvImport.pg",
      });
    } catch (manifestError) {
      console.warn("[catalog-import] no se pudo escribir manifest", manifestError?.message || manifestError);
    }
    return summary;
  }

  let existingProducts = [];
  try {
    existingProducts = readJsonFile(productsFilePath).products || [];
  } catch {
    existingProducts = [];
  }

  const preservedProducts = [];
  const existingSupplierIds = new Set();
  const partNumberToId = new Map();
  for (const product of existingProducts) {
    const id = String(product?.id || "");
    if (isCatalogImportedProduct(product)) {
      if (id) existingSupplierIds.add(id);
      continue;
    }
    preservedProducts.push(product);
    const supplierPartNumber =
      normalizeCell(product?.metadata?.supplierPartNumber) || normalizeCell(product?.sku);
    if (supplierPartNumber && id) {
      partNumberToId.set(supplierPartNumber.toLowerCase(), id);
    }
  }

  fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
  const writeStream = fs.createWriteStream(stagingPath, { encoding: "utf8" });
  writeStream.write("{\"products\":[");
  const writeState = { count: 0 };

  for (const preserved of preservedProducts) {
    await writeJsonArrayItem(writeStream, writeState, preserved);
  }

  const parseStream = fs.createReadStream(filePath, { encoding: "utf8" }).pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      info: true,
    }),
  );

  let headersValidated = false;
  let processedRows = 0;
  let estimatedTotalRows = 0;
  try {
    estimatedTotalRows = await estimateCsvRows(filePath);
  } catch {
    estimatedTotalRows = 0;
  }

  const notifyProgress = () => {
    if (typeof onProgress !== "function") return;
    onProgress({
      totalRows: estimatedTotalRows || summary.totalRows,
      processedRows,
      inserted: summary.inserted,
      updated: summary.updated,
      skipped: summary.skipped,
      failed: summary.failed,
    });
  };

  const pushError = (error) => {
    summary.failed += 1;
    summary.errorsCount += 1;
    if (summary.errorsSample.length < maxReportedErrors) {
      summary.errorsSample.push(error);
    }
  };

  let lastProgressAt = 0;
  let lastProgressPercent = -1;

  const maybeNotifyProgress = () => {
    const now = Date.now();
    const totalRowsForProgress = estimatedTotalRows || summary.totalRows;
    const percent = totalRowsForProgress > 0
      ? Math.floor((processedRows / totalRowsForProgress) * 100)
      : 0;
    const percentChanged = percent > lastProgressPercent;
    const enoughTimeElapsed = now - lastProgressAt >= 1000;
    if (percentChanged || enoughTimeElapsed) {
      lastProgressAt = now;
      lastProgressPercent = percent;
      notifyProgress();
    }
  };

  try {
    for await (const data of parseStream) {
      const row = data.record || {};
      const line = data.info?.lines || null;

      if (!headersValidated) {
        const headers = Object.keys(row);
        const requiredCheck = validateRequiredColumns(headers);
        if (!requiredCheck.ok) {
          const error = new Error(
            `Faltan columnas obligatorias: ${requiredCheck.missing.join(", ")}`,
          );
          error.code = "MISSING_REQUIRED_COLUMNS";
          throw error;
        }
        headersValidated = true;
      }

      if (isRowFullyEmpty(row)) {
        summary.skipped += 1;
        continue;
      }

      summary.totalRows += 1;

      try {
        const transformed = toImportedRecord(row, line);
        const pricingResult = computePricingForRow(row, undefined, {
          costColumn: "UnitPrice",
          currencyHeuristics: { assumeEuropeanSupplier: true },
        });
        transformed.record.pricing = pricingResult.pricing;
        pricingSummary.add(row, pricingResult.pricing);

        if (seenPartIds.has(transformed.rowKey)) {
          throw new Error(`PartId duplicado dentro del CSV (${transformed.rowKey})`);
        }
        seenPartIds.add(transformed.rowKey);

        if (seenPartNumbers.has(transformed.supplierPartNumberKey)) {
          throw new Error(
            `PartNumber duplicado dentro del CSV (${transformed.record.supplierPartNumber})`,
          );
        }
        seenPartNumbers.add(transformed.supplierPartNumberKey);

        const existingOwner = partNumberToId.get(transformed.supplierPartNumberKey);
        if (existingOwner && existingOwner !== transformed.rowKey) {
          throw new Error(
            `PartNumber ya existe en otro producto (PartId actual: ${existingOwner})`,
          );
        }

        if (!includeOutOfStock && !isImportableByAvailability(transformed.record)) {
          const skipReason = classifyAvailabilitySkip(transformed.record);
          summary.skipped += 1;
          summary.safety.skippedUnavailable += 1;
          if (skipReason.noStock) summary.safety.skippedNoStock += 1;
          if (skipReason.notOrderable) summary.safety.skippedNotOrderable += 1;
          if (skipReason.statusNotAvailable) summary.safety.skippedStatusNotAvailable += 1;
          if (skipReason.maxOrderZero) summary.safety.skippedMaxOrderZero += 1;
          continue;
        }

        if (isImportableByAvailability(transformed.record)) {
          summary.safety.importedVisibleOrPublishable += 1;
        } else {
          summary.safety.importedHiddenNoStockOrNotOrderable += 1;
        }

        const mapped = mapImportedRecordToStoreProduct(transformed.record, importedAtIso);
        await writeJsonArrayItem(writeStream, writeState, mapped);

        if (existingSupplierIds.has(transformed.rowKey)) summary.updated += 1;
        else summary.inserted += 1;
        partNumberToId.set(transformed.supplierPartNumberKey, transformed.rowKey);
      } catch (error) {
        pushError(createImportError(line, error.message));
      }

      processedRows += 1;
      if (processedRows % progressEveryRows === 0) maybeNotifyProgress();
      if (processedRows % Math.max(500, chunkSize) === 0) {
        const usage = process.memoryUsage();
        console.info("[csv-import-memory]", {
          processedRows,
          rssMB: Number((usage.rss / (1024 * 1024)).toFixed(1)),
          heapUsedMB: Number((usage.heapUsed / (1024 * 1024)).toFixed(1)),
          heapTotalMB: Number((usage.heapTotal / (1024 * 1024)).toFixed(1)),
        });
      }
    }

    await new Promise((resolve, reject) => {
      writeStream.end("]}", "utf8", resolve);
      writeStream.on("error", reject);
    });

    const stats = fs.statSync(stagingPath);
    if (!Number.isFinite(stats.size) || stats.size < 2) {
      throw new Error("Staging inválido: archivo vacío o corrupto");
    }

    fs.renameSync(stagingPath, productsFilePath);
  } catch (error) {
    try {
      writeStream.destroy();
    } catch {}
    throw Object.assign(error, { stagingPath, productsFilePath, processedRows });
  }

  summary.safety.archivedMissing = archiveMissing ? Math.max(existingSupplierIds.size - seenPartIds.size, 0) : 0;
  summary.pricing = pricingSummary.finalize();
  summary.catalog.totalProductsAfterImport = writeState.count;
  summary.catalog.withSupplierPartNumber = writeState.count;
  summary.catalog.potentialXlsxMatches = writeState.count;
  summary.catalog.visibleOrPublishable = Number(summary.safety.importedVisibleOrPublishable || 0);
  summary.catalog.hiddenNoStockOrNotOrderable = Number(
    summary.safety.importedHiddenNoStockOrNotOrderable || 0,
  );
  summary.errors = summary.errorsSample;
  processedRows = summary.totalRows;
  notifyProgress();

  try {
    writeProductsManifest({
      productsFilePath,
      productCount: summary.catalog.totalProductsAfterImport,
      supplierProductCount: summary.catalog.totalProductsAfterImport,
      withSupplierPartNumber: summary.catalog.withSupplierPartNumber,
      publicableCount: summary.catalog.visibleOrPublishable,
      hiddenCount: summary.catalog.hiddenNoStockOrNotOrderable,
      source: "catalogCsvImport.file",
    });
  } catch (manifestError) {
    console.warn("[catalog-import] no se pudo escribir manifest", manifestError?.message || manifestError);
  }

  return {
    ...summary,
    stagingPath,
    productsFilePath,
  };
}

module.exports = {
  REQUIRED_COLUMNS,
  validateRequiredColumns,
  parseEuropeanDecimal,
  toImportedRecord,
  importCatalogCsvFile,
};
