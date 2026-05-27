const BRAND_ALIASES = [
  ["google_pixel", /\b(pixel|google pixel)\b/i],
  ["samsung", /\b(samsung|galaxy|sm-[a-z]\d+)/i],
  ["iphone", /\b(apple|iphone)\b/i],
  ["motorola", /\b(motorola|moto\s)/i],
  ["xiaomi", /\b(xiaomi|redmi|poco)\b/i],
  ["honor", /\bhonor\b/i],
  ["huawei", /\bhuawei\b/i],
  ["oneplus", /\boneplus\b/i],
  ["oppo", /\boppo\b/i],
  ["realme", /\brealme\b/i],
];

const SCREEN_TERMS = [
  /\bpart[_\s-]?type\s*[:=]?\s*display\b/i,
  /\b(display|screen|lcd|oled|amoled|super\s+amoled|pantalla|modulo|m[oó]dulo)\b/i,
  /\b(display|pantalla|modulo|m[oó]dulo)\s+(incl|excl|with|without|con|sin)\s+(frame|marco)\b/i,
  /\b(service\s*pack|original|compatible|hard\s*oled|soft\s*oled|incell|refurb(?:ished)?|pulled|jk).{0,24}\b(display|pantalla|modulo|m[oó]dulo)\b/i,
  /\brepair\s+kit\s+display\b/i,
];

const SCREEN_ACCESSORY_BLOCKERS = [
  ["display_adhesive", /\b(display|screen|lcd|oled|pantalla).{0,24}(adhesive|adhesivo|tape|cinta|sticker|gasket|seal|junta)\b/i],
  ["adhesive_display", /\b(adhesive|adhesivo|tape|cinta|sticker|gasket|seal|junta).{0,24}(display|screen|lcd|oled|pantalla)\b/i],
  ["bracket_display", /\bbracket.{0,20}(display|screen|pantalla|frame|marco)\b|\b(display|screen|pantalla|frame|marco).{0,20}bracket\b|\bsoporte\s+(?:de\s+)?(?:display|pantalla|marco)\b/i],
  ["screen_protector", /\b(screen\s+protector|protector\s+de\s+pantalla|tempered\s+glass|vidrio\s+templado|hydrogel|film)\b/i],
  ["case_cover", /\b(case|coverz|magsafe\s+case|funda|carcasa\s+protectora|snap)\b/i],
  ["sim_tray", /\b(sim\s+tray|keyset\s+simcard\s+tray|bandeja\s+sim)\b/i],
  ["antenna", /\b(antenna|antena|gps\s+antenna)\b/i],
  ["camera_lens", /\b(camera\s+lens|camera\s+glass|lente\s+c[aá]mara|cristal\s+c[aá]mara)\b/i],
  ["back_cover", /\b(back\s+glass|rear\s+cover|back\s+cover|battery\s+cover|tapa\s+trasera|vidrio\s+trasero)\b/i],
  ["battery", /\b(battery|bateria|bater[ií]a)\b/i],
  ["charging", /\b(dock\s+connector|charging\s+board|usb\s+board|pin\s+de\s+carga|placa\s+de\s+carga)\b/i],
  ["audio", /\b(speaker|earpiece|microphone|parlante|auricular|micr[oó]fono)\b/i],
  ["small_part", /\b(vibrator|sensor|button|flex\s+cable|flex)\b/i],
];

const ADHESIVE_TERMS = [
  /\b(display|screen|lcd|oled|pantalla).{0,32}(adhesive|adhesivo|tape|cinta|sticker|gasket|seal|junta)\b/i,
  /\b(adhesive|adhesivo|tape|cinta|sticker|gasket|seal|junta).{0,32}(display|screen|lcd|oled|pantalla)\b/i,
  /\brepair\s+kit\s+adhesive\b/i,
];

