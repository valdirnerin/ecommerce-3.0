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
  return {
    isAvailable: lowered.includes("available"),
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
    externalManufacturerId: imported.externalManufacturerId,
    manufacturerArticleCode: imported.manufacturerArticleCode,
    supplierStatus: imported.supplierStatus,
    importSource: "catalog_csv",
    importVersion: 1,
    importedAt: new Date().toISOString(),
  };

  return {
    id: String(imported.externalId),
    sku: imported.supplierPartNumber,
    name: imported.description,
    description: imported.description,
    brand: imported.manufacturerName,
    price: safePrice,
    price_minorista: safePrice,
    price_mayorista: safePrice,
    stock: imported.stockQuantity,
    min_stock: 0,
    stock_mode: "remote",
    fulfillment_mode: "remote",
    remote_stock: imported.stockQuantity,
    remote_lead_days: safeLeadDays,
    remote_lead_min_days: safeLeadDays,
    remote_lead_max_days: safeLeadDays,
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
    async finalize() {
      const all = Array.from(byId.values());
      fs.writeFileSync(filePath, JSON.stringify({ products: all }, null, 2), "utf8");
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
    async finalize() {},
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
}) {
  const summary = createBaseSummary();
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

      pendingBatch.push(transformed);
      if (pendingBatch.length >= chunkSize) {
        await flushBatch();
      }
    } catch (error) {
      pushError(createImportError(line, error.message));
    }
  }

  await flushBatch();
  await persistence.finalize();
  summary.pricing = pricingSummary.finalize();

  return summary;
}

module.exports = {
  REQUIRED_COLUMNS,
  validateRequiredColumns,
  parseEuropeanDecimal,
  toImportedRecord,
  importCatalogCsvFile,
};
