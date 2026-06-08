const { detectProductType } = require("./productTaxonomy");
const { resolveProductAvailability } = require("./productAvailability");

const GENERIC_SEO_TITLES = new Set([
  "repuesto original service pack | nerin parts",
  "pantallas originales con garantia | nerin",
  "pantallas originales con garantia | nerin parts",
  "repuesto original con garantia tecnica",
]);

const GENERIC_SEO_DESCRIPTIONS = new Set([
  "repuestos originales service pack con garantia en nerin parts.",
  "repuesto original con garantia tecnica",
  "repuestos originales para tecnicos y particulares en argentina.",
]);

function normalizeText(value) {
  if (value == null) return "";
  try {
    return String(value).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function compactText(value) {
  return normalizeText(value);
}

function truncateText(str, limit) {
  if (typeof str !== "string") return "";
  const normalized = str.replace(/\s+/g, " ").trim();
  if (!limit || normalized.length <= limit) return normalized;
  const slice = normalized.slice(0, Math.max(0, limit - 1));
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > 40 ? slice.slice(0, lastSpace) : slice;
  return `${base.replace(/[\s,.!?;:-]+$/, "")}...`;
}

function pickMetadata(product = {}) {
  return product && typeof product.metadata === "object" && product.metadata !== null ? product.metadata : {};
}

function pickSupplierImport(product = {}) {
  const meta = pickMetadata(product);
  return meta && typeof meta.supplierImport === "object" && meta.supplierImport !== null ? meta.supplierImport : {};
}

function pickField(product = {}, keys = []) {
  const meta = pickMetadata(product);
  const supplierImport = pickSupplierImport(product);
  for (const key of keys) {
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(product, key) && product[key] != null && product[key] !== "") return product[key];
    if (Object.prototype.hasOwnProperty.call(meta, key) && meta[key] != null && meta[key] !== "") return meta[key];
    if (Object.prototype.hasOwnProperty.call(supplierImport, key) && supplierImport[key] != null && supplierImport[key] !== "") return supplierImport[key];
  }
  return null;
}

function buildSafeProductLabel(product = {}) {
  return compactText(
    pickField(product, ["name", "Name"]) ||
      pickField(product, ["title", "Title"]) ||
      pickField(product, ["description", "Description"]) ||
      pickField(product, ["sku", "SKU"]) ||
      pickField(product, ["part_number", "partNumber", "PartNumber", "Part Number"]) ||
      pickField(product, ["id"]) ||
      "Repuesto",
  );
}

function buildSafeProductDescription(product = {}, label = "") {
  const sku = normalizeText(pickField(product, ["sku", "SKU", "part_number", "partNumber", "PartNumber", "Part Number"]));
  const skuCopy = sku ? `, SKU ${sku}` : "";
  return compactText(`${label || "Repuesto"} disponible en NERIN Parts. Verificá compatibilidad${skuCopy} y disponibilidad antes de comprar.`);
}

function buildCommercialModel(product = {}, label = "") {
  const candidates = [
    pickField(product, ["model", "modelo", "model_base", "Model"]),
    label.match(/\b(?:Samsung\s+)?Galaxy\s+[A-Z]?\d{2,3}(?:\s*5G)?\b/i)?.[0],
    label.match(/\bSM-[A-Z0-9]+(?:\/[A-Z0-9]+)?\b/i)?.[0],
  ].filter(Boolean);
  return normalizeText(candidates[0] || "");
}

function buildPartCode(product = {}, label = "") {
  const explicit = normalizeText(pickField(product, ["sku", "SKU", "mpn", "part_number", "partNumber", "PartNumber", "Part Number"]));
  const gh82 = label.match(/\bGH82[-A-Z0-9]+\b/i)?.[0] || "";
  return normalizeText(gh82 || explicit);
}

function generateProductSeo(product = {}) {
  const productType = detectProductType(product);
  const label = buildSafeProductLabel(product);
  const brand = normalizeText(pickField(product, ["brand", "catalog_brand", "Brand"]));
  const sku = normalizeText(pickField(product, ["sku", "SKU", "part_number", "partNumber", "PartNumber", "Part Number"]));
  const availability = resolveProductAvailability(product);
  const isStockReal = availability.merchantAvailability === "in_stock" && Number(availability.stockLocal || product.stock || 0) > 0;

  if (isStockReal) {
    const model = buildCommercialModel(product, label);
    const partCode = buildPartCode(product, label);
    const isScreen = productType === "Pantalla / display";
    const brandCopy = /samsung/i.test(brand || label) ? "Samsung" : brand;
    const titleSubject = [
      isScreen ? "Pantalla" : label,
      brandCopy && isScreen ? brandCopy : "",
      model,
      "Original Service Pack",
      partCode,
      "en Stock",
    ].filter(Boolean).join(" ");
    const descriptionSubject = [
      isScreen ? "pantalla original" : label,
      brandCopy,
      model,
      partCode,
      "Service Pack",
    ].filter(Boolean).join(" ");
    return {
      title: truncateText(`${titleSubject} | NERIN Parts`, 160),
      description: truncateText(`Compra ${descriptionSubject} con stock real en CABA, factura A/B, garantia tecnica y envio a todo Argentina.`, 200),
      ogTitle: titleSubject,
      ogDescription: `Stock real en CABA, factura A/B, garantia tecnica y envio a Argentina.`,
      productType,
    };
  }

  const descriptionParts = [
    `${label} disponible en NERIN Parts. Verificá compatibilidad, SKU/código de pieza y disponibilidad antes de comprar.`,
  ];
  if (brand) descriptionParts.push(`Marca: ${brand}.`);
  if (sku) descriptionParts.push(`SKU: ${sku}.`);
  const description = compactText(descriptionParts.join(" "));

  return {
    title: truncateText(`${label} | NERIN Parts`, 160),
    description: truncateText(description, 200),
    ogTitle: label,
    ogDescription: description,
    productType,
  };
}

function buildSeoForProduct(product = {}) {
  const generated = generateProductSeo(product);
  return {
    seoTitle: generated.title,
    seoDescription: generated.description,
    ogTitle: generated.ogTitle || generated.title,
    ogDescription: generated.ogDescription || generated.description,
  };
}

function shouldReplaceSeo(value, genericSet) {
  const text = normalizeText(value).toLowerCase();
  return !text || genericSet.has(text);
}

function applyProductSeo(product = {}) {
  const generated = buildSeoForProduct(product);
  const next = { ...product };
  let updated = false;
  const name = normalizeText(product.name);
  const descriptionText = normalizeText(product.description);

  const currentTitle = normalizeText(product.seoTitle);
  const legacyTitle = normalizeText(product.meta_title);
  const looksBadScreenTitle = /m[oó]dulo\s+pantalla|original\s+service\s+pack/i.test(currentTitle);
  const shouldUseGeneratedTitle =
    !currentTitle ||
    shouldReplaceSeo(currentTitle, GENERIC_SEO_TITLES) ||
    currentTitle.toLowerCase() === name.toLowerCase() ||
    (looksBadScreenTitle && detectProductType(product) !== "Pantalla / display");
  if (shouldUseGeneratedTitle) {
    if (generated.seoTitle && generated.seoTitle !== currentTitle) updated = true;
    next.seoTitle = generated.seoTitle;
  } else if (!product.seoTitle && legacyTitle) {
    next.seoTitle = legacyTitle;
    updated = true;
  }

  const currentDesc = normalizeText(product.seoDescription);
  const legacyDesc = normalizeText(product.meta_description);
  const looksBadScreenDescription = /m[oó]dulo\s+pantalla|service\s+pack|oled|amoled|lcd/i.test(currentDesc);
  const matchesLegacyDesc = currentDesc && legacyDesc && currentDesc.toLowerCase() === legacyDesc.toLowerCase();
  const shouldUseGeneratedDesc =
    !currentDesc ||
    shouldReplaceSeo(currentDesc, GENERIC_SEO_DESCRIPTIONS) ||
    currentDesc.toLowerCase() === descriptionText.toLowerCase() ||
    matchesLegacyDesc ||
    (looksBadScreenDescription && detectProductType(product) !== "Pantalla / display");
  if (shouldUseGeneratedDesc) {
    if (generated.seoDescription && generated.seoDescription !== currentDesc) updated = true;
    next.seoDescription = generated.seoDescription;
  } else if (!product.seoDescription && legacyDesc) {
    next.seoDescription = legacyDesc;
    updated = true;
  }

  return { product: next, generated, updated };
}

function stripBrandSuffix(value) {
  const text = normalizeText(value);
  return text.replace(/\s*\|\s*NERIN Parts$/i, "").trim();
}

module.exports = {
  GENERIC_SEO_DESCRIPTIONS,
  GENERIC_SEO_TITLES,
  applyProductSeo,
  buildSeoForProduct,
  generateProductSeo,
  stripBrandSuffix,
};
