const fs = require("fs");
const path = require("path");
const Decimal = require("decimal.js");
const { parse } = require("csv-parse");
const { DATA_DIR } = require("../utils/dataDir");
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

const ALL_COLUMNS = [
  "PartId",
  "ManufacturerName",
  "ManufacturerId",
  "ManufacturerArticleCode",
  "MainCategory",
  "SubCategory",
  "PartNumber",
  "Description",
  "Status",
  "CanBeOrdered",
  "UnitPrice",
  "StockQuantity",
  "MaximumQuantityInOrder",
  "Quality",
  "Remarks",
  "ImageUrl",
  "ImageUrl2",
  "ImageUrl3",
  "ImageUrl4",
  "ImageUrl5",
  "EanNumber",
  "CountryOfOrigin",
  "ProductGroup",
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
    pricingWarnings: [],
    pricingTrace: null,
    rawRow: ALL_COLUMNS.reduce((acc, key) => {
      acc[key] = row[key] == null ? null : String(row[key]);
      return acc;
    }, {}),
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

function mapImportedRecordToStoreProduct(imported) {
  const finalPrice = Number(imported?.pricing?.precio_final_ars);
  const safePrice =
    Number.isFinite(finalPrice) && finalPrice > 0 ? finalPrice : imported.unitPrice;
  const leadDays = Number(imported?.pricing?.tiempo_demora_dias || 20);
  const safeLeadDays = Number.isFinite(leadDays) && leadDays > 0 ? Math.floor(leadDays) : 20;
  const metadata = {
    supplierImport: imported,
    supplierPartNumber: imported.supplierPartNumber,
    csvStockQuantity: imported.stockQuantity,
    externalManufacturerId: imported.externalManufacturerId,
    manufacturerArticleCode: imported.manufacturerArticleCode,
    supplierStatus: imported.supplierStatus,
    importSource: "catalog_csv",
    importVersion: 1,
    importedAt: new Date().toISOString(),
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

function createBaseSummary() {
  return {
    totalRows: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
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

function isImportableByAvailability(record) {
  const stock = Number(record?.stockQuantity || 0);
  const maxOrder = Number(record?.maximumQuantityInOrder || 0);
  return Boolean(record?.canBeOrdered) && Boolean(record?.isAvailable) && stock > 0 && maxOrder > 0;
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
      normalizeCell(product?.sku);
    if (supplierPartNumber) {
      partNumberToId.set(supplierPartNumber.toLowerCase(), String(product.id));
    }
  }

  return {
    partNumberToId,
    async upsertBatch(batch) {
      let inserted = 0;
      let updated = 0;
      for (const item of batch) {
        const id = String(item.record.externalId);
        const normalized = mapImportedRecordToStoreProduct(item.record);
        if (byId.has(id)) {
          const previous = byId.get(id);
          byId.set(id, {
            ...previous,
            ...normalized,
          });
          updated += 1;
        } else {
          byId.set(id, normalized);
          inserted += 1;
        }
        partNumberToId.set(item.supplierPartNumberKey, id);
      }
      return { inserted, updated };
    },
    async archiveMissing(importedExternalIds = new Set()) {
      let archived = 0;
      for (const [id, product] of byId.entries()) {
        const importSource = normalizeCell(product?.metadata?.importSource);
        if (importSource !== "catalog_csv") continue;
        if (importedExternalIds.has(String(id))) continue;
        byId.set(id, {
          ...product,
          stock: 0,
          remote_stock: 0,
          visibility: "private",
          metadata: {
            ...(product?.metadata || {}),
            catalogCsvArchivedAt: new Date().toISOString(),
            catalogCsvArchivedBecauseMissing: true,
          },
        });
        archived += 1;
      }
      return archived;
    },
    async finalize() {
      const all = Array.from(byId.values());
      safeWriteJsonWithBackup(filePath, { products: all });
      return {
        totalProductsAfterImport: all.length,
        withSupplierPartNumber: all.filter((product) => {
          const supplierPartNumber =
            normalizeCell(product?.metadata?.supplierImport?.supplierPartNumber) ||
            normalizeCell(product?.metadata?.supplierPartNumber) ||
            normalizeCell(product?.sku);
          return Boolean(supplierPartNumber);
        }).length,
      };
    },
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
    if (candidate) {
      partNumberToId.set(candidate.toLowerCase(), String(row.id));
    }
  }

  return {
    partNumberToId,
    async upsertBatch(batch) {
      if (!batch.length) return { inserted: 0, updated: 0 };
      const values = [];
      const placeholders = [];
      let i = 1;
      for (const item of batch) {
        const mapped = mapImportedRecordToStoreProduct(item.record);
        placeholders.push(`($${i},$${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5})`);
        values.push(
          mapped.id,
          mapped.name,
          mapped.price,
          mapped.stock,
          mapped.image,
          mapped.metadata,
        );
        i += 6;
      }

      const sql = `
        INSERT INTO products (id, name, price, stock, image_url, metadata)
        VALUES ${placeholders.join(",")}
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          stock = EXCLUDED.stock,
          image_url = EXCLUDED.image_url,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING (xmax = 0) AS inserted
      `;

      const result = await pool.query(sql, values);
      const inserted = result.rows.filter((row) => row.inserted).length;
      const updated = result.rowCount - inserted;

      for (const item of batch) {
        partNumberToId.set(item.supplierPartNumberKey, String(item.record.externalId));
      }

      return { inserted, updated };
    },
    async archiveMissing(importedExternalIds = new Set()) {
      const ids = Array.from(importedExternalIds || []).map((id) => String(id));
      const result = await pool.query(
        `UPDATE products
         SET stock = 0,
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
               'catalogCsvArchivedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'catalogCsvArchivedBecauseMissing', true
             ),
             updated_at = now()
         WHERE metadata->>'importSource' = 'catalog_csv'
           AND (CASE WHEN cardinality($1::text[]) = 0 THEN true ELSE NOT (id::text = ANY($1::text[])) END)`,
        [ids],
      );
      return result.rowCount || 0;
    },
    async finalize() {
      const [{ rows: totalsRows }, { rows: supplierRows }] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total FROM products`),
        pool.query(
          `SELECT COUNT(*)::int AS total
             FROM products
            WHERE COALESCE(
              NULLIF(metadata->'supplierImport'->>'supplierPartNumber', ''),
              NULLIF(metadata->>'supplierPartNumber', '')
            ) IS NOT NULL`,
        ),
      ]);
      return {
        totalProductsAfterImport: Number(totalsRows?.[0]?.total || 0),
        withSupplierPartNumber: Number(supplierRows?.[0]?.total || 0),
      };
    },
  };
}

function createImportError(line, message, context = null) {
  return {
    line,
    message,
    ...(context ? { context } : {}),
  };
}

async function importCatalogCsvFile({
  filePath,
  pool = null,
  chunkSize = 400,
  maxReportedErrors = 500,
  includeOutOfStock = false,
  archiveMissing = false,
  onProgress = null,
  progressEveryRows = 250,
}) {
  const summary = createBaseSummary();
  summary.options.includeOutOfStock = Boolean(includeOutOfStock);
  summary.options.archiveMissing = Boolean(archiveMissing);
  const pricingSummary = createPricingSummaryAccumulator();
  const seenPartIds = new Set();
  const seenPartNumbers = new Set();

  const persistence = pool
    ? await buildPgPersistenceLayer(pool)
    : await buildJsonPersistenceLayer();

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
  let pendingBatch = [];
  let processedRows = 0;
  let estimatedTotalRows = 0;
  try {
    const rawCsv = fs.readFileSync(filePath, "utf8");
    estimatedTotalRows = Math.max(0, rawCsv.split(/\r?\n/).filter(Boolean).length - 1);
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
    if (summary.errors.length < maxReportedErrors) {
      summary.errors.push(error);
    }
  };

  const flushBatch = async () => {
    if (!pendingBatch.length) return;
    try {
      const { inserted, updated } = await persistence.upsertBatch(pendingBatch);
      summary.inserted += inserted;
      summary.updated += updated;
    } catch (error) {
      for (const item of pendingBatch) {
        pushError(
          createImportError(
            item.line,
            `Error al persistir producto externalId=${item.record.externalId}: ${error.message}`,
          ),
        );
      }
    } finally {
      pendingBatch = [];
    }
  };

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
      transformed.record.pricingWarnings = pricingResult.warnings;
      transformed.record.pricingTrace = pricingResult.mapping;
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

      const existingOwner = persistence.partNumberToId.get(transformed.supplierPartNumberKey);
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

      pendingBatch.push(transformed);
      if (pendingBatch.length >= chunkSize) {
        await flushBatch();
      }
    } catch (error) {
      pushError(createImportError(line, error.message));
    }
    processedRows += 1;
    if (processedRows % progressEveryRows === 0) {
      notifyProgress();
    }
  }

  await flushBatch();
  if (archiveMissing && typeof persistence.archiveMissing === "function") {
    summary.safety.archivedMissing = await persistence.archiveMissing(seenPartIds);
  }
  const persistenceStats = await persistence.finalize();
  summary.pricing = pricingSummary.finalize();
  summary.catalog.totalProductsAfterImport = Number(
    persistenceStats?.totalProductsAfterImport || 0,
  );
  summary.catalog.withSupplierPartNumber = Number(
    persistenceStats?.withSupplierPartNumber || 0,
  );
  summary.catalog.potentialXlsxMatches = summary.catalog.withSupplierPartNumber;
  summary.catalog.visibleOrPublishable = Number(summary.safety.importedVisibleOrPublishable || 0);
  summary.catalog.hiddenNoStockOrNotOrderable = Number(
    summary.safety.importedHiddenNoStockOrNotOrderable || 0,
  );
  processedRows = summary.totalRows;
  notifyProgress();

  return summary;
}

module.exports = {
  REQUIRED_COLUMNS,
  validateRequiredColumns,
  parseEuropeanDecimal,
  toImportedRecord,
  importCatalogCsvFile,
};