const NON_SCREEN_ADHESIVE_BLOCKERS = [
  ["battery_adhesive", /\b(battery|bateria|bater[ií]a).{0,24}(adhesive|adhesivo|tape|cinta)\b|\b(adhesive|adhesivo|tape|cinta).{0,24}(battery|bateria|bater[ií]a)\b/i],
  ["back_cover_adhesive", /\b(back|rear|battery)\s+cover.{0,24}(adhesive|tape)\b|\b(tapa|vidrio)\s+trasera.{0,24}(adhesivo|cinta)\b/i],
  ["camera_adhesive", /\b(camera|lens|c[aá]mara|lente).{0,24}(adhesive|adhesivo|tape|cinta)\b/i],
  ["audio_adhesive", /\b(speaker|microphone|parlante|micr[oó]fono).{0,24}(adhesive|adhesivo|tape|cinta)\b/i],
];

const QUALITY_PATTERNS = [
  ["service_pack", /\bservice\s*pack\b/i],
  ["hard_oled", /\bhard\s*oled\b/i],
  ["soft_oled", /\bsoft\s*oled\b|soft\s+factory\b/i],
  ["amoled", /\bamoled|super\s+amoled\b/i],
  ["lcd", /\blcd\b/i],
  ["incell", /\bincell|in-cell\b/i],
  ["refurbished", /\brefurb(?:ished)?\b/i],
  ["pulled_a", /\bpulled\s*a\b/i],
  ["pulled_b", /\bpulled\s*b\b/i],
  ["pulled_c", /\bpulled\s*c\b/i],
  ["pulled", /\bpulled\b/i],
  ["jk", /\bjk\b/i],
  ["original", /\boriginal\b/i],
  ["compatible", /\bcompatible|compat\b/i],
  ["high_quality", /\bhigh\s+quality|alta\s+calidad\b/i],
];

function norm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function textOf(product = {}) {
  let raw = {};
  if (product.raw_json && typeof product.raw_json === "string") {
    try {
      raw = JSON.parse(product.raw_json);
    } catch {
      raw = {};
    }
  }
  return [
    product.part_type,
    product.category,
    product.title,
    product.name,
    product.description,
    product.short_description,
    product.sku,
    product.mpn,
    product.part_number,
    product.brand,
    product.model,
    product.device_brand,
    product.model_base,
    raw.part_type,
    raw.category,
    raw.title,
    raw.name,
    raw.description,
    raw.short_description,
    raw.sku,
    raw.mpn,
    raw.part_number,
    raw.brand,
    raw.model,
    raw.device_brand,
    raw.model_base,
  ].filter(Boolean).join(" ");
}

function detectBrand(text, product = {}) {
  const existing = norm(product.device_brand || product.compatible_brand || product.brand || "");
  if (existing) {
    if (/apple|iphone/.test(existing)) return "iphone";
    if (/google|pixel/.test(existing)) return "google_pixel";
    return existing.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "otros";
  }
  for (const [brand, pattern] of BRAND_ALIASES) {
    if (pattern.test(text)) return brand;
  }
  return "";
}

function detectModel(text, product = {}) {
  const existing = norm(product.model_base || product.model || "");
  if (existing) return existing;
  const patterns = [
    /\biphone\s+\d{1,2}(?:\s+(?:pro\s+max|pro|plus|mini|air))?/i,
    /\bgalaxy\s+[a-z]\d{1,3}(?:\s*5g|\s*4g)?(?:\s+plus|\s+ultra)?/i,
    /\b(?:redmi\s+note|redmi|poco|pixel|honor|huawei|moto)\s+[a-z0-9 ]{1,20}/i,
    /\bsm-[a-z]\d{3,}[a-z]?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return norm(match[0]);
  }
  return "";
}

function detectQuality(text, product = {}) {
  const existing = norm(product.quality_tier || "");
  if (existing) return existing;
  for (const [quality, pattern] of QUALITY_PATTERNS) {
    if (pattern.test(text)) return quality;
  }
  return "";
}

function detectAdhesiveType(text) {
  if (/\bgasket|junta\b/i.test(text)) return "gasket";
  if (/\bseal|sello\b/i.test(text)) return "seal";
  if (/\btape|cinta\b/i.test(text)) return "tape";
  if (/\bsticker\b/i.test(text)) return "sticker";
  return "adhesive";
}

