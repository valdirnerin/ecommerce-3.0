const { buildProductAutoContent } = require("./productAutoContent");

function normalizeText(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
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
    if (Object.prototype.hasOwnProperty.call(product, key)) {
      const value = product[key];
      if (value != null && value !== "") return value;
    }
    if (Object.prototype.hasOwnProperty.call(meta, key)) {
      const value = meta[key];
      if (value != null && value !== "") return value;
    }
    if (Object.prototype.hasOwnProperty.call(supplierImport, key)) {
      const value = supplierImport[key];
      if (value != null && value !== "") return value;
    }
  }
  return null;
}

function firstPositiveNumber(values = []) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function evaluateProductSeoQuality(product = {}, autoContent = null) {
  const content = autoContent || buildProductAutoContent(product);
  const detected = content.detected || {};
  const autoText = normalizeText([content.shortDescription, content.longDescription, content.compatibilityNotice].filter(Boolean).join(" "));
  const supplierText = normalizeText([
    pickField(product, ["description", "Description"]),
    pickField(product, ["shortDescription", "short_description"]),
    pickField(product, ["remarks", "Remarks"]),
  ].filter(Boolean).join(" "));
  const price = firstPositiveNumber([pickField(product, ["price_minorista", "precio_minorista", "price", "precio_final", "price_mayorista"])]);
  const slug = normalizeText(pickField(product, ["slug", "publicSlug", "public_slug"]));
  const brand = normalizeText(pickField(product, ["brand", "Brand", "manufacturerName"]));
  const model = normalizeText(pickField(product, ["model", "Model"]));
  const sku = normalizeText(pickField(product, ["sku", "SKU", "part_number", "partNumber", "PartNumber", "Part Number", "supplierPartNumber"]));
  const qualityKnown = Boolean(detected.qualityKnown);
  const hasRichAutomaticDescription = autoText.length >= 250;
  const hasPoorSupplierDescription = supplierText.length < 80;
  const hasIdentity = Boolean((brand && model) || sku || detected.brandModel);
  const hasPrice = price != null;
  const hasSlug = Boolean(slug);
  const availability = normalizeText(detected.availability);
  const availableOnRequest = /pedido/i.test(availability);
  const signals = { qualityKnown, hasPrice, hasSlug, hasIdentity, hasRichAutomaticDescription, hasPoorSupplierDescription, autoDescriptionLength: autoText.length, supplierDescriptionLength: supplierText.length, availability, availableOnRequest };

  if (!qualityKnown && hasPoorSupplierDescription) {
    return { indexable: false, noindex: true, robots: "noindex,follow", reason: "unknown_quality_and_poor_description", signals };
  }
  if (qualityKnown && hasPrice && hasSlug && hasIdentity && hasRichAutomaticDescription) {
    return { indexable: true, noindex: false, robots: "index,follow", reason: "indexable_product_content", signals };
  }
  const missing = [];
  if (!qualityKnown) missing.push("quality");
  if (!hasPrice) missing.push("price");
  if (!hasSlug) missing.push("slug");
  if (!hasIdentity) missing.push("identity");
  if (!hasRichAutomaticDescription) missing.push("rich_description");
  return { indexable: false, noindex: true, robots: "noindex,follow", reason: `missing_${missing.join("_") || "seo_signals"}`, signals };
}

module.exports = { evaluateProductSeoQuality };
