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

function buildProductsPipeline(filePath = productsFilePath) {
  return chain([
    fs.createReadStream(filePath, { encoding: "utf8" }),
    parser(),
    pick({ filter: "products" }),
    StreamArray.streamArray(),
  ]);
}

function buildRootArrayPipeline(filePath = productsFilePath) {
  return chain([
    fs.createReadStream(filePath, { encoding: "utf8" }),
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

  const consume = async (pipeline) => {
    for await (const token of pipeline) {
      const product = token?.value;
      if (typeof onProduct === "function") {
        await onProduct(product, index);
      }
      index += 1;
    }
  };

  const shape = detectJsonShape(filePath);
  if (shape === "array") {
    await consume(buildRootArrayPipeline(filePath));
  } else {
    await consume(buildProductsPipeline(filePath));
  }

  return { count: index };
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
  const STOP_EARLY = "__PRODUCT_BY_ID_STOP__";

  try {
    await streamProducts({
      filePath,
      onProduct: (product) => {
        if (String(product?.id || "") === target) {
          found = product;
          throw new Error(STOP_EARLY);
        }
      },
    });
  } catch (err) {
    if (err?.message !== STOP_EARLY) throw err;
  }

  return found;
}

async function getProductByCode(code, { filePath = productsFilePath } = {}) {
  let found = null;
  const target = String(code || "").trim().toLowerCase();
  if (!target) return null;
  const STOP_EARLY = "__PRODUCT_BY_CODE_STOP__";

  try {
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
          throw new Error(STOP_EARLY);
        }
      },
    });
  } catch (err) {
    if (err?.message !== STOP_EARLY) throw err;
  }

  return found;
}

async function getProductBySlug(slug, { filePath = productsFilePath } = {}) {
  let found = null;
  const target = String(slug || "").trim().toLowerCase();
  if (!target) return null;
  const STOP_EARLY = "__PRODUCT_BY_SLUG_STOP__";

  try {
    await streamProducts({
      filePath,
      onProduct: (product) => {
        const currentSlug = String(product?.slug || "").trim().toLowerCase();
        if (currentSlug && currentSlug === target) {
          found = product;
          throw new Error(STOP_EARLY);
        }
      },
    });
  } catch (err) {
    if (err?.message !== STOP_EARLY) throw err;
  }

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
  filePath = productsFilePath,
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || 24);
  const start = (safePage - 1) * safePageSize;
  const endExclusive = start + safePageSize;
  const stopAfter = endExclusive + 1;

  const items = [];
  let matchedCount = 0;
  const STOP_EARLY = "__PRODUCTS_STREAM_STOP_EARLY__";

  try {
    await streamProducts({
      filePath,
      onProduct: (product) => {
        const accepted = typeof matchItem === "function" ? !!matchItem(product) : true;
        if (!accepted) return;
        const currentMatchIndex = matchedCount;
        matchedCount += 1;
        if (currentMatchIndex >= start && currentMatchIndex < endExclusive) {
          const mapped = typeof mapItem === "function" ? mapItem(product) : product;
          items.push(mapped);
        }
        if (matchedCount >= stopAfter) {
          throw new Error(STOP_EARLY);
        }
      },
    });
  } catch (err) {
    if (err?.message !== STOP_EARLY) {
      throw err;
    }
  }

  return {
    items,
    page: safePage,
    pageSize: safePageSize,
    matchedCountScanned: matchedCount,
    hasNextPage: matchedCount > endExclusive,
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
