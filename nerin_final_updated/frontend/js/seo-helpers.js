export const GENERIC_SEO_TITLES = new Set([
  "repuesto original service pack | nerin parts",
  "pantallas originales con garantía | nerin",
  "pantallas originales con garantía | nerin parts",
  "repuesto original con garantía técnica",
]);

export const GENERIC_SEO_DESCRIPTIONS = new Set([
  "repuestos originales service pack con garantía en nerin parts.",
  "repuesto original con garantía técnica",
  "repuestos originales para técnicos y particulares en argentina.",
]);

function normalizeText(value) {
  if (value == null) return "";
  try {
    return String(value).replace(/\s+/g, " ").trim();
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

function pickMetadata(product = {}) {
  return product && typeof product.metadata === "object" && product.metadata !== null
    ? product.metadata
    : {};
}

function pickField(product = {}, keys = []) {
  const meta = pickMetadata(product);
  for (const key of keys) {
    if (!key) continue;
    if (product && Object.prototype.hasOwnProperty.call(product, key)) {
      const value = product[key];
      if (value != null && value !== "") return value;
    }
    if (meta && Object.prototype.hasOwnProperty.call(meta, key)) {
      const metaValue = meta[key];
      if (metaValue != null && metaValue !== "") return metaValue;
    }
  }
  return null;
}

function normalizeGhCode(value) {
  if (!value) return "";
  const text = String(value);
  const match = text.match(/(gh\s*\d{2}\s*-?\s*\d{4,6}[a-z]?)/i);
  if (!match || !match[1]) return "";
  const cleaned = match[1].replace(/\s+/g, "").toUpperCase();
  if (cleaned.includes("-")) return cleaned;
  const base = cleaned.startsWith("GH") ? cleaned : `GH${cleaned}`;
  return `${base.slice(0, 4)}-${base.slice(4)}`;
}

function extractGhCode(product = {}) {
  const candidates = [
    pickField(product, ["gh_code", "ghCode", "gh", "gh82", "gh_model", "catalog_gh", "catalog_gh_code"]),
    product?.sku,
    product?.name,
    product?.description,
    product?.meta_description,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeGhCode(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function extractModelCode(product = {}) {
  const direct = pickField(product, [
    "model_code",
    "modelCode",
    "model_code_full",
    "full_model_code",
    "fullModelCode",
    "catalog_model_code",
    "catalog_model_ref",
    "catalog_code",
    "device_code",
  ]);
  const normalizedDirect = normalizeText(direct);
  if (normalizedDirect) return normalizedDirect;

  const textSources = [product?.sku, product?.name, product?.description];
  for (const value of textSources) {
    if (typeof value !== "string") continue;
    const match = value.match(/\b([A-Z]{1,3}\d{2,4}[A-Z]?)\b/gi);
    if (match && match.length) {
      const first = match.find((m) => !/^GH\d{2}/i.test(m));
      if (first) return first.toUpperCase();
    }
  }
  return "";
}

function extractModelName(product = {}) {
  const model = normalizeText(
    pickField(product, [
      "model",
      "model_name",
      "modelName",
      "catalog_model",
      "device_model",
      "catalog_device",
    ]),
  );
  if (model) return model;

  const name = normalizeText(product?.name);
  const brand = normalizeText(product?.brand || product?.catalog_brand);
  if (name && brand) {
    const withoutBrand = name.replace(new RegExp(`^${brand}\\s*`, "i"), "").trim();
    if (withoutBrand) return withoutBrand;
  }
  return name;
}

function inferLine(product = {}, brand = "") {
  const line = normalizeText(
    pickField(product, ["line", "series", "family", "catalog_line", "catalog_series", "catalog_family"]),
  );
  if (line) return line;
  if (brand && brand.toLowerCase() === "samsung") return "Galaxy";
  return "";
}

function inferWithFrame(product = {}) {
  const meta = pickMetadata(product);
  const flag = pickField(product, ["with_frame", "withFrame", "frame", "has_frame", "marco"]);
  if (typeof flag === "boolean") return flag;
  if (flag && typeof flag === "string") {
    return /true|1|si|sí|con/i.test(flag);
  }
  const metaFlag = meta && typeof meta.with_frame === "boolean" ? meta.with_frame : null;
  if (metaFlag != null) return metaFlag;
  const textFields = [product?.name, product?.description, product?.short_description, product?.meta_description];
  return textFields.some((value) => typeof value === "string" && /marco/i.test(value));
}

function inferServicePack(product = {}) {
  const flag = pickField(product, ["service_pack", "servicePack", "service_pack_original"]);
  if (typeof flag === "boolean") return flag;
  if (flag && typeof flag === "string") return /service\s*pack|sp\b/i.test(flag);
  const textFields = [product?.name, product?.description, product?.short_description];
  return textFields.some((value) => typeof value === "string" && /service\s*pack/i.test(value)) || true;
}

function isStockRealProduct(product = {}) {
  const text = [product.availability, product.stock_status, product.stock_mode, product.fulfillment_mode]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const remote = /preorder|backorder|a[_\s-]?pedido|bajo\s+pedido|pedido|remote|remoto/.test(text) ||
    Number(product.remote_stock || product.stock_remote || product.available_remote || 0) > 0;
  return Number(product.stock || 0) > 0 && !remote;
}

function buildCommercialModel(product = {}, label = "") {
  return normalizeText(
    product.model ||
      product.modelo ||
      product.model_base ||
      label.match(/\b(?:Samsung\s+)?Galaxy\s+[A-Z]?\d{2,3}(?:\s*5G)?\b/i)?.[0] ||
      label.match(/\bSM-[A-Z0-9]+(?:\/[A-Z0-9]+)?\b/i)?.[0] ||
      "",
  );
}

function buildPartCode(product = {}, label = "") {
  return normalizeText(label.match(/\bGH82[-A-Z0-9]+\b/i)?.[0] || product.sku || product.mpn || product.part_number || "");
}

// Generador centralizado de metadatos SEO para un producto.
// Mantiene el nombre comercial real y evita copy inventado.
export function generateProductSeo(product = {}) {
  const label = compactText(
    product?.name || product?.title || product?.description || product?.sku || product?.id || "Repuesto",
  );
  const brand = normalizeText(product?.brand || product?.catalog_brand);
  const sku = normalizeText(product?.sku);

  if (isStockRealProduct(product)) {
    const model = buildCommercialModel(product, label);
    const partCode = buildPartCode(product, label || sku);
    const isScreen = /pantalla|display|modulo|m[oó]dulo|gh82|service\s*pack/i.test([label, product.category].join(" "));
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
      ogDescription: "Stock real en CABA, factura A/B, garantia tecnica y envio a Argentina.",
    };
  }

  const extras = [];
  if (brand) extras.push(`Marca: ${brand}.`);
  if (sku) extras.push(`SKU: ${sku}.`);

  const baseDescription = `${label} disponible en NERIN Parts. Verificá compatibilidad, SKU/código de pieza y disponibilidad antes de comprar.`;
  const description = compactText([baseDescription, ...extras].join(" "));
  const title = compactText(`${label} | NERIN Parts`);

  return {
    title: truncateText(title, 160),
    description: truncateText(description, 200),
    ogTitle: title,
    ogDescription: description,
  };
}

export function buildSeoForProduct(product = {}) {
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

export function applySeoDefaults(product = {}) {
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

export function stripBrandSuffix(value) {
  const text = normalizeText(value);
  return text.replace(/\s*\|\s*NERIN Parts$/i, "").trim();
}
