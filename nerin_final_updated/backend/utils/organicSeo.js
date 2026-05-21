const { detectProductType } = require("./productTaxonomy");
const {
  getPublicPriceValue,
  resolveProductAvailability,
} = require("./productAvailability");

const DEMAND_PART_TYPES = new Set([
  "display",
  "battery",
  "charging",
  "back_cover",
  "camera",
  "flex",
  "speaker",
  "sim_tray",
]);

const BRAND_PATTERNS = [
  ["Apple", /\b(apple|iphone)\b/i],
  ["Samsung", /\b(samsung|galaxy|sm-[a-z0-9]+)\b/i],
  ["Xiaomi", /\b(xiaomi|redmi|poco)\b/i],
  ["Huawei", /\bhuawei\b/i],
  ["Honor", /\bhonor\b/i],
  ["OnePlus", /\b(oneplus|one plus)\b/i],
  ["Motorola", /\b(motorola|moto)\b/i],
];

function cleanText(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function lowerText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function truncateText(value, limit = 155) {
  const text = cleanText(value);
  if (text.length <= limit) return text;
  const slice = text.slice(0, Math.max(0, limit - 1));
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > 40 ? slice.slice(0, lastSpace) : slice).replace(/[\s,.:-]+$/, "")}...`;
}

function pickField(product = {}, keys = []) {
  const metadata = product && typeof product.metadata === "object" && product.metadata ? product.metadata : {};
  const supplierImport =
    metadata && typeof metadata.supplierImport === "object" && metadata.supplierImport ? metadata.supplierImport : {};
  for (const key of keys) {
    if (!key) continue;
    if (product[key] != null && product[key] !== "") return product[key];
    if (metadata[key] != null && metadata[key] !== "") return metadata[key];
    if (supplierImport[key] != null && supplierImport[key] !== "") return supplierImport[key];
  }
  return "";
}

function isPublicProduct(product = {}) {
  if (!product || typeof product !== "object") return false;
  const flags = [
    product.visibility,
    product.status,
    product.publication_status,
    product.estado,
  ].map(lowerText).join(" ");
  if (/(hidden|private|draft|disabled|archived|deleted|borrado|oculto)/.test(flags)) return false;
  if (product.enabled === false || product.deleted === true || product.archived === true) return false;
  if (product.hidden === true || product.private === true || product.draft === true || product.disabled === true) return false;
  if (product.vip_only === true || product.wholesaleOnly === true || product.wholesale_only === true) return false;
  return Boolean(getPublicSlug(product) || pickField(product, ["id", "sku", "code", "mpn", "part_number"]));
}

function getPublicSlug(product = {}) {
  return cleanText(
    pickField(product, [
      "publicSlug",
      "public_slug",
      "slug",
      "seo_slug",
    ]),
  );
}

function getTitle(product = {}) {
  return cleanText(pickField(product, ["name", "title", "product_title", "description"])) || "Repuesto";
}

function getImageCandidates(product = {}) {
  const rawImages = Array.isArray(product.images) ? product.images : [];
  return [
    product.image,
    product.image_url,
    product.thumbnail,
    product.picture,
    ...rawImages,
  ].map(cleanText).filter(Boolean);
}

function isValidImageUrl(value = "") {
  const raw = cleanText(value);
  if (!raw) return false;
  if (/^(data:|blob:|javascript:|base64[,;])/i.test(raw)) return false;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return Boolean(parsed.hostname && parsed.hostname.includes("."));
    } catch {
      return false;
    }
  }
  return raw.startsWith("/") || /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(raw);
}

function inferBrand(product = {}) {
  const explicit = cleanText(pickField(product, ["brand", "marca", "manufacturer"]));
  if (explicit) return explicit.replace(/^for\s+/i, "").trim();
  const text = [getTitle(product), product.model, product.category, product.description].map(cleanText).join(" ");
  for (const [brand, pattern] of BRAND_PATTERNS) {
    if (pattern.test(text)) return brand;
  }
  return "";
}

function inferModel(product = {}) {
  const explicit = cleanText(pickField(product, ["model", "modelo", "compatible_model", "compatibleModels"]));
  if (explicit) return explicit;
  const text = lowerText([getTitle(product), product.description, product.category, product.subcategory].join(" "));
  const patterns = [
    /\biphone\s+\d{1,2}(?:\s+(?:mini|plus|pro(?:\s+max)?|air))?\b/i,
    /\bgalaxy\s+[a-z]\d{1,3}(?:\s+\d+g)?\b/i,
    /\bsamsung\s+[a-z]\d{1,3}(?:\s+\d+g)?\b/i,
    /\bredmi\s+note\s+\d{1,2}(?:\s+pro)?\b/i,
    /\bhonor\s+\d{2,3}(?:\s+pro)?\b/i,
    /\bmoto\s+g\d{1,3}\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  return "";
}

function getPartTypeKey(product = {}) {
  const text = lowerText([getTitle(product), product.description, product.category, product.subcategory].join(" "));
  if (/\b(pantalla|display|screen|lcd|oled|amoled|modulo)\b/.test(text) && !/\b(adhesivo|adhesive|tape|protector|templado)\b/.test(text)) return "display";
  if (/\b(bateria|battery|pila)\b/.test(text)) return "battery";
  if (/\b(pin de carga|placa de carga|charging|dock|usb connector|puerto de carga)\b/.test(text)) return "charging";
  if (/\b(tapa|back glass|rear cover|back cover|carcasa)\b/.test(text)) return "back_cover";
  if (/\b(camara|camera|camera lens|lente)\b/.test(text)) return "camera";
  if (/\b(flex|flex cable)\b/.test(text)) return "flex";
  if (/\b(parlante|speaker|auricular|ear speaker)\b/.test(text)) return "speaker";
  if (/\b(bandeja sim|sim tray)\b/.test(text)) return "sim_tray";
  if (/\b(adhesivo|adhesive|gasket|seal)\b/.test(text)) return "adhesive";
  const detected = detectProductType(product);
  const normalized = lowerText(detected);
  if (normalized.includes("pantalla") || normalized.includes("display")) return "display";
  if (normalized.includes("bateria")) return "battery";
  if (normalized.includes("carga")) return "charging";
  if (normalized.includes("tapa") || normalized.includes("carcasa")) return "back_cover";
  if (normalized.includes("camara") || normalized.includes("lente")) return "camera";
  if (normalized.includes("flex")) return "flex";
  if (normalized.includes("audio") || normalized.includes("parlante")) return "speaker";
  if (normalized.includes("sim")) return "sim_tray";
  if (normalized.includes("adhesivo")) return "adhesive";
  return "other";
}

function getPartLabel(partTypeKey) {
  switch (partTypeKey) {
    case "display":
      return "Pantalla";
    case "battery":
      return "Bateria";
    case "charging":
      return "Pin de carga";
    case "back_cover":
      return "Tapa trasera";
    case "camera":
      return "Camara";
    case "flex":
      return "Flex";
    case "speaker":
      return "Parlante";
    case "sim_tray":
      return "Bandeja SIM";
    case "adhesive":
      return "Adhesivo";
    default:
      return "Repuesto";
  }
}

function buildTargetKeywords(product = {}, { brand = "", model = "", partTypeKey = "other" } = {}) {
  const part = getPartLabel(partTypeKey).toLowerCase();
  const tokens = [
    [part, brand, model].filter(Boolean).join(" "),
    [part, model, "stock real"].filter(Boolean).join(" "),
    ["repuesto", brand, model, "Argentina"].filter(Boolean).join(" "),
    [brand, model, "NERIN Parts"].filter(Boolean).join(" "),
  ].map(cleanText).filter(Boolean);
  return Array.from(new Set(tokens)).slice(0, 8);
}

function computeOrganicSeoPriority(product = {}) {
  const reasons = [];
  const blockers = [];
  let priorityScore = 0;

  const title = getTitle(product);
  const slug = getPublicSlug(product);
  const price = getPublicPriceValue(product);
  const images = getImageCandidates(product);
  const hasValidImage = images.some(isValidImageUrl);
  const availability = resolveProductAvailability(product);
  const isStockReal = availability.merchantAvailability === "in_stock" && Number(availability.stockLocal || 0) > 0;
  const brand = inferBrand(product);
  const model = inferModel(product);
  const partTypeKey = getPartTypeKey(product);
  const category = cleanText(pickField(product, ["category", "categoria", "productType"])) || getPartLabel(partTypeKey);
  const skuOrMpn = cleanText(pickField(product, ["sku", "mpn", "part_number", "partNumber", "code"]));

  if (!isPublicProduct(product)) blockers.push("not_public");
  if (!isStockReal) blockers.push("not_stock_real");
  if (!(price > 0)) blockers.push("missing_price");
  if (!hasValidImage) blockers.push("missing_image");
  if (!slug) blockers.push("missing_slug");
  if (!title || title === "Repuesto") blockers.push("missing_clear_title");
  if (!brand) blockers.push("missing_brand");
  if (!model) blockers.push("missing_model");
  if (!category) blockers.push("missing_category");

  if (isStockReal) { priorityScore += 1000; reasons.push("stock_real"); }
  if (price > 0) { priorityScore += 250; reasons.push("valid_price"); }
  if (hasValidImage) { priorityScore += 250; reasons.push("valid_image"); }
  if (slug) { priorityScore += 200; reasons.push("public_slug"); }
  if (brand) { priorityScore += 200; reasons.push("identified_brand"); }
  if (model) { priorityScore += 350; reasons.push("identified_model"); }
  if (skuOrMpn) { priorityScore += 180; reasons.push("sku_or_mpn"); }
  if (category) { priorityScore += 180; reasons.push("clear_category"); }
  if (DEMAND_PART_TYPES.has(partTypeKey)) { priorityScore += 300; reasons.push(`high_demand_${partTypeKey}`); }

  const partLabel = getPartLabel(partTypeKey);
  const modelCopy = [brand, model].filter(Boolean).join(" ").trim();
  const productLabel = [partLabel, modelCopy].filter(Boolean).join(" ").trim() || title;
  const seoTitle = isStockReal
    ? truncateText(`${productLabel} en stock | NERIN Parts`, 70)
    : truncateText(`${productLabel} | NERIN Parts`, 70);
  const seoDescription = isStockReal
    ? truncateText(`${productLabel} con stock real en CABA. Factura A/B, garantia tecnica y soporte para verificar compatibilidad antes de comprar.`, 160)
    : truncateText(`${productLabel} en NERIN Parts. Consultanos disponibilidad, compatibilidad, factura y garantia tecnica.`, 160);

  return {
    isStockReal,
    isOrganicPriority: blockers.length === 0,
    priorityScore,
    targetKeywords: buildTargetKeywords(product, { brand, model, partTypeKey }),
    seoTitle,
    seoDescription,
    reasons,
    blockers,
    brand,
    model,
    category,
    partTypeKey,
    availability: availability.merchantAvailability,
  };
}

function isBrandDoubtful(product = {}) {
  return !inferBrand(product);
}

function matchesOrganicPage(product = {}, pageKey = "") {
  const priority = computeOrganicSeoPriority(product);
  const brand = lowerText(priority.brand);
  const model = lowerText(priority.model);
  switch (pageKey) {
    case "stock-real":
      return priority.isOrganicPriority;
    case "pantallas-en-stock":
      return priority.isOrganicPriority && priority.partTypeKey === "display";
    case "baterias-en-stock":
      return priority.isOrganicPriority && priority.partTypeKey === "battery";
    case "repuestos-samsung":
      return priority.isOrganicPriority && brand.includes("samsung");
    case "repuestos-iphone":
      return priority.isOrganicPriority && (brand.includes("apple") || model.includes("iphone"));
    default:
      return false;
  }
}

module.exports = {
  computeOrganicSeoPriority,
  getImageCandidates,
  getPartLabel,
  getPartTypeKey,
  getPublicSlug,
  inferBrand,
  inferModel,
  isBrandDoubtful,
  isPublicProduct,
  isValidImageUrl,
  matchesOrganicPage,
};
