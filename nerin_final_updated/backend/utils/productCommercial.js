const { buildProductAutoContent } = require("./productAutoContent");
const { detectProductType } = require("./productTaxonomy");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function productText(product = {}) {
  const metadata = product.metadata && typeof product.metadata === "object" ? product.metadata : {};
  const supplier = metadata.supplierImport && typeof metadata.supplierImport === "object"
    ? metadata.supplierImport
    : {};
  return [
    product.name,
    product.title,
    product.description,
    product.quality,
    product.brand,
    product.model,
    product.category,
    metadata.quality,
    supplier.quality,
    supplier.description,
  ].map(cleanText).filter(Boolean).join(" ");
}

function pick(product = {}, keys = []) {
  const metadata = product.metadata && typeof product.metadata === "object" ? product.metadata : {};
  const supplier = metadata.supplierImport && typeof metadata.supplierImport === "object"
    ? metadata.supplierImport
    : {};
  for (const key of keys) {
    const value = product[key] ?? metadata[key] ?? supplier[key];
    if (cleanText(value)) return cleanText(value);
  }
  return "";
}

function isCompatibleProduct(product = {}) {
  return /\b(compatible|aftermarket|generic|generico|gen[eé]rico|soft\s+oled|hard\s+oled|in[\s-]?cell)\b/i.test(productText(product));
}

function isOriginalProduct(product = {}) {
  const text = productText(product);
  return !isCompatibleProduct(product) && /\b(original|genuine|service\s*pack)\b/i.test(text);
}

function resolveCommercialMpn(product = {}) {
  const explicit = pick(product, ["mpn", "part_number", "partNumber", "supplierPartNumber"]);
  if (explicit) return explicit;
  const textMatch = productText(product).match(/\bGH82-\d{4,6}[A-Z]?\b/i);
  if (textMatch) return textMatch[0].toUpperCase();
  return pick(product, ["sku", "code"]);
}

function resolveCommercialBrand(product = {}) {
  if (isCompatibleProduct(product)) {
    return pick(product, ["manufacturer_brand", "actual_brand", "maker_brand"]) || "Compatible";
  }
  const explicit = pick(product, ["brand", "manufacturer", "manufacturerName"]);
  if (explicit) return explicit.replace(/^for\s+/i, "").trim();
  if (/\b(samsung|galaxy|GH82-)\b/i.test(productText(product)) && isOriginalProduct(product)) return "Samsung";
  return "Genérico";
}

function resolveCompatibleWith(product = {}) {
  if (!isCompatibleProduct(product)) return "";
  const brand = pick(product, ["compatible_brand", "device_brand", "brand"]);
  const model = pick(product, ["compatible_model", "model", "modelo"]);
  return [brand, model].filter(Boolean).join(" ").trim();
}

function detectCommercialColor(product = {}) {
  const explicit = pick(product, ["color", "colour"]);
  const text = `${explicit} ${productText(product)}`;
  const colors = [
    ["Negra", /\b(black|negro|negra)\b/i],
    ["Blanca", /\b(white|blanco|blanca)\b/i],
    ["Gris", /\b(gray|grey|gris)\b/i],
    ["Azul", /\b(blue|azul)\b/i],
    ["Verde", /\b(green|verde)\b/i],
    ["Roja", /\b(red|rojo|roja)\b/i],
    ["Violeta", /\b(purple|violeta|morado|morada)\b/i],
    ["Dorada", /\b(gold|dorado|dorada)\b/i],
    ["Plata", /\b(silver|plata)\b/i],
  ];
  const found = colors.find(([, pattern]) => pattern.test(text));
  return found ? found[0] : explicit;
}

function buildCommercialProductTitle(product = {}) {
  const fallback = pick(product, ["name", "title", "description", "sku", "id"]) || "Repuesto";
  if (detectProductType(product) !== "Pantalla / display") return fallback;

  const auto = buildProductAutoContent(product);
  let title = cleanText(auto.h1) || fallback;
  if (isCompatibleProduct(product) && !/\bcompatible\b/i.test(title)) {
    title = title.replace(/^Pantalla\b/i, "Pantalla compatible");
  } else if (isOriginalProduct(product) && !/\boriginal\b/i.test(title)) {
    title = title.replace(/^Pantalla\b/i, "Pantalla original");
  }

  const color = detectCommercialColor(product);
  if (color && !new RegExp(`\\b${color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(title)) {
    title = `${title} ${color}`;
  }

  const mpn = resolveCommercialMpn(product);
  const commercialBrand = resolveCommercialBrand(product);
  if (commercialBrand === "Samsung" && isOriginalProduct(product) && /^GH82-/i.test(mpn) && !title.includes(mpn)) {
    title = `${title} Service Pack ${mpn}`;
  }
  return cleanText(title);
}

function hasRealBrandAndMpn(product = {}) {
  const brand = resolveCommercialBrand(product);
  const mpn = resolveCommercialMpn(product);
  return Boolean(mpn && brand && !/^(compatible|gen[eé]rico)$/i.test(brand));
}

module.exports = {
  buildCommercialProductTitle,
  hasRealBrandAndMpn,
  isCompatibleProduct,
  isOriginalProduct,
  resolveCommercialBrand,
  resolveCommercialMpn,
  resolveCompatibleWith,
};
