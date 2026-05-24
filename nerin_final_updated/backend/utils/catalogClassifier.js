"use strict";

function normalizeText(value = "") {
  let text = String(value || "");
  const mojibake = [
    ["ÃƒÂ³", "o"], ["ÃƒÂ¡", "a"], ["ÃƒÂ©", "e"], ["ÃƒÂ­", "i"], ["ÃƒÂº", "u"], ["ÃƒÂ±", "n"], ["ÃƒÂ¼", "u"],
    ["Ã³", "o"], ["Ã¡", "a"], ["Ã©", "e"], ["Ã­", "i"], ["Ãº", "u"], ["Ã±", "n"], ["Ã¼", "u"],
    ["Â", ""],
  ];
  for (const [from, to] of mojibake) text = text.split(from).join(to);
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {}
  return text
    .toLowerCase()
    .replace(/[_/\\|+,.;:()[\]{}]+/g, " ")
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDisplay(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstText(values = []) {
  for (const value of values) {
    const text = cleanDisplay(value);
    if (text) return text;
  }
  return "";
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

const PART_TYPE_DICTIONARY = Object.freeze({
  display_adhesive: ["display adhesive tape", "display adhesive", "adhesivo pantalla", "adhesivo de pantalla", "lcd adhesive", "screen adhesive"],
  back_cover_adhesive: ["rear cover adhesive", "back cover adhesive", "back glass adhesive", "adhesivo tapa", "adhesivo tapa trasera"],
  battery_adhesive: ["battery adhesive", "battery adhesive tape", "adhesivo bateria", "adhesivo de bateria"],
  camera_lens: ["camera lens", "camera glass", "lens glass", "lente camara", "lente de camara", "cristal camara", "vidrio camara"],
  rear_camera: ["rear camera", "main camera", "camara trasera", "camara principal"],
  front_camera: ["front camera", "selfie camera", "camara frontal", "camara selfie"],
  charging_board: ["pin de carga", "placa de carga", "centro de carga", "charging board", "usb board", "sub board", "daughterboard"],
  charging_port: ["puerto de carga", "conector de carga", "charging port", "charging connector", "charge port", "dock connector", "usb connector"],
  sim_tray: ["keyset simcard tray", "bandeja sim", "sim tray", "charola sim", "porta sim", "simcard tray", "card tray"],
  antenna: ["gps antenna", "wifi antenna", "nfc antenna", "antenna", "antena"],
  bracket: ["bracket display", "display bracket", "camera bracket", "bracket", "soporte"],
  fingerprint_sensor: ["fingerprint sensor", "sensor huella", "huella digital"],
  sensor: ["proximity sensor", "light sensor", "sensor proximidad", "sensor"],
  microphone: ["microphone", "mic", "microfono"],
  vibrator: ["vibration motor", "motor vibrador", "vibrador"],
  earpiece: ["ear speaker", "earpiece", "auricular interno", "speaker receiver"],
  loudspeaker: ["loud speaker", "loudspeaker", "bottom speaker", "parlante", "altavoz"],
  back_cover: ["tapa trasera", "vidrio trasero", "back glass", "rear cover", "back cover", "battery cover", "tapa"],
  housing: ["housing", "carcasa", "middle frame housing", "back housing"],
  frame: ["middle frame", "lcd frame", "display frame", "marco", "frame"],
  adhesive: ["adhesive tape", "adhesivo", "adhesive", "gasket", "seal", "pegamento", "cinta adhesiva", "cinta"],
  camera: ["camera", "camara"],
  display: ["display incl frame", "display excl frame", "hard oled", "soft oled", "super amoled", "pantalla", "modulo", "modulo pantalla", "display", "screen", "lcd", "oled", "amoled", "tactil", "touch", "glass", "assembly"],
  battery: ["high capacity", "bateria", "battery", "bateria", "baterias", "pila", "accu", "acumulador"],
  flex: ["flex cable rear camera", "interconnection flex", "main flex", "cable flex", "flex principal", "flex cable", "flex"],
  speaker: ["loud speaker", "ear speaker", "parlante", "speaker", "loudspeaker", "altavoz", "auricular interno"],
  button: ["power button", "volume button", "slider key", "keyset", "boton", "button", "key"],
  motherboard_component: ["motherboard component", "logic board component", "mainboard component", "componentes electronicos", "ic", "chip", "componente"],
  component: ["board", "pcb", "component"],
});

const PART_LABELS = Object.freeze({
  display: "Pantallas",
  display_adhesive: "Adhesivo de pantalla",
  back_cover_adhesive: "Adhesivo de tapa",
  battery_adhesive: "Adhesivo de bateria",
  battery: "Baterias",
  charging_board: "Pin de carga",
  charging_port: "Puerto de carga",
  back_cover: "Tapas",
  housing: "Carcasas",
  frame: "Marcos",
  camera: "Camaras",
  camera_lens: "Lente de camara",
  rear_camera: "Camara trasera",
  front_camera: "Camara frontal",
  flex: "Flex",
  speaker: "Parlantes",
  earpiece: "Auricular interno",
  loudspeaker: "Parlante",
  sim_tray: "Bandeja SIM",
  adhesive: "Adhesivos",
  button: "Botones",
  vibrator: "Vibradores",
  microphone: "Microfonos",
  antenna: "Antenas",
  bracket: "Soportes",
  sensor: "Sensores",
  fingerprint_sensor: "Sensor de huella",
  motherboard_component: "Componentes de placa",
  component: "Componentes",
});

const BRAND_PATTERNS = [
  { value: "Apple", aliases: ["apple", "iphone", "ipad", "macbook"] },
  { value: "Samsung", aliases: ["samsung", "galaxy", "sm-"] },
  { value: "Google", aliases: ["google", "pixel"] },
  { value: "Nothing", aliases: ["nothing", "nothing phone", "cmf phone"] },
  { value: "Asus", aliases: ["asus", "zenfone", "rog phone"] },
  { value: "Xiaomi", aliases: ["xiaomi", "redmi", "poco"] },
  { value: "Motorola", aliases: ["motorola", "moto"] },
  { value: "Huawei", aliases: ["huawei"] },
  { value: "Honor", aliases: ["honor"] },
  { value: "OnePlus", aliases: ["oneplus", "one plus"] },
  { value: "Oppo", aliases: ["oppo"] },
  { value: "Realme", aliases: ["realme"] },
  { value: "Vivo", aliases: ["vivo"] },
  { value: "Nokia", aliases: ["nokia"] },
  { value: "Sony", aliases: ["sony"] },
  { value: "TCL", aliases: ["tcl"] },
  { value: "ZTE", aliases: ["zte", "nubia"] },
  { value: "Lenovo", aliases: ["lenovo"] },
  { value: "LG", aliases: ["lg"] },
  { value: "Meizu", aliases: ["meizu"] },
  { value: "HTC", aliases: ["htc"] },
  { value: "Fairphone", aliases: ["fairphone"] },
  { value: "Tecno", aliases: ["tecno"] },
  { value: "Infinix", aliases: ["infinix"] },
  { value: "Alcatel", aliases: ["alcatel"] },
  { value: "Microsoft", aliases: ["microsoft", "surface"] },
  { value: "Apple Watch", aliases: ["apple watch", "watch"] },
];

const VARIANT_TERMS = ["pro max", "pro xl", "pro", "mini", "plus", "ultra", "lite", "air", "fold", "tablet", "base", "a"];
const NETWORK_VARIANTS = ["5g", "4g"];

const QUALITY_RULES = [
  { tier: "service_pack", terms: ["service pack", "servicepack"] },
  { tier: "pulled_a", terms: ["pulled a", "pull a"] },
  { tier: "pulled_b", terms: ["pulled b", "pull b"] },
  { tier: "pulled_c", terms: ["pulled c", "pull c"] },
  { tier: "refurbished", terms: ["refurbished", "reacondicionado"] },
  { tier: "soft_oled", terms: ["soft oled"] },
  { tier: "hard_oled", terms: ["hard oled"] },
  { tier: "incell", terms: ["incell", "in-cell"] },
  { tier: "jk", terms: [" jk ", " jk", "jk "] },
  { tier: "high_capacity", terms: ["high capacity", "alta capacidad"] },
  { tier: "best_possible", terms: ["best possible"] },
  { tier: "original", terms: ["original", "genuine", "oem"] },
  { tier: "compatible", terms: ["compatible", "replacement", "for "] },
];

const COLORS = Object.freeze({
  black: ["black", "negro"],
  white: ["white", "blanco"],
  silver: ["silver", "plata"],
  gold: ["gold", "dorado"],
  green: ["green", "verde"],
  blue: ["blue", "azul"],
  red: ["red", "rojo"],
  purple: ["purple", "violeta", "morado"],
  lavender: ["lavender", "lavanda"],
  graphite: ["graphite", "grafito"],
  titanium: ["titanium", "titanio"],
  pink: ["pink", "rosa"],
  yellow: ["yellow", "amarillo"],
  orange: ["orange", "naranja"],
  gray: ["gray", "grey", "gris"],
  midnight: ["midnight"],
  starlight: ["starlight"],
});

const STOPWORDS = new Set(["for", "para", "de", "del", "la", "el", "con", "sin", "and", "the", "a", "an"]);

function includesPhrase(haystack, phrase) {
  const normalized = normalizeText(phrase);
  if (!normalized) return false;
  return new RegExp(`(^|\\s)${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(` ${haystack} `);
}

function detectPartType(text) {
  let best = { part_type: "", confidence: 0, terms: [] };
  for (const [partType, terms] of Object.entries(PART_TYPE_DICTIONARY)) {
    const matched = terms.filter((term) => includesPhrase(text, term));
    if (!matched.length) continue;
    const score = Math.min(1, 0.52 + matched.reduce((sum, term) => sum + Math.min(0.25, normalizeText(term).length / 40), 0));
    if (score > best.confidence) best = { part_type: partType, confidence: score, terms: matched };
  }
  return best;
}

function detectBrand(text, rawBrand = "") {
  const normalizedBrand = normalizeText(rawBrand);
  const forBrand = BRAND_PATTERNS.find((brand) =>
    brand.aliases.some((alias) => includesPhrase(text, `for ${alias}`) || includesPhrase(text, `compatible for ${alias}`)),
  );
  let detected = null;
  for (const brand of BRAND_PATTERNS) {
    if (brand.aliases.some((alias) => includesPhrase(text, alias) || normalizedBrand === normalizeText(alias))) {
      detected = brand;
      break;
    }
  }
  if (!detected && forBrand) detected = forBrand;
  const brandName = detected?.value || "";
  const isCompatible = Boolean(forBrand || /^\s*for\s+/i.test(String(rawBrand || "")) || includesPhrase(text, "compatible"));
  return {
    device_brand: brandName,
    device_brand_confidence: brandName ? (forBrand ? 0.88 : 0.78) : 0,
    compatible_brand: isCompatible ? brandName : "",
    official_brand: !isCompatible && brandName && /\b(original|service pack|genuine|oem)\b/.test(text) ? brandName : "",
    is_compatible_for_brand: isCompatible && Boolean(brandName),
  };
}

function titleCaseModel(value = "") {
  return cleanDisplay(value)
    .replace(/\biphone\b/ig, "iPhone")
    .replace(/\bmacbook\b/ig, "MacBook")
    .replace(/\bipad\b/ig, "iPad")
    .replace(/\bpixel\b/ig, "Pixel")
    .replace(/\bnothing\b/ig, "Nothing")
    .replace(/\bcmf\b/ig, "CMF")
    .replace(/\bzenfone\b/ig, "Zenfone")
    .replace(/\brog\b/ig, "ROG")
    .replace(/\bgalaxy\b/ig, "Galaxy")
    .replace(/\bredmi\b/ig, "Redmi")
    .replace(/\bpoco\b/ig, "Poco")
    .replace(/\bhonor\b/ig, "Honor")
    .replace(/\bhuawei\b/ig, "Huawei")
    .replace(/\bsamsung\b/ig, "Samsung")
    .replace(/\bsurface\b/ig, "Surface")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bIPhone\b/g, "iPhone")
    .replace(/\bMacbook\b/g, "MacBook")
    .replace(/\bIPad\b/g, "iPad")
    .replace(/\bXl\b/g, "XL")
    .replace(/(\d)([a-z])\b/g, (_, n, ch) => `${n}${ch.toUpperCase()}`)
    .replace(/\bPixel\s+(\d+)A\b/g, "Pixel $1a")
    .replace(/\bNothing\s+Phone\s+(\d+)A\b/g, "Nothing Phone $1a");
}

function normalizeVariant(value = "") {
  const text = normalizeText(value);
  if (includesPhrase(text, "pro max")) return "pro max";
  if (includesPhrase(text, "pro xl")) return "pro xl";
  for (const variant of VARIANT_TERMS) {
    if (variant !== "base" && variant !== "a" && includesPhrase(text, variant)) return variant;
  }
  return "base";
}

function detectModel(text, brand = "") {
  let match = text.match(/\bpixel\s+(fold|tablet)\b/);
  if (match) {
    const variant = normalizeText(match[1]);
    return {
      model_family: "Pixel",
      model_base: titleCaseModel(`Pixel ${variant}`),
      model_generation: variant,
      model_variant: variant,
      network_variant: "",
    };
  }
  match = text.match(/\bpixel\s+(\d{1,2})(a)?(?:\s+(pro\s+xl|pro|xl))?\b/);
  if (match) {
    const generation = match[1];
    const variant = match[2] ? "a" : match[3] ? normalizeVariant(match[3]) : "base";
    const suffix = variant === "base" ? "" : variant === "a" ? "a" : ` ${variant}`;
    return {
      model_family: "Pixel",
      model_base: titleCaseModel(`Pixel ${generation}${suffix}`),
      model_generation: generation,
      model_variant: variant,
      network_variant: "",
    };
  }

  match = text.match(/\bnothing\s+phone\s+(\d)(a)?\b/);
  if (match) {
    const generation = match[1];
    const variant = match[2] ? "a" : "base";
    return {
      model_family: "Nothing Phone",
      model_base: titleCaseModel(`Nothing Phone ${generation}${variant === "a" ? "a" : ""}`),
      model_generation: generation,
      model_variant: variant,
      network_variant: "",
    };
  }
  match = text.match(/\bcmf\s+phone\s+(\d)\b/);
  if (match) {
    return {
      model_family: "CMF Phone",
      model_base: titleCaseModel(`CMF Phone ${match[1]}`),
      model_generation: match[1],
      model_variant: "base",
      network_variant: "",
    };
  }

  match = text.match(/\b(zenfone|rog\s+phone)\s+(\d{1,2})\b/);
  if (match) {
    const family = normalizeText(match[1]) === "zenfone" ? "Zenfone" : "ROG Phone";
    return {
      model_family: family,
      model_base: titleCaseModel(`${family} ${match[2]}`),
      model_generation: match[2],
      model_variant: "base",
      network_variant: "",
    };
  }

  match = text.match(/\bipad\s+(pro|air|mini)?\s*(\d{1,2}(?:\s*9)?|se)?\s*(\d{4})?\b/);
  if (match && includesPhrase(text, "ipad")) {
    const variant = normalizeText(match[1] || "base");
    const sizeOrGen = cleanDisplay(match[2] || "");
    const year = cleanDisplay(match[3] || "");
    const base = `iPad ${variant === "base" ? "" : variant} ${sizeOrGen} ${year}`.trim();
    return {
      model_family: "iPad",
      model_base: titleCaseModel(base),
      model_generation: year || sizeOrGen || variant,
      model_variant: variant,
      network_variant: "",
    };
  }

  match = text.match(/\bgalaxy\s+tab\s+([as])\s*(\d{1,2})?(?:\s+(fe|plus|ultra))?\b/);
  if (match) {
    const series = String(match[1] || "").toUpperCase();
    const generation = match[2] || "";
    const variant = normalizeVariant(match[3] || "base");
    return {
      model_family: "Galaxy Tab",
      model_base: titleCaseModel(`Galaxy Tab ${series}${generation}${variant === "base" ? "" : ` ${variant}`}`),
      model_generation: `${series}${generation}`,
      model_variant: variant,
      network_variant: "",
    };
  }

  match = text.match(/\b(?:samsung\s+)?(?:galaxy\s+)?xcover\s*(\d{1,2})(?:\s+(pro))?\b/);
  if (match) {
    const variant = normalizeVariant(match[2] || "base");
    return {
      model_family: "Galaxy",
      model_base: titleCaseModel(`Galaxy XCover${match[1]}${variant === "base" ? "" : ` ${variant}`}`),
      model_generation: match[1],
      model_variant: variant,
      network_variant: "",
    };
  }

  match = text.match(/\bapple\s+watch\s+(?:series\s+)?(\d{1,2}|se|ultra)(?:\s+(\d{1,2}))?\b/);
  if (match) {
    const generation = match[1] === "ultra" && match[2] ? `${match[1]} ${match[2]}` : match[1];
    return {
      model_family: "Apple Watch",
      model_base: titleCaseModel(`Apple Watch ${generation}`),
      model_generation: generation,
      model_variant: normalizeText(match[1]),
      network_variant: "",
    };
  }

  match = text.match(/\bgalaxy\s+watch\s+(\d{1,2})(?:\s+(classic|pro))?\b/);
  if (match) {
    const variant = normalizeVariant(match[2] || "base");
    return {
      model_family: "Galaxy Watch",
      model_base: titleCaseModel(`Galaxy Watch ${match[1]}${variant === "base" ? "" : ` ${variant}`}`),
      model_generation: match[1],
      model_variant: variant,
      network_variant: "",
    };
  }

  match = text.match(/\bsurface\s+(pro|go|book|laptop)?\s*(\d{1,2})?\b/);
  if (match && includesPhrase(text, "surface")) {
    const variant = normalizeText(match[1] || "base");
    const generation = match[2] || variant;
    return {
      model_family: "Surface",
      model_base: titleCaseModel(`Surface ${variant === "base" ? "" : variant} ${match[2] || ""}`.trim()),
      model_generation: generation,
      model_variant: variant,
      network_variant: "",
    };
  }

  const rules = [
    { family: "iphone", regex: /\biphone\s+(\d{1,2}s?)(?:\s+(pro\s+max|pro|max|mini|plus|air))?\b/ },
    { family: "macbook", regex: /\bmacbook\s+(air|pro)?\s*(\d{2})?\s*(\d{4})?(?:\s+(a\d{4}))?\b/ },
    { family: "galaxy", regex: /\b(?:samsung\s+)?(?:galaxy\s+)?((?:a|s|m|note|z)\d{1,3})(?:\s+(ultra|plus|lite))?(?:\s+(5g|4g))?\b/ },
    { family: "redmi", regex: /\b(?:xiaomi\s+)?(?:redmi\s+)?(?:note\s+)?(\d{1,2})(?:\s+(pro|max|plus))?(?:\s+(5g|4g))?\b/ },
    { family: "honor", regex: /\bhonor\s+([a-z0-9]+(?:\s*[a-z0-9]+){0,2})(?:\s+(lite|pro|plus|air|5g|4g))?\b/ },
    { family: "huawei", regex: /\bhuawei\s+([a-z0-9]+(?:\s*[a-z0-9]+){0,2})(?:\s+(lite|pro|plus|5g|4g))?\b/ },
    { family: "oneplus", regex: /\bone\s*plus\s+([a-z0-9]+(?:\s*[a-z0-9]+){0,2})\b|\boneplus\s+([a-z0-9]+(?:\s*[a-z0-9]+){0,2})\b/ },
  ];
  for (const rule of rules) {
    if (rule.family === "redmi" && !/\b(xiaomi|redmi|poco|note)\b/.test(text)) continue;
    const match = text.match(rule.regex);
    if (!match) continue;
    if (rule.family === "iphone") {
      const gen = match[1];
      const variant = normalizeVariant(match[2] || "base");
      return {
        model_family: "iPhone",
        model_base: titleCaseModel(`iPhone ${gen}${variant === "base" ? "" : ` ${variant}`}`),
        model_generation: gen,
        model_variant: variant,
        network_variant: "",
      };
    }
    if (rule.family === "macbook") {
      const variant = normalizeText(match[1] || "") || "base";
      const generation = match[3] || match[2] || "";
      return {
        model_family: "MacBook",
        model_base: titleCaseModel(`MacBook ${variant === "base" ? "" : variant} ${match[2] || ""} ${match[3] || ""}`.trim()),
        model_generation: generation,
        model_variant: variant,
        network_variant: "",
      };
    }
    if (rule.family === "galaxy") {
      const code = String(match[1] || "").toUpperCase();
      const variant = normalizeVariant(match[2] || "base");
      const network = normalizeText(match[3] || "");
      return {
        model_family: "Galaxy",
        model_base: titleCaseModel(`Galaxy ${code}${variant === "base" ? "" : ` ${variant}`}${network ? ` ${network.toUpperCase()}` : ""}`),
        model_generation: code.replace(/^[A-Z]+/, ""),
        model_variant: variant,
        network_variant: network,
      };
    }
    const modelRaw = cleanDisplay(match[1] || match[2] || "");
    const variantRaw = normalizeVariant(match[2] || modelRaw || "");
    const network = NETWORK_VARIANTS.find((network) => includesPhrase(text, network)) || "";
    const modelAlreadyHasVariant = variantRaw && variantRaw !== "base" && includesPhrase(normalizeText(modelRaw), variantRaw);
    return {
      model_family: titleCaseModel(rule.family),
      model_base: titleCaseModel(`${brand || rule.family} ${modelRaw}${variantRaw && variantRaw !== "base" && !modelAlreadyHasVariant ? ` ${variantRaw}` : ""}${network ? ` ${network.toUpperCase()}` : ""}`),
      model_generation: (modelRaw.match(/\d+/) || [""])[0],
      model_variant: variantRaw || "base",
      network_variant: network,
    };
  }
  return { model_family: "", model_base: "", model_generation: "", model_variant: "", network_variant: "" };
}

function detectModelCode(text) {
  const match = text.match(/\b(sm-[a-z0-9]+|gh\d{2}-\d{5}[a-z]?|a\d{4}|m\d{4})\b/i);
  return match ? match[1].toUpperCase() : "";
}

function detectQuality(text) {
  const signals = [];
  for (const rule of QUALITY_RULES) {
    if (rule.terms.some((term) => includesPhrase(text, term) || text.includes(normalizeText(term)))) signals.push(rule.tier);
  }
  let quality_tier = signals[0] || "";
  if (signals.includes("original")) quality_tier = "original";
  if (signals.includes("compatible") && !signals.includes("original") && !signals.includes("service_pack")) quality_tier = "compatible";
  if (signals.includes("service_pack")) quality_tier = "service_pack";
  return { quality_tier, quality_signals: unique(signals) };
}

function detectFrame(text) {
  if (/\b(incl|with|con|incluye)\s+(frame|marco)\b/.test(text) || includesPhrase(text, "display incl frame")) {
    return { has_frame: true, frame_status: "with_frame" };
  }
  if (/\b(excl|without|sin)\s+(frame|marco)\b/.test(text) || includesPhrase(text, "display excl frame")) {
    return { has_frame: false, frame_status: "without_frame" };
  }
  return { has_frame: null, frame_status: "" };
}

function detectColor(text) {
  for (const [color, aliases] of Object.entries(COLORS)) {
    if (aliases.some((alias) => includesPhrase(text, alias))) return { color, color_confidence: 0.9 };
  }
  return { color: "", color_confidence: 0 };
}

function detectStock(product = {}) {
  const stock = numberOrNull(product.stock ?? product.quantity ?? product.available_quantity ?? product.stockQty) ?? 0;
  const availability = normalizeText([product.availability, product.stock_status, product.stockStatus, product.stock_mode, product.fulfillment_mode].filter(Boolean).join(" "));
  const isPreorder = /preorder|backorder|pedido|remote|remoto/.test(availability) || Boolean(product.allow_backorder || product.allowBackorder || product.remote_stock || product.remoteStock);
  const isStockReal = stock > 0 && !isPreorder;
  const isOutOfStock = stock <= 0 && !isPreorder;
  return {
    stock_status: isStockReal ? "in_stock" : isPreorder ? "preorder" : "out_of_stock",
    is_stock_real: isStockReal,
    is_preorder: isPreorder,
    is_out_of_stock: isOutOfStock,
  };
}

function buildSearchableTerms(product, classification) {
  const terms = [
    classification.normalized_title,
    classification.part_type,
    PART_LABELS[classification.part_type],
    classification.device_brand,
    classification.compatible_brand,
    classification.model_family,
    classification.model_base,
    classification.model_generation,
    classification.model_variant,
    classification.network_variant,
    classification.quality_tier,
    ...(classification.quality_signals || []),
    classification.color,
    classification.frame_status,
    product.sku,
    product.code,
    product.mpn,
    product.partNumber,
    product.part_number,
  ];
  return unique(terms.map(normalizeText).filter(Boolean));
}

function classifyCatalogProduct(product = {}) {
  const title = firstText([product.name, product.title, product.productName, product.description, product.model]);
  const fields = [
    title,
    product.description,
    product.shortDescription,
    product.short_description,
    product.model,
    product.brand,
    product.category,
    product.sku,
    product.code,
    product.mpn,
    product.partNumber,
    product.part_number,
  ];
  const normalized = normalizeText(fields.filter(Boolean).join(" "));
  const part = detectPartType(normalized);
  const brand = detectBrand(normalized, product.brand);
  const model = detectModel(normalized, brand.device_brand);
  const quality = detectQuality(` ${normalized} `);
  const frame = detectFrame(normalized);
  const color = detectColor(normalized);
  const stock = detectStock(product);
  const blockers = [];
  const reasons = [];
  if (!part.part_type) blockers.push("missing_part_type");
  else reasons.push(`part_type:${part.part_type}`);
  if (!brand.device_brand) blockers.push("missing_device_brand");
  else reasons.push(`brand:${brand.device_brand}`);
  if (!model.model_base) blockers.push("missing_model");
  else reasons.push(`model:${model.model_base}`);
  if (!quality.quality_tier) blockers.push("missing_quality");
  if (!color.color) blockers.push("missing_color");
  const confidenceParts = [
    part.confidence,
    brand.device_brand_confidence,
    model.model_base ? 0.9 : 0,
    quality.quality_tier ? 0.7 : 0.25,
    color.color ? 0.55 : 0.2,
  ];
  const classification_confidence = Number((confidenceParts.reduce((sum, n) => sum + n, 0) / confidenceParts.length).toFixed(3));
  const classification = {
    product_id: firstText([product.id, product.product_id, product.productId]),
    sku: firstText([product.sku, product.code]),
    mpn: firstText([product.mpn, product.partNumber, product.part_number]),
    public_slug: firstText([product.publicSlug, product.public_slug, product.slug]),
    normalized_title: normalizeText(title),
    part_type: part.part_type,
    part_type_confidence: Number(part.confidence.toFixed(3)),
    ...brand,
    ...model,
    model_code: detectModelCode(normalized),
    ...quality,
    ...frame,
    ...color,
    ...stock,
    searchable_terms: [],
    synonyms: part.part_type ? PART_TYPE_DICTIONARY[part.part_type].map(normalizeText) : [],
    blockers,
    classification_confidence,
    classification_reasons: reasons,
  };
  classification.searchable_terms = buildSearchableTerms(product, classification);
  return classification;
}

function parseCatalogQuery(query = "") {
  const normalized = normalizeText(query);
  const pseudoProduct = { name: query, title: query, description: query, brand: "" };
  const classification = classifyCatalogProduct(pseudoProduct);
  const tokens = unique(normalized.split(/\s+/).filter((token) => token && !STOPWORDS.has(token)));
  const modelCode = detectModelCode(normalized);
  return {
    original_query: query,
    normalized_query: normalized,
    tokens,
    part_type: classification.part_type,
    device_brand: classification.device_brand,
    model_base: classification.model_base,
    model_family: classification.model_family,
    model_generation: classification.model_generation,
    model_variant: classification.model_variant || "",
    network_variant: classification.network_variant || "",
    quality_tier: classification.quality_tier,
    color: classification.color,
    has_frame: classification.has_frame,
    model_code: modelCode,
    synonyms: classification.synonyms,
  };
}

module.exports = {
  PART_TYPE_DICTIONARY,
  PART_LABELS,
  BRAND_PATTERNS,
  COLORS,
  normalizeText,
  classifyCatalogProduct,
  parseCatalogQuery,
};
