const GENERIC_SEO_TITLES = new Set([
  "repuesto original service pack | nerin parts",
  "pantallas originales con garantía | nerin",
  "pantallas originales con garantía | nerin parts",
  "repuesto original con garantía técnica",
]);

const GENERIC_SEO_DESCRIPTIONS = new Set([
  "repuestos originales service pack con garantía en nerin parts.",
  "repuesto original con garantía técnica",
  "repuestos originales para técnicos y particulares en argentina.",
]);

function normalizeText(value) {
  if (value == null) return "";
  try {
    const text = String(value).replace(/\s+/g, " ").trim();
    return text;
  } catch (err) {
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
  return `${base.replace(/[\s,.!?;:-]+$/, "")}…`;
}

function parseNumber(value) {
  if (value == null) return null;
  const num = Number(String(value).replace(/,/g, "."));
  return Number.isFinite(num) ? num : null;
}

function extractFromText(values = [], pattern) {
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const match = raw.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

function inferDisplayTechnology(product) {
  const meta = product && typeof product.metadata === "object" ? product.metadata : {};
  const candidates = [
    product?.panel_type,
    product?.display_type,
    product?.technology,
    product?.screen_type,
    meta.panel_type,
    meta.display_type,
    meta.technology,
    meta.screen_type,
    product?.meta_description,
    product?.description,
  ];
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const text = value.toLowerCase();
    if (text.includes("super amoled")) return "Super AMOLED";
    if (text.includes("amoled")) return "AMOLED";
    if (text.includes("oled")) return "OLED";
    if (text.includes("lcd")) return "LCD";
    if (text.includes("tft")) return "TFT";
  }
  return null;
}

function inferScreenSize(product) {
  const meta = product && typeof product.metadata === "object" ? product.metadata : {};
  const candidates = [
    product?.screen_size,
    product?.display_size,
    product?.size_inches,
    product?.inches,
    meta?.screen_size,
    meta?.display_size,
    meta?.size_inches,
    meta?.inches,
  ].map(normalizeText);
  const fromFields = candidates.find((v) => v);
  if (fromFields) {
    const numeric = parseNumber(fromFields);
    if (numeric) return `${numeric.toString().replace(".", ",")}"`;
    if (/\d/.test(fromFields)) return fromFields;
  }
  const textMatch = extractFromText(
    [product?.description, product?.short_description, product?.meta_description],
    /(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:\"|pulg|pulgadas)/i,
  );
  if (textMatch) return `${textMatch.replace(".", ",")}"`;
  return null;
}

function inferResolution(product) {
  const meta = product && typeof product.metadata === "object" ? product.metadata : {};
  const candidates = [product?.resolution, meta?.resolution, product?.description, product?.meta_description];
  const match = extractFromText(
    candidates,
    /(\b(?:fhd\+?|hd\+?|qhd\+?|720p|1080p|1440p|2k|4k)[\w+]*)/i,
  );
  if (match) return match.toUpperCase();
  return null;
}

function inferRefreshRate(product) {
  const meta = product && typeof product.metadata === "object" ? product.metadata : {};
  const candidates = [product?.refresh_rate, meta?.refresh_rate, product?.description, product?.meta_description];
  const match = extractFromText(candidates, /(\d{2,3})\s*hz/i);
  if (match) return `${match} Hz`;
  return null;
}

function buildModelLabel(product) {
  const brand = normalizeText(product?.brand || product?.catalog_brand);
  const model = normalizeText(product?.model || product?.catalog_model);
  const name = normalizeText(product?.name);
  const label = [brand, model].filter(Boolean).join(" ");
  if (label) return label;
  return name || brand || model || "";
}

function buildSeoForProduct(product = {}) {
  const brand = normalizeText(product.brand || product.catalog_brand);
  const modelLabel = buildModelLabel(product);
  const modelOnly = normalizeText(product.model || product.catalog_model);
  const sku = normalizeText(product.sku);
  const labelForTitle =
    modelLabel ||
    [brand, modelOnly].filter(Boolean).join(" ").trim() ||
    brand ||
    modelOnly;
  const brandInLabel = labelForTitle && brand && labelForTitle.toLowerCase().includes(brand.toLowerCase());
  const includeBrand = brand && !brandInLabel;
  const titleModel = labelForTitle || sku || brand;
  const skuCopy = sku ? ` ${sku}` : "";
  const title = compactText(
    `Módulo Pantalla${includeBrand ? ` ${brand}` : ""}${titleModel ? ` ${titleModel}` : ""} Original Service Pack${skuCopy} | NERIN Parts`,
  );

  const screenTech = inferDisplayTechnology(product);
  const screenSize = inferScreenSize(product);
  const resolution = inferResolution(product);
  const hz = inferRefreshRate(product);
  const specs = [
    [screenTech, screenSize].filter(Boolean).join(" "),
    [resolution, hz].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const details = specs
    ? `${specs} con marco, listo para instalar.`
    : "Con marco, listo para instalar.";
  const description = compactText(
    `Módulo pantalla${includeBrand ? ` ${brand}` : ""}${
      labelForTitle ? ` ${labelForTitle}` : ""
    } original Service Pack${skuCopy}. ${details || ""} Envíos a todo Argentina, factura A/B y garantía técnica NERIN.`,
  );
  return {
    seoTitle: truncateText(title || "Módulo Pantalla original Service Pack | NERIN Parts", 160),
    seoDescription: truncateText(description, 200),
  };
}

function shouldReplaceSeo(value, genericSet) {
  const text = normalizeText(value).toLowerCase();
  return !text || genericSet.has(text);
}

function isLegacyTitleReplaceable(product = {}) {
  const legacy = normalizeText(product.meta_title);
  const name = normalizeText(product.name);
  if (!legacy) return false;
  if (shouldReplaceSeo(legacy, GENERIC_SEO_TITLES)) return true;
  return legacy.toLowerCase() === name.toLowerCase();
}

function isLegacyDescriptionReplaceable(product = {}) {
  const legacy = normalizeText(product.meta_description);
  const desc = normalizeText(product.description);
  if (!legacy) return false;
  if (shouldReplaceSeo(legacy, GENERIC_SEO_DESCRIPTIONS)) return true;
  return legacy.toLowerCase() === desc.toLowerCase();
}

function applyProductSeo(product = {}) {
  const generated = buildSeoForProduct(product);
  const next = { ...product };
  let updated = false;
  const name = normalizeText(product.name);
  const descriptionText = normalizeText(product.description);

  const currentTitle = normalizeText(product.seoTitle);
  const legacyTitle = normalizeText(product.meta_title);
  const looksAutoTitle = /módulo\s+pantalla/i.test(currentTitle);
  const shouldUseGeneratedTitle =
    !currentTitle ||
    shouldReplaceSeo(currentTitle, GENERIC_SEO_TITLES) ||
    currentTitle.toLowerCase() === name.toLowerCase() ||
    (looksAutoTitle && generated.seoTitle && currentTitle !== generated.seoTitle);
  if (shouldUseGeneratedTitle) {
    if (generated.seoTitle && generated.seoTitle !== currentTitle) updated = true;
    next.seoTitle = generated.seoTitle;
  } else if (!product.seoTitle && legacyTitle) {
    next.seoTitle = legacyTitle;
    updated = true;
  }

  const currentDesc = normalizeText(product.seoDescription);
  const legacyDesc = normalizeText(product.meta_description);
  const looksAutoDescription = /env[ií]os a todo argentina|service pack/i.test(currentDesc);
  const matchesLegacyDesc = currentDesc && legacyDesc && currentDesc.toLowerCase() === legacyDesc.toLowerCase();
  const shouldUseGeneratedDesc =
    !currentDesc ||
    shouldReplaceSeo(currentDesc, GENERIC_SEO_DESCRIPTIONS) ||
    currentDesc.toLowerCase() === descriptionText.toLowerCase() ||
    matchesLegacyDesc ||
    (looksAutoDescription && generated.seoDescription && currentDesc !== generated.seoDescription);
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
  stripBrandSuffix,
};
