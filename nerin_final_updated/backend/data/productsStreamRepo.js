const fs = require("fs");
const path = require("path");
const { chain } = require("stream-chain");
const { parser } = require("stream-json");
const { pick } = require("stream-json/filters/Pick");
const StreamArray = require("stream-json/streamers/StreamArray");
const { DATA_DIR } = require("../utils/dataDir");

const productsFilePath = path.join(DATA_DIR, "products.json");
const productsManifestPath = path.join(DATA_DIR, "products.manifest.json");
const LARGE_CATALOG_BYTES = 20 * 1024 * 1024;

function safeReadManifest() {
  try {
    if (!fs.existsSync(productsManifestPath)) return null;
    const raw = fs.readFileSync(productsManifestPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function buildProductsPipeline(filePath = productsFilePath, sourceStream = null) {
  const source = sourceStream || fs.createReadStream(filePath, { encoding: "utf8" });
  return chain([
    source,
    parser(),
    pick({ filter: "products" }),
    StreamArray.streamArray(),
  ]);
}

function buildRootArrayPipeline(filePath = productsFilePath, sourceStream = null) {
  const source = sourceStream || fs.createReadStream(filePath, { encoding: "utf8" });
  return chain([
    source,
    parser(),
    StreamArray.streamArray(),
  ]);
}


function detectJsonShape(filePath = productsFilePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(128);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.slice(0, bytesRead).toString("utf8").trimStart();
    if (text.startsWith("[")) return "array";
    return "object";
  } finally {
    fs.closeSync(fd);
  }
}

async function streamProducts({ onProduct, filePath = productsFilePath } = {}) {
  if (!fs.existsSync(filePath)) {
    const err = new Error(`products.json no existe en ${filePath}`);
    err.code = "ENOENT";
    throw err;
  }

  let index = 0;

  const shape = detectJsonShape(filePath);
  const sourceStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const pipeline =
    shape === "array"
      ? buildRootArrayPipeline(filePath, sourceStream)
      : buildProductsPipeline(filePath, sourceStream);

  let stoppedEarly = false;
  const destroyStream = () => {
    if (typeof pipeline?.destroy === "function" && !pipeline.destroyed) {
      pipeline.destroy();
    }
    if (typeof sourceStream?.destroy === "function" && !sourceStream.destroyed) {
      sourceStream.destroy();
    }
  };

  try {
    for await (const token of pipeline) {
      const product = token?.value;
      let shouldContinue = true;
      if (typeof onProduct === "function") {
        shouldContinue = await onProduct(product, index);
      }
      index += 1;
      if (shouldContinue === false) {
        stoppedEarly = true;
        destroyStream();
        break;
      }
    }
  } finally {
    if (stoppedEarly) {
      destroyStream();
    }
  }

  return { count: index, stoppedEarly };
}

async function countProductsStreaming({ filePath = productsFilePath } = {}) {
  let count = 0;
  await streamProducts({
    filePath,
    onProduct: () => {
      count += 1;
    },
  });
  return count;
}

async function getProductById(id, { filePath = productsFilePath } = {}) {
  let found = null;
  const target = String(id || "").trim();
  if (!target) return null;
  await streamProducts({
    filePath,
    onProduct: (product) => {
      if (String(product?.id || "") === target) {
        found = product;
        return false;
      }
      return true;
    },
  });

  return found;
}

async function getProductByCode(code, { filePath = productsFilePath } = {}) {
  let found = null;
  const target = String(code || "").trim().toLowerCase();
  if (!target) return null;
  await streamProducts({
    filePath,
    onProduct: (product) => {
      const candidates = [
        product?.code,
        product?.sku,
        product?.supplierPartNumber,
        product?.metadata?.supplierPartNumber,
        product?.metadata?.supplierImport?.supplierPartNumber,
      ]
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean);
      if (candidates.includes(target)) {
        found = product;
        return false;
      }
      return true;
    },
  });

  return found;
}

async function getProductBySlug(slug, { filePath = productsFilePath } = {}) {
  let found = null;
  const target = String(slug || "").trim().toLowerCase();
  if (!target) return null;
  await streamProducts({
    filePath,
    onProduct: (product) => {
      const currentSlug = String(product?.slug || "").trim().toLowerCase();
      if (currentSlug && currentSlug === target) {
        found = product;
        return false;
      }
      return true;
    },
  });

  return found;
}

async function getProductsPage({
  page = 1,
  pageSize = 24,
  filters = null,
  transformItem = null,
  filePath = productsFilePath,
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || 24);
  const start = (safePage - 1) * safePageSize;
  const end = start + safePageSize;

  let totalItems = 0;
  const items = [];

  await streamProducts({
    filePath,
    onProduct: (product) => {
      const accepted = typeof filters === "function" ? !!filters(product) : true;
      if (!accepted) return;

      const currentIndex = totalItems;
      totalItems += 1;

      if (currentIndex < start || currentIndex >= end) return;
      const finalItem = typeof transformItem === "function" ? transformItem(product) : product;
      items.push(finalItem);
    },
  });

  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const normalizedPage = Math.min(safePage, totalPages);
  return {
    items,
    page: normalizedPage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
    hasNextPage: normalizedPage < totalPages,
    hasPrevPage: normalizedPage > 1,
  };
}

async function getProductsSortedPage({
  page = 1,
  pageSize = 24,
  matchItem = null,
  sortItems = null,
  mapItem = null,
  filePath = productsFilePath,
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || 24);
  const projected = [];

  await streamProducts({
    filePath,
    onProduct: (product, index) => {
      const accepted = typeof matchItem === "function" ? !!matchItem(product) : true;
      if (!accepted) return;
      const mapped = typeof mapItem === "function" ? mapItem(product) : product;
      projected.push({
        index,
        item: mapped,
      });
    },
  });

  if (typeof sortItems === "function") {
    projected.sort((a, b) => sortItems(a.item, b.item));
  } else {
    projected.sort((a, b) => a.index - b.index);
  }

  const totalItems = projected.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const normalizedPage = Math.min(safePage, totalPages);
  const start = (normalizedPage - 1) * safePageSize;
  const end = start + safePageSize;
  const items = projected.slice(start, end).map((entry) => entry.item);

  return {
    items,
    page: normalizedPage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
    hasNextPage: normalizedPage < totalPages,
    hasPrevPage: normalizedPage > 1,
  };
}

async function getProductsEmergencyPage({
  page = 1,
  pageSize = 24,
  matchItem = null,
  mapItem = null,
  maxScanItems = null,
  shouldStop = null,
  filePath = productsFilePath,
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || 24);
  const start = (safePage - 1) * safePageSize;
  const endExclusive = start + safePageSize;

  const items = [];
  let scannedCount = 0;
  let matchedCount = 0;
  let cancelled = false;
  let stoppedEarly = false;

  const { stoppedEarly: streamStoppedEarly } = await streamProducts({
    filePath,
    onProduct: (product) => {
      if (typeof shouldStop === "function" && shouldStop()) {
        cancelled = true;
        return false;
      }

      scannedCount += 1;
      const hasScanLimit =
        maxScanItems !== null &&
        maxScanItems !== undefined &&
        maxScanItems !== "" &&
        Number.isFinite(Number(maxScanItems)) &&
        Number(maxScanItems) > 0;
      if (hasScanLimit && scannedCount >= Number(maxScanItems)) {
        stoppedEarly = true;
        return false;
      }

      const accepted = typeof matchItem === "function" ? !!matchItem(product) : true;
      if (!accepted) return true;
      const currentMatchIndex = matchedCount;
      matchedCount += 1;
      if (currentMatchIndex >= start && currentMatchIndex < endExclusive) {
        const mapped = typeof mapItem === "function" ? mapItem(product) : product;
        items.push(mapped);
      }
      if (matchedCount > endExclusive) {
        stoppedEarly = true;
        return false;
      }
      return true;
    },
  });

  const hasNextPage = cancelled ? false : matchedCount > endExclusive || stoppedEarly || streamStoppedEarly;

  return {
    items,
    page: safePage,
    pageSize: safePageSize,
    scannedCount,
    matchedCount,
    stoppedEarly: Boolean(stoppedEarly || streamStoppedEarly),
    cancelled,
    hasNextPage,
    hasPrevPage: safePage > 1,
  };
}

function getBackupCandidates({ dataDir = DATA_DIR } = {}) {
  const patterns = [
    /^products\.backup-.*\.json$/i,
    /^products\.importing\..*\.json$/i,
    /^products\.json\.bak$/i,
  ];

  try {
    const entries = fs.readdirSync(dataDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => patterns.some((pattern) => pattern.test(name)))
      .map((name) => {
        const fullPath = path.join(dataDir, name);
        const stats = fs.statSync(fullPath);
        return {
          file: name,
          path: fullPath,
          sizeBytes: Number(stats.size || 0),
          modifiedAt: stats.mtime ? stats.mtime.toISOString() : null,
        };
      })
      .sort((a, b) => new Date(b.modifiedAt || 0).getTime() - new Date(a.modifiedAt || 0).getTime());
  } catch {
    return [];
  }
}

async function inspectProductsStorageSafe({ filePath = productsFilePath, dataDir = DATA_DIR } = {}) {
  const exists = fs.existsSync(filePath);
  const sizeBytes = exists ? Number(fs.statSync(filePath).size || 0) : 0;
  const manifest = safeReadManifest();

  const report = {
    productsFilePath: filePath,
    exists,
    sizeBytes,
    productCount: manifest?.productCount ?? "unknown",
    manifest,
    canStreamRead: false,
    jsonStartsValid: false,
    largeCatalog: sizeBytes > LARGE_CATALOG_BYTES,
    storageValid: exists,
    error: null,
    backupCandidates: [],
  };

  if (!exists) return report;

  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const probeBuffer = Buffer.alloc(256);
      const bytesRead = fs.readSync(fd, probeBuffer, 0, probeBuffer.length, 0);
      const preview = probeBuffer.slice(0, bytesRead).toString("utf8").trimStart();
      report.jsonStartsValid = preview.startsWith("{") || preview.startsWith("[");
      report.canStreamRead = report.jsonStartsValid;
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    report.error = err?.message || String(err);
    report.backupCandidates = getBackupCandidates({ dataDir });
  }

  return report;
}

module.exports = {
  productsFilePath,
  productsManifestPath,
  safeReadManifest,
  streamProducts,
  getProductsPage,
  getProductsSortedPage,
  getProductsEmergencyPage,
  getProductById,
  getProductBySlug,
  getProductByCode,
  LARGE_CATALOG_BYTES,
  countProductsStreaming,
  inspectProductsStorageSafe,
  getBackupCandidates,
};