function hasFrame(text, product = {}) {
  if (product.has_frame === true || Number(product.has_frame) === 1) return true;
  if (product.has_frame === false || Number(product.has_frame) === 0) return false;
  if (/\b(with|incl|con)\s+(frame|marco)\b|\b(con\s+marco)\b/i.test(text)) return true;
  if (/\b(without|excl|sin)\s+(frame|marco)\b|\b(sin\s+marco)\b/i.test(text)) return false;
  return null;
}

function isRealScreenProduct(product = {}) {
  const text = textOf(product);
  const normalized = norm(text);
  const reasons = [];
  const blockers = [];
  let excludedAsAccessory = false;
  let excludeReason = "";

  const adhesive = isScreenAdhesiveProduct(product);
  if (adhesive.isScreenAdhesive) {
    excludedAsAccessory = true;
    excludeReason = "display_adhesive";
    blockers.push("likelyAccessory");
  }
  for (const [reason, pattern] of SCREEN_ACCESSORY_BLOCKERS) {
    if (pattern.test(text)) {
      excludedAsAccessory = true;
      excludeReason = excludeReason || reason;
      blockers.push(reason);
      break;
    }
  }

  let confidence = 0;
  if (norm(product.part_type) === "display") {
    confidence += 0.55;
    reasons.push("part_type_display");
  }
  for (const pattern of SCREEN_TERMS) {
    if (pattern.test(text)) {
      confidence += 0.18;
      reasons.push(`term:${String(pattern).slice(1, 24)}`);
    }
  }
  if (/\brepair\s+kit\s+display\b/i.test(text)) confidence += 0.15;
  if (detectModel(text, product)) confidence += 0.1;
  if (detectBrand(text, product)) confidence += 0.08;
  confidence = Math.min(0.99, confidence);
  const isScreen = confidence >= 0.35 && !excludedAsAccessory;
  if (!isScreen && !excludedAsAccessory) blockers.push("notRealScreen");
  return {
    isScreen,
    confidence,
    screenType: hasFrame(text, product) === true ? "display_with_frame" : hasFrame(text, product) === false ? "display_without_frame" : "display",
    qualityTier: detectQuality(text, product),
    hasFrame: hasFrame(text, product),
    deviceBrand: detectBrand(text, product),
    modelBase: detectModel(text, product),
    reasons,
    blockers,
    excludedAsAccessory,
    excludeReason,
  };
}

function isScreenAdhesiveProduct(product = {}) {
  const text = textOf(product);
  const reasons = [];
  const blockers = [];
  let excludedReason = "";
  for (const [reason, pattern] of NON_SCREEN_ADHESIVE_BLOCKERS) {
    if (pattern.test(text)) {
      excludedReason = reason;
      blockers.push(reason);
      break;
    }
  }
  let confidence = 0;
  if (norm(product.part_type) === "display_adhesive") {
    confidence += 0.6;
    reasons.push("part_type_display_adhesive");
  }
  if (norm(product.adhesive_context) === "display") {
    confidence += 0.3;
    reasons.push("adhesive_context_display");
  }
  for (const pattern of ADHESIVE_TERMS) {
    if (pattern.test(text)) {
      confidence += 0.25;
      reasons.push(`term:${String(pattern).slice(1, 24)}`);
    }
  }
  const modelBase = detectModel(text, product);
  if (modelBase) confidence += 0.08;
  const adhesiveType = detectAdhesiveType(text);
  if (!modelBase && /\b(universal|generic|generico|gen[eé]rico)\b/i.test(text)) {
    excludedReason = excludedReason || "genericAdhesiveWithoutModel";
    blockers.push("genericAdhesiveWithoutModel");
  }
  confidence = Math.min(0.99, confidence);
  const isScreenAdhesive = confidence >= 0.3 && !excludedReason;
  if (!isScreenAdhesive && !excludedReason) blockers.push("notScreenAdhesive");
  return {
    isScreenAdhesive,
    confidence,
    adhesiveType,
    deviceBrand: detectBrand(text, product),
    modelBase,
    reasons,
    blockers,
    excludedReason,
  };
}

module.exports = {
  isRealScreenProduct,
  isScreenAdhesiveProduct,
  normalizeClassifierText: norm,
};
