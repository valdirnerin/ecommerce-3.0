const fs = require("fs");
const path = require("path");

const FORBIDDEN_PRODUCTS_JSON_PARSE_MAX_BYTES = 5 * 1024 * 1024;

function isProductsJson(filePath = "") {
  return path.basename(String(filePath || "")).toLowerCase() === "products.json";
}

function readJsonFile(filePath, { encoding = "utf8" } = {}) {
  const resolvedPath = String(filePath || "");
  const stats = fs.existsSync(resolvedPath) ? fs.statSync(resolvedPath) : null;
  const sizeBytes = Number(stats?.size || 0);

  if (isProductsJson(resolvedPath) && sizeBytes > FORBIDDEN_PRODUCTS_JSON_PARSE_MAX_BYTES) {
    const stack = new Error().stack;
    console.error("[FORBIDDEN_PRODUCTS_JSON_PARSE]", {
      filePath: resolvedPath,
      sizeBytes,
      stack,
    });
    const err = new Error(
      "Forbidden full parse of products.json. Use productsStreamRepo instead.",
    );
    err.code = "FORBIDDEN_PRODUCTS_JSON_PARSE";
    err.filePath = resolvedPath;
    err.sizeBytes = sizeBytes;
    throw err;
  }

  const raw = fs.readFileSync(resolvedPath, encoding);
  return JSON.parse(raw);
}

module.exports = {
  FORBIDDEN_PRODUCTS_JSON_PARSE_MAX_BYTES,
  readJsonFile,
};
