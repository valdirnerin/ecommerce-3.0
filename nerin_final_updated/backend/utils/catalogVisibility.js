const { getPublicPriceValue, resolveProductAvailability } = require("./productAvailability");

function normalizeIdentity(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function identityKeys(product = {}) {
  const keys = [];
  const add = (prefix, value) => {
    const normalized = normalizeIdentity(value);
    if (normalized) keys.push(`${prefix}:${normalized}`);
  };
  add("mpn", product.mpn || product.part_number || product.partNumber);
  add("sku", product.sku || product.code);
  add("slug", product.publicSlug || product.public_slug || product.slug);
  add("title", product.normalized_title || product.name || product.title);
  return keys;
}

function deduplicateCatalogProducts(products = []) {
  const seen = new Set();
  const result = [];
  for (const product of products) {
    if (!product || typeof product !== "object") continue;
    const keys = identityKeys(product);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    result.push(product);
  }
  return result;
}

function availabilityRank(product = {}) {
  const availability = resolveProductAvailability(product).merchantAvailability;
  if (availability === "in_stock") return 0;
  if (availability === "preorder" || availability === "backorder") return 1;
  return 2;
}

function completenessRank(product = {}) {
  const price = getPublicPriceValue(product) > 0 ? 1 : 0;
  const image = product.image || product.image_url || (Array.isArray(product.images) ? product.images.find(Boolean) : "");
  const slug = product.publicSlug || product.public_slug || product.slug;
  return price + (image ? 1 : 0) + (slug ? 1 : 0);
}

function sortCatalogProducts(products = []) {
  return [...products].sort((a, b) => {
    const availabilityDiff = availabilityRank(a) - availabilityRank(b);
    if (availabilityDiff) return availabilityDiff;
    const completenessDiff = completenessRank(b) - completenessRank(a);
    if (completenessDiff) return completenessDiff;
    const stockDiff = Number(b.stock || 0) - Number(a.stock || 0);
    if (stockDiff) return stockDiff;
    return String(a.name || a.title || "").localeCompare(String(b.name || b.title || ""), "es", { sensitivity: "base" });
  });
}

module.exports = {
  availabilityRank,
  deduplicateCatalogProducts,
  identityKeys,
  normalizeIdentity,
  sortCatalogProducts,
};
