const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const sqlite3 = require("sqlite3");
const productsStreamRepo = require("./productsStreamRepo");
const { dataPath } = require("../utils/dataDir");

const PRODUCTS_JSON_PATH = dataPath("products.json");
const SQLITE_PATH = dataPath("products.sqlite");
const MANIFEST_PATH = dataPath("products.manifest.json");
const OVERRIDES_PATH = dataPath("products.overrides.json");
const COUNT_CACHE_TTL_MS = 60_000;
const PRODUCTS_SQLITE_SCHEMA_VERSION = 5;
const CATALOG_MAPPING_VERSION = 2;
const BULK_PUBLISH_CHUNK_SIZE = 1000;
const SEARCH_RANK_CANDIDATE_LIMIT = 1200;

const REJECTED_STATE_VALUES = new Set([
  "hidden",
  "private",
  "draft",
  "disabled",
  "archived",
  "deleted",
]);
const PUBLIC_DESCRIPTION_FALLBACK =
  "Producto disponible para cotización. Consultanos por compatibilidad, stock y condiciones.";

let dbInstance = null;
let ftsEnabled = false;
let dbReadyPromise = null;
let dbReady = false;
let rebuildPromise = null;
const countCache = new Map();
const SQLITE_CORRUPT_CODE = "CATALOG_SQLITE_CORRUPT";
const catalogState = {
  ready: false,
  initializing: false,
  rebuilding: false,
  corruptDetected: false,
  lastError: null,
  lastErrorAt: null,
  lastReadyAt: null,
  lastRebuildStartedAt: null,
  lastRebuildFinishedAt: null,
  lastRebuildDurationMs: null,
};

function catalogStateSnapshot() {
  return { ...catalogState };
}

function setCatalogError(error, context = {}) {
  const forcedCode = context.code || null;
  const isCorrupt = forcedCode === SQLITE_CORRUPT_CODE || isSqliteCorruptionError(error);
  catalogState.lastError = {
    message: String(error?.message || error || "unknown_error"),
    code: forcedCode || error?.code || null,
    reason: context.reason || error?.reason || null,
    phase: context.phase || null,
    stack: error?.stack || null,
  };
  catalogState.lastErrorAt = new Date().toISOString();
  catalogState.ready = false;
  catalogState.corruptDetected = Boolean(isCorrupt);
}

function clearCatalogError() {
  catalogState.lastError = null;
  catalogState.lastErrorAt = null;
  catalogState.corruptDetected = false;
}

function isSqliteCorruptionError(error) {
  const msg = String(error?.message || error || "");
  return /SQLITE_CORRUPT|database disk image is malformed|SQLITE_NOTADB|file is not a database/i.test(msg);
}

function markSqliteCorruption(error, context = {}) {
  console.error("[products-db] sqlite corrupt detected", error?.message || error);
  setCatalogError(error, { ...context, code: SQLITE_CORRUPT_CODE });
}

async function closeDbInstance() {
  if (!dbInstance) return;
  await new Promise((resolve) => dbInstance.close(() => resolve()));
  dbInstance = null;
}

async function safeMoveOrDelete(filePath, suffix) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.corrupt-${suffix}`;
  try {
    await fsp.rename(filePath, backupPath);
    return backupPath;
  } catch (error) {
    try {
      await fsp.unlink(filePath);
      return null;
    } catch {
      throw error;
    }
  }
}

async function backupAndRemoveSqliteFiles({ suffix = Date.now() } = {}) {
  const backups = [];
  const files = [SQLITE_PATH, `${SQLITE_PATH}-wal`, `${SQLITE_PATH}-shm`];
  for (const filePath of files) {
    const movedTo = await safeMoveOrDelete(filePath, suffix);
    if (movedTo) backups.push({ from: filePath, to: movedTo });
  }
  return backups;
}

async function runIntegrityCheck(db) {
  const row = await get(db, "PRAGMA integrity_check");
  const value = row ? Object.values(row)[0] : null;
  if (value !== "ok") {
    throw new Error(`SQLITE_INTEGRITY_CHECK_FAILED: ${JSON.stringify(row || null)}`);
  }
}

function normalizeQueryText(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!text) return "";
  try {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    return text;
  }
}

const MOJIBAKE_MAP = [
  ["Ã³", "o"], ["Ã¡", "a"], ["Ã©", "e"], ["Ã­", "i"], ["Ãº", "u"], ["Ã±", "n"], ["Ã¼", "u"],
  ["â", "'"], ["â", "\""], ["â", "\""], ["Â", ""],
];

function normalizeSearchText(value) {
  let text = String(value || "");
  for (const [wrong, ok] of MOJIBAKE_MAP) {
    text = text.split(wrong).join(ok);
  }
  text = normalizeQueryText(text)
    .replace(/[_/\\|]+/g, " ")
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function tokenWithoutHyphen(token = "") {
  return String(token || "").replace(/-/g, "");
}


const APPLE_IPHONE_GENERATIONS = new Set(["11", "12", "13", "14", "15", "16", "17"]);
const APPLE_VARIANT_ORDER = ["pro max", "mini", "plus", "pro", "air"];
const APPLE_VARIANT_PENALTIES = {
  base: { pro: -350, mini: -600, "pro max": -700, plus: -500, air: -500 },
  mini: { base: -500, pro: -700, "pro max": -800, plus: -700, air: -700 },
  pro: { base: -300, "pro max": -500, mini: -800, plus: -700, air: -700 },
  "pro max": { pro: -500, base: -700, mini: -900, plus: -800, air: -800 },
  plus: { base: -500, pro: -700, "pro max": -800, mini: -800, air: -700 },
  air: { base: -500, pro: -700, "pro max": -800, mini: -800, plus: -700 },
};

function uniqueValues(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function tokenizeSearch(value = "") {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const PRODUCT_TYPE_DICT = {
  display: ["pantalla","pantallas","modulo","modulo pantalla","modulo display","display","screen","lcd","oled","amoled","super amoled","tactil","touch","glass","display incl frame","display excl frame","assembly"],
  battery: ["bateria","baterias","battery","batteries","pila","accu","acumulador"],
  charging: ["pin de carga","placa de carga","puerto de carga","centro de carga","conector de carga","charging","charging board","charging connector","charge port","dock connector","usb connector","connector usb","usb board","sub board","daughterboard"],
  back_cover: ["tapa","tapa trasera","vidrio trasero","carcasa","carcasa trasera","back glass","rear cover","back cover","battery cover","housing"],
  camera: ["camara","camera","rear camera","front camera","camera lens","lente camara","camara frontal","camara trasera","lens"],
  flex: ["flex","flex cable","main flex","cable flex","flex principal","interconnection flex"],
  speaker: ["parlante","speaker","loud speaker","ear speaker","altavoz","auricular interno"],
  sim_tray: ["bandeja sim","sim tray","charola sim","porta sim","card tray"],
  adhesive: ["adhesivo","adhesive","adhesive tape","display adhesive","rear cover adhesive","battery adhesive","gasket","seal","pegamento","cinta","cinta adhesiva","sticker","tape"],
  vibration: ["vibrador","vibration motor","motor vibrador"],
  sensor: ["sensor","proximity sensor","sensor proximidad","huella","fingerprint"],
  button: ["boton","power button","volume button","key","slider key"],
  component: ["ic","chip","componente","componentes electronicos","antenna","antena","board","placa","sub board","daughterboard"],
};

const PART_INTENT_PRIORITY = [
  "charging",
  "adhesive",
  "battery",
  "back_cover",
  "display",
  "camera",
  "flex",
  "speaker",
  "sim_tray",
  "vibration",
  "sensor",
  "button",
  "component",
];

const RELATED_PART_TYPES = {
  display: new Set(["adhesive"]),
  adhesive: new Set(["display", "back_cover", "battery"]),
  charging: new Set(["component", "flex"]),
  component: new Set(["charging", "sensor", "button"]),
  speaker: new Set(["flex"]),
  camera: new Set(["flex"]),
  back_cover: new Set(["adhesive"]),
};

const PRODUCT_TYPE_SEARCH_EQUIVALENTS = new Map(
  Object.values(PRODUCT_TYPE_DICT).flatMap((terms) => {
    const normalizedTerms = uniqueValues(terms.map(normalizeSearchText));
    return normalizedTerms.map((term) => [term, normalizedTerms]);
  }),
);

const SEARCH_STOPWORDS = new Set(["de", "del", "la", "el", "para", "for", "con", "y"]);

function inferReplacementType(text = "") {
  const normalized = normalizeSearchText(text);
  const matches = new Set();
  for (const [key, terms] of Object.entries(PRODUCT_TYPE_DICT)) {
    if (terms.some((term) => normalized.includes(normalizeSearchText(term)))) matches.add(key);
  }
  return PART_INTENT_PRIORITY.find((key) => matches.has(key)) || "";
}

function getPartTypeSynonyms(partType = "") {
  return PRODUCT_TYPE_DICT[partType] ? uniqueValues(PRODUCT_TYPE_DICT[partType].map(normalizeSearchText)) : [];
}

function expandTechnicalQuery(normalizedQuery = "") {
  const tokens = tokenizeSearch(normalizedQuery);
  const intentPartType = inferReplacementType(normalizedQuery);
  const appliedSynonyms = {};
  const expandedTerms = [...tokens];
  if (intentPartType) {
    const synonyms = getPartTypeSynonyms(intentPartType);
    appliedSynonyms[intentPartType] = synonyms;
    expandedTerms.push(...synonyms);
  }
  return {
    intentPartType,
    appliedSynonyms,
    expandedTerms: uniqueValues(expandedTerms.map(normalizeSearchText).filter(Boolean)),
  };
}

function extractModelPhrase(text = "") {
  const normalized = normalizeQueryText(text);
  const patterns = [/iphone\s+\d+\s+pro\s+max/, /iphone\s+\d+\s+mini/, /iphone\s+\d+\s+plus/, /iphone\s+\d+\s+air/, /iphone\s+\d+\s+pro/, /iphone\s+\d+/, /galaxy\s+s\d+\s+ultra/, /galaxy\s+[as]\d+/, /sm-s\d{3,}/];
  for (const pattern of patterns) {
    const matched = normalized.match(pattern);
    if (matched) return matched[0];
  }
  return "";
}

function extractSkuOrMpn(text = "") {
  const normalized = normalizeQueryText(text);
  const match = normalized.match(/\b(?:gh\d{2}-\d{4,}[a-z]?|sm-s\d{3,}|[a-z]{2,}\d{2,}-\d{2,}[a-z]?)\b/i);
  return match ? match[0].toLowerCase() : "";
}

function normalizeAppleModelText(value = "") {
  return normalizeQueryText(value)
    .replace(/\biphone\s*(1[1-7])\s*(promax)\b/g, "iphone $1 pro max")
    .replace(/\biphone\s*(1[1-7])\s*(pro|max|mini|plus|air)\b/g, "iphone $1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function toAppleModel(generation, variant = "base") {
  const safeGeneration = String(generation || "").trim();
  if (!APPLE_IPHONE_GENERATIONS.has(safeGeneration)) return null;
  const normalizedVariant = normalizeQueryText(variant || "base").replace(/\s+/g, " ") || "base";
  const safeVariant = normalizedVariant === "max" ? "pro max" : normalizedVariant;
  const finalVariant = APPLE_VARIANT_ORDER.includes(safeVariant) ? safeVariant : "base";
  const exactModel = finalVariant === "base" ? `iphone ${safeGeneration}` : `iphone ${safeGeneration} ${finalVariant}`;
  return {
    brand: "apple",
    family: "iphone",
    generation: safeGeneration,
    variant: finalVariant,
    exactModel,
  };
}

function parseAppleModel(text = "") {
  const models = extractAppleModels(text);
  return models[0] || null;
}

function extractAppleModels(text = "") {
  const normalized = normalizeAppleModelText(text);
  if (!normalized) return [];
  const models = [];
  const regex = /\biphone\s*(11|12|13|14|15|16|17)(?:\s+(pro\s+max|mini|plus|pro|air))?\b/g;
  let match;
  while ((match = regex.exec(normalized))) {
    const model = toAppleModel(match[1], match[2] || "base");
    if (model && !models.some((entry) => entry.exactModel === model.exactModel)) {
      models.push(model);
    }
  }
  return models;
}

function parseRawProductJson(product = {}) {
  if (!product || typeof product !== "object") return {};
  if (product.raw_json && typeof product.raw_json === "string") {
    try {
      return JSON.parse(product.raw_json || "{}");
    } catch {
      return {};
    }
  }
  return {};
}

function joinProductFields(product = {}, aliases = []) {
  const raw = parseRawProductJson(product);
  return aliases
    .map((alias) => getField(product, [alias]) ?? getField(raw, [alias]))
    .filter((value) => value !== undefined && value !== null)
    .join(" ");
}

function getProductAppleModelInfo(product = {}) {
  const primaryText = joinProductFields(product, [
    "name",
    "title",
    "product_title",
    "model",
    "catalog_model",
    "mpn",
    "MPN",
    "partNumber",
    "part_number",
    "sku",
    "code",
  ]);
  const secondaryText = joinProductFields(product, [
    "description",
    "shortDescription",
    "short_description",
    "compatibility",
    "compatibleModels",
    "compatible_models",
    "search_text",
  ]);
  const primaryModels = extractAppleModels(primaryText);
  const allModels = uniqueValues([...primaryModels, ...extractAppleModels(secondaryText)].map((model) => model.exactModel))
    .map((exactModel) => [...primaryModels, ...extractAppleModels(secondaryText)].find((model) => model.exactModel === exactModel))
    .filter(Boolean);
  return {
    productAppleModel: primaryModels[0] || allModels[0] || null,
    compatibleAppleModels: allModels,
  };
}

function inferBrand(text = "") {
  const normalized = normalizeQueryText(text);
  if (/\b(apple|iphone)\b/.test(normalized)) return "apple";
  if (/\b(samsung|galaxy|sm-[a-z0-9]+)\b/.test(normalized)) return "samsung";
  if (/\b(xiaomi|redmi|poco)\b/.test(normalized)) return "xiaomi";
  if (/\b(huawei)\b/.test(normalized)) return "huawei";
  if (/\b(honor)\b/.test(normalized)) return "honor";
  if (/\b(oneplus|one plus)\b/.test(normalized)) return "oneplus";
  if (/\b(motorola|moto)\b/.test(normalized)) return "motorola";
  return "";
}

function isSameAppleModel(a, b) {
  return Boolean(a && b && a.exactModel === b.exactModel);
}

function isAppleVariantMismatch(queryModel, productModel) {
  return Boolean(
    queryModel &&
      productModel &&
      queryModel.family === "iphone" &&
      productModel.family === "iphone" &&
      queryModel.generation === productModel.generation &&
      queryModel.variant !== productModel.variant,
  );
}

function getAppleVariantPenalty(queryModel, productModel) {
  if (!isAppleVariantMismatch(queryModel, productModel)) return 0;
  return APPLE_VARIANT_PENALTIES[queryModel.variant]?.[productModel.variant] ?? -700;
}

function hasExactAppleTitlePhrase(queryModel, titleText = "") {
  if (!queryModel) return false;
  const normalized = normalizeAppleModelText(titleText);
  if (!normalized) return false;
  const prefix = "(?:apple\\s+)?iphone\\s+";
  const variant = queryModel.variant === "base" ? "" : `\\s+${queryModel.variant.replace(/\s+/g, "\\s+")}`;
  const blockedNextVariant =
    queryModel.variant === "base"
      ? "(?!\\s+(?:mini|plus|pro|air))"
      : queryModel.variant === "pro"
        ? "(?!\\s+max)"
        : "";
  const pattern = new RegExp(`\\b${prefix}${queryModel.generation}${variant}${blockedNextVariant}\\b`);
  return pattern.test(normalized);
}

function addScoreReason(state, label, value) {
  if (!value) return;
  state.score += value;
  if (state.debug) state.reasons.push({ label, score: value });
}

function computeSearchIntent(query = "") {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = tokenizeSearch(normalizedQuery);
  const technicalExpansion = expandTechnicalQuery(normalizedQuery);
  const appleModel = parseAppleModel(normalizedQuery);
  const exactCodes = tokens.filter((token) => /[a-z]{1,4}\d{2,}(-[a-z0-9]{2,})?/i.test(token));
  const noHyphenCodes = exactCodes.map(tokenWithoutHyphen);
  const compatibleIntent = /\b(for|compatible|generico|replacement)\b/.test(normalizedQuery);
  const originalIntent = /\b(original|oem|service pack|genuine)\b/.test(normalizedQuery);
  const compatibleBrandIntentMatch = normalizedQuery.match(/\bfor\s+([a-z0-9]+)\b/);
  const compatibleBrandIntent = compatibleBrandIntentMatch ? compatibleBrandIntentMatch[1] : "";
  const productTypeIntent = technicalExpansion.intentPartType;
  return {
    originalQuery: query,
    normalizedQuery,
    expandedTerms: technicalExpansion.expandedTerms,
    appliedSynonyms: technicalExpansion.appliedSynonyms,
    intentPartType: technicalExpansion.intentPartType,
    tokens,
    exactCodes,
    noHyphenCodes,
    brand:
      inferBrand(normalizedQuery) ||
      tokens.find((token) => ["iphone", "apple", "samsung", "galaxy", "xiaomi", "huawei", "honor", "oneplus", "motorola"].includes(token)) ||
      "",
    compatibleBrandIntent,
    compatibleIntent,
    originalIntent,
    productTypeIntent,
    modelPhrase: extractModelPhrase(normalizedQuery),
    appleModel,
    replacementType: technicalExpansion.intentPartType,
    skuOrMpn: extractSkuOrMpn(normalizedQuery),
    importantTokens: tokens.filter((token) => token.length >= 3),
  };
}

function scoreProductAgainstIntent(product = {}, intent = {}, options = {}) {
  if (!intent?.normalizedQuery) {
    return options?.debug ? { score: 0, reasons: [] } : 0;
  }
  const haystack = normalizeSearchText([
    getField(product, ["id", "sku", "code", "partNumber", "mpn", "ean", "gtin", "supplier_code"]),
    getField(product, ["name", "title", "description", "shortDescription", "short_description"]),
    getField(product, ["brand", "marca"]),
    getField(product, ["model", "modelo"]),
    getField(product, ["category", "categoria", "productType"]),
    getField(product, ["search_text"]),
  ].join(" "));
  const state = { score: 0, reasons: [], debug: Boolean(options?.debug) };
  const raw = parseRawProductJson(product);
  const titleText = joinProductFields(product, ["name", "title", "product_title"]);
  const brandRaw = normalizeSearchText(getField(product, ["brand", "marca"]));
  const isCompatibleBrand = brandRaw.startsWith("for ");
  const compatibleBrand = isCompatibleBrand ? brandRaw.replace(/^for\s+/, "") : "";
  const productBrand = inferBrand([
    haystack,
    getField(product, ["brand", "marca"]),
    getField(raw, ["brand", "marca", "manufacturer"]),
  ].join(" "));
  const productType = inferReplacementType(haystack);
  const { productAppleModel, compatibleAppleModels } = getProductAppleModelInfo(product);
  const hasCompatibleExactAppleModel = Boolean(
    intent.appleModel &&
      compatibleAppleModels.some((model) => isSameAppleModel(intent.appleModel, model)) &&
      !isSameAppleModel(intent.appleModel, productAppleModel),
  );

  if (intent.skuOrMpn && haystack.includes(intent.skuOrMpn)) addScoreReason(state, "sku/mpn exacto", 1800);
  for (const code of intent.exactCodes || []) {
    if (haystack.includes(code)) addScoreReason(state, `codigo exacto ${code}`, 1500);
  }
  for (const code of intent.noHyphenCodes || []) {
    if (tokenWithoutHyphen(haystack).includes(code)) addScoreReason(state, `codigo sin guion ${code}`, 800);
  }
  if (intent.modelPhrase && haystack.includes(intent.modelPhrase)) addScoreReason(state, "frase de modelo presente", 250);
  if (intent.intentPartType || intent.replacementType) {
    const wantedType = intent.intentPartType || intent.replacementType;
    if (productType === wantedType) addScoreReason(state, `partType ${wantedType}`, 1200);
    else if (RELATED_PART_TYPES[wantedType]?.has(productType)) addScoreReason(state, `tipo relacionado ${productType} con ${wantedType}`, 300);
    else if (productType) addScoreReason(state, `tipo incorrecto ${productType} vs ${wantedType}`, -800);
  }
  if (intent.brand) {
    if (intent.brand === "apple" || intent.tokens?.some((token) => token === "iphone" || token === "apple")) {
      if (productBrand === "apple" || productAppleModel) addScoreReason(state, "marca apple", 500);
      else addScoreReason(state, "marca no apple", -700);
    } else if (productBrand === intent.brand || haystack.includes(intent.brand)) {
      addScoreReason(state, `marca ${intent.brand}`, isCompatibleBrand ? 220 : 350);
    } else if (!compatibleBrand.includes(intent.brand)) {
      addScoreReason(state, `marca distinta de ${intent.brand}`, -500);
    }
  }
  if (intent.compatibleBrandIntent && compatibleBrand === intent.compatibleBrandIntent) {
    addScoreReason(state, `marca compatible ${compatibleBrand}`, 450);
  }
  if (intent.compatibleIntent && isCompatibleBrand) addScoreReason(state, "producto compatible solicitado", 500);
  if (intent.originalIntent && !isCompatibleBrand) addScoreReason(state, "producto original solicitado", 500);
  if (intent.originalIntent && isCompatibleBrand) addScoreReason(state, "compatible penalizado ante original", -700);
  if (intent.appleModel) {
    if (productAppleModel?.generation === intent.appleModel.generation || hasCompatibleExactAppleModel) {
      addScoreReason(state, `generacion iphone ${intent.appleModel.generation}`, 900);
    } else if (productAppleModel?.generation) {
      addScoreReason(state, `generacion incorrecta iphone ${productAppleModel.generation}`, -900);
    }

    if (isSameAppleModel(intent.appleModel, productAppleModel)) {
      addScoreReason(state, `modelo exacto ${intent.appleModel.exactModel}`, 1500);
    } else if (hasCompatibleExactAppleModel) {
      addScoreReason(state, `compatibilidad explicita ${intent.appleModel.exactModel}`, 450);
    } else if (isAppleVariantMismatch(intent.appleModel, productAppleModel)) {
      addScoreReason(
        state,
        `variante distinta ${productAppleModel.variant} vs ${intent.appleModel.variant}`,
        getAppleVariantPenalty(intent.appleModel, productAppleModel),
      );
    }

    if (hasExactAppleTitlePhrase(intent.appleModel, titleText)) {
      addScoreReason(state, "frase exacta en titulo", 1000);
    }
  }
  const allImportantPresent = intent.importantTokens.length > 0 && intent.importantTokens.every((token) => haystack.includes(token));
  if (allImportantPresent) addScoreReason(state, "tokens importantes presentes", 200);
  else if (intent.importantTokens.some((token) => haystack.includes(token))) addScoreReason(state, "tokens importantes parciales", 50);
  if (intent.modelPhrase.includes("iphone") && !haystack.includes(intent.modelPhrase)) {
    const target = intent.modelPhrase.match(/iphone\s+(\d+)/);
    const candidate = haystack.match(/iphone\s+(\d+)/);
    if (target && candidate && target[1] !== candidate[1]) addScoreReason(state, "modelo iphone numericamente distinto", -500);
    if (intent.modelPhrase.includes("pro") && !intent.modelPhrase.includes("pro max") && haystack.includes(`${intent.modelPhrase} max`)) addScoreReason(state, "pro max no solicitado", -500);
  }
  const stock = Number(getField(product, ["stock"]));
  const availabilityText = normalizeSearchText(
    [
      getField(product, ["availability", "disponibilidad", "estado_stock"]),
      getField(product, ["stock_mode", "stockMode", "fulfillment_mode", "fulfillmentMode"]),
      getField(raw, ["availability", "disponibilidad", "estado_stock", "stock_mode", "fulfillment_mode"]),
    ].join(" "),
  );
  if (Number.isFinite(stock) && stock > 0) addScoreReason(state, "stock real disponible", 500);
  else if (/preorder|backorder|pedido|remote|remoto/.test(availabilityText)) addScoreReason(state, "producto a pedido debajo de stock real", -120);
  else addScoreReason(state, "sin stock debajo de alternativas disponibles", -300);
  if (!options?.debug) return state.score;
  return {
    score: state.score,
    reasons: state.reasons,
    queryModel: intent.appleModel || null,
    productModel: productAppleModel || null,
    productVariant: productAppleModel?.variant || null,
    compatibleAppleModels,
    productType,
    productBrand,
  };
}

function rankRowsBySearchIntent(rows = [], intent = {}, { preferPositiveScores = false } = {}) {
  if (!Array.isArray(rows) || rows.length === 0 || !intent?.normalizedQuery) return [];
  const ranked = rows.map((row, index) => {
    const debug = scoreProductAgainstIntent(row, intent, { debug: true });
    return { row, score: debug.score, index, debug };
  });
  ranked.sort((a, b) => b.score - a.score || Number(a.row.rowid || 0) - Number(b.row.rowid || 0) || a.index - b.index);
  if (!preferPositiveScores) return ranked;
  const positives = ranked.filter((entry) => entry.score > 0);
  const nonPositives = ranked.filter((entry) => entry.score <= 0);
  return positives.concat(nonPositives);
}

function getSearchDebugForRankedEntries(ranked = [], intent = {}, limit = 24) {
  return ranked.slice(0, Math.max(1, Math.min(100, Number(limit) || 24))).map((entry, position) => ({
    position: position + 1,
    queryOriginal: intent.originalQuery || "",
    queryNormalized: intent.normalizedQuery || "",
    queryExpanded: intent.expandedTerms || [],
    appliedSynonyms: intent.appliedSynonyms || {},
    intentPartType: intent.intentPartType || "",
    queryBrand: intent.brand || "",
    id: entry.row?.id || null,
    sku: entry.row?.sku || null,
    code: entry.row?.code || null,
    title: entry.row?.name || entry.row?.title || null,
    model: entry.row?.model || null,
    score: entry.score,
    queryModel: intent.appleModel || null,
    productModel: entry.debug?.productModel || null,
    variant: entry.debug?.productVariant || null,
    compatibleAppleModels: entry.debug?.compatibleAppleModels || [],
    productType: entry.debug?.productType || "",
    productBrand: entry.debug?.productBrand || "",
    reasons: entry.debug?.reasons || [],
  }));
}

function expandSearchTokenForSynonyms(token = "") {
  const normalized = normalizeQueryText(token);
  return uniqueValues(PRODUCT_TYPE_SEARCH_EQUIVALENTS.get(normalized) || [normalized]);
}

function splitSearchTerms(values = []) {
  return uniqueValues(values
    .flatMap((term) => normalizeSearchText(term).split(/\s+/))
    .map((term) => term.trim())
    .filter((term) => term && !SEARCH_STOPWORDS.has(term)));
}

function buildSearchTermGroups(normalizedSearch = "") {
  const intent = computeSearchIntent(normalizedSearch);
  const tokens = tokenizeSearch(normalizedSearch).filter((token) => !SEARCH_STOPWORDS.has(token));
  if (!intent.intentPartType) return tokens.map((token) => expandSearchTokenForSynonyms(token));
  const synonymTerms = getPartTypeSynonyms(intent.intentPartType);
  const synonymTokenSet = new Set(splitSearchTerms(synonymTerms));
  const groups = [splitSearchTerms(synonymTerms)];
  tokens
    .filter((token) => !synonymTokenSet.has(token))
    .forEach((token) => groups.push(expandSearchTokenForSynonyms(token)));
  return groups.filter((group) => group.length);
}

function buildFtsQueryFromSearch(normalizedSearch = "") {
  const groups = buildSearchTermGroups(normalizedSearch);
  return groups
    .map((token) => {
      const equivalents = (Array.isArray(token) ? token : expandSearchTokenForSynonyms(token))
        .map((term) => term.replace(/[^a-z0-9\s-]/gi, " ").trim())
        .filter(Boolean)
        .flatMap((term) => term.split(/\s+/).filter(Boolean));
      const unique = uniqueValues(equivalents);
      if (unique.length <= 1) return `${unique[0] || token}*`;
      return `(${unique.map((value) => `${value}*`).join(" OR ")})`;
    })
    .join(" AND ");
}

function addLikeSearchConditions(where, params, normalizedSearch = "") {
  const groups = buildSearchTermGroups(normalizedSearch);
  groups.forEach((token) => {
    const equivalents = Array.isArray(token) ? token : expandSearchTokenForSynonyms(token);
    where.push(`(${equivalents.map(() => "search_text LIKE ?").join(" OR ")})`);
    equivalents.forEach((term) => params.push(`%${term}%`));
  });
}

function boolToInt(value, fallback = 0) {
  if (value === true) return 1;
  if (value === false) return 0;
  return fallback;
}

function toNullableText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeFieldKey(value) {
  const base = toNullableText(value);
  if (!base) return "";
  try {
    return base
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  } catch {
    return String(base).toLowerCase().replace(/[^a-z0-9]/g, "");
  }
}

function readPath(obj, pathValue) {
  if (!obj || typeof obj !== "object") return undefined;
  const segments = String(pathValue || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!segments.length) return undefined;
  let cursor = obj;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function getField(product = {}, aliases = []) {
  if (!product || typeof product !== "object") return null;
  for (const alias of aliases) {
    const direct = readPath(product, alias);
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") return direct;
  }
  const entries = Object.entries(product);
  const normalizedMap = new Map(entries.map(([key, value]) => [normalizeFieldKey(key), value]));
  for (const alias of aliases) {
    const normalizedAlias = normalizeFieldKey(alias);
    if (!normalizedAlias) continue;
    if (normalizedMap.has(normalizedAlias)) {
      const value = normalizedMap.get(normalizedAlias);
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
  }
  return null;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFiniteNumberOrNull(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = normalizeLooseNumber(value);
    if (normalized == null) return null;
    return normalized;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLooseNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const sanitized = raw.replace(/[^\d.,-]/g, "");
  if (!sanitized) return null;
  const hasDot = sanitized.includes(".");
  const hasComma = sanitized.includes(",");
  let normalized = sanitized;
  if (hasDot && hasComma) {
    const lastDot = sanitized.lastIndexOf(".");
    const lastComma = sanitized.lastIndexOf(",");
    if (lastComma > lastDot) {
      normalized = sanitized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = sanitized.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = sanitized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = sanitized.replace(/,/g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(values = []) {
  for (const value of values) {
    const parsed = toFiniteNumberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function resolvePriceFields(product = {}) {
  const priceMinorista = firstNumber([
    getField(product, ["price_minorista", "price minorista", "precio_minorista", "precio minorista", "retailPrice", "Precio Minorista"]),
    getField(product, ["precioMinorista", "precio minorista"]),
    getField(product, ["finalPrice", "salePrice", "precioFinal", "precio_final", "Precio Final"]),
    getField(product, ["priceArs", "precioARS", "precio_ars", "finalPriceArs", "precioConIva", "precio_con_iva"]),
    getField(product, ["price", "precio"]),
  ]);
  const priceMayorista = firstNumber([
    getField(product, ["price_mayorista", "precio_mayorista", "Precio Mayorista"]),
    getField(product, ["wholesalePrice", "price_wholesale", "wholesale_price", "precioMayorista"]),
  ]);
  const pricePublic = firstNumber([
    priceMinorista,
    getField(product, ["price", "precio"]),
    getField(product, ["finalPrice", "salePrice", "precioFinal", "precio_final", "Precio Final"]),
    getField(product, ["priceArs", "precioARS", "precio_ars", "finalPriceArs", "precioConIva", "precio_con_iva"]),
  ]);
  return {
    price: pricePublic,
    price_minorista: priceMinorista,
    price_mayorista: priceMayorista,
    precio_minorista: firstNumber([product.precio_minorista, priceMinorista]),
    precio_mayorista: firstNumber([product.precio_mayorista, priceMayorista]),
    precio_final: firstNumber([product.precio_final, product.precioFinal, product.finalPrice, pricePublic]),
    precio_sin_impuestos: firstNumber([
      product.precio_sin_impuestos,
      product.precioSinImpuestos,
      product.precio_sin_impuesto,
    ]),
    cost: firstNumber([product.cost, product.costo, product.costoCaja, product.costo_caja]),
    currency: toNullableText(getField(product, ["currency", "moneda"]) || "ARS"),
    rawPriceFields: {
      price_minorista: product.price_minorista,
      price_mayorista: product.price_mayorista,
      precio_minorista: product.precio_minorista,
      precio_mayorista: product.precio_mayorista,
      price: product.price,
      precio: product.precio,
      finalPrice: product.finalPrice,
      salePrice: product.salePrice,
      precioFinal: product.precioFinal,
      precio_final: product.precio_final,
      priceArs: product.priceArs,
      precioARS: product.precioARS,
      precio_ars: product.precio_ars,
      finalPriceArs: product.finalPriceArs,
      precioConIva: product.precioConIva,
      precio_con_iva: product.precio_con_iva,
      retailPrice: product.retailPrice,
      wholesalePrice: product.wholesalePrice,
      precio_sin_impuestos: product.precio_sin_impuestos,
      precioSinImpuestos: product.precioSinImpuestos,
      costo: product.costo,
      costoCaja: product.costoCaja,
      costo_caja: product.costo_caja,
      cost: product.cost,
      currency: product.currency,
    },
  };
}

function logBusyIfNeeded(error) {
  const message = String(error?.message || error || "");
  if (/busy|locked/i.test(message)) {
    console.warn("[products-db] sqlite busy/locked");
  }
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        logBusyIfNeeded(error);
        reject(error);
      } else {
        resolve(this);
      }
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        logBusyIfNeeded(error);
        reject(error);
      } else {
        resolve(row || null);
      }
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        logBusyIfNeeded(error);
        reject(error);
      } else {
        resolve(Array.isArray(rows) ? rows : []);
      }
    });
  });
}

async function withTransaction(db, callback) {
  await run(db, "BEGIN");
  try {
    const result = await callback();
    await run(db, "COMMIT");
    return result;
  } catch (error) {
    await run(db, "ROLLBACK");
    throw error;
  }
}

async function openDb() {
  if (dbInstance) return dbInstance;
  await fsp.mkdir(path.dirname(SQLITE_PATH), { recursive: true });
  try {
    dbInstance = await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(SQLITE_PATH, (error) => {
        if (error) reject(error);
        else resolve(db);
      });
    });
    await run(dbInstance, "PRAGMA journal_mode = WAL");
    await run(dbInstance, "PRAGMA synchronous = NORMAL");
    await run(dbInstance, "PRAGMA busy_timeout = 5000");
    await run(dbInstance, "PRAGMA temp_store = MEMORY");
    return dbInstance;
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "open_db", reason: "sqlite_open_corrupt" });
    }
    try {
      await closeDbInstance();
    } catch {}
    throw error;
  }
}

async function detectFtsAvailability(db) {
  try {
    await run(
      db,
      "CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(id, sku, code, slug, name, title, brand, model, category, search_text)",
    );
    ftsEnabled = true;
  } catch {
    ftsEnabled = false;
  }
}

async function createSchema(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT,
      sku TEXT,
      code TEXT,
      slug TEXT,
      public_slug TEXT,
      image TEXT,
      name TEXT,
      title TEXT,
      brand TEXT,
      model TEXT,
      category TEXT,
      part_number TEXT,
      mpn TEXT,
      ean TEXT,
      gtin TEXT,
      supplier_code TEXT,
      status TEXT,
      visibility TEXT,
      stock INTEGER,
      price REAL,
      price_minorista REAL,
      price_mayorista REAL,
      precio_minorista REAL,
      precio_mayorista REAL,
      precio_final REAL,
      precio_sin_impuestos REAL,
      cost REAL,
      currency TEXT,
      is_public INTEGER,
      enabled INTEGER,
      deleted INTEGER,
      archived INTEGER,
      vip_only INTEGER,
      wholesale_only INTEGER,
      search_text TEXT,
      raw_json TEXT
    )`,
  );

  const indexSql = [
    "CREATE INDEX IF NOT EXISTS idx_products_id ON products(id)",
    "CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)",
    "CREATE INDEX IF NOT EXISTS idx_products_code ON products(code)",
    "CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug)",
    "CREATE INDEX IF NOT EXISTS idx_products_public_slug ON products(public_slug)",
    "CREATE INDEX IF NOT EXISTS idx_products_part_number ON products(part_number)",
    "CREATE INDEX IF NOT EXISTS idx_products_mpn ON products(mpn)",
    "CREATE INDEX IF NOT EXISTS idx_products_ean ON products(ean)",
    "CREATE INDEX IF NOT EXISTS idx_products_gtin ON products(gtin)",
    "CREATE INDEX IF NOT EXISTS idx_products_supplier_code ON products(supplier_code)",
    "CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand)",
    "CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)",
    "CREATE INDEX IF NOT EXISTS idx_products_is_public ON products(is_public)",
    "CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock)",
    "CREATE INDEX IF NOT EXISTS idx_products_price ON products(price)",
    "CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)",
  ];

  for (const sql of indexSql) {
    await run(db, sql);
  }

  await detectFtsAvailability(db);
}

function computeProductPublicState(product = {}) {
  if (!product || typeof product !== "object") {
    return { isPublic: false, reason: "invalid_product", signals: { missingName: true, missingIdentifier: true } };
  }

  const visibility = normalizeQueryText(getField(product, ["visibility", "visibilidad"]) || "");
  const status = normalizeQueryText(getField(product, ["status", "estado"]) || "");
  const enabledValue = getField(product, ["enabled"]);
  const deletedValue = getField(product, ["deleted"]);
  const archivedValue = getField(product, ["archived"]);
  const vipOnlyValue = getField(product, ["vip_only", "vip only", "vipOnly"]);
  const wholesaleOnlyValue = getField(product, ["wholesaleOnly", "wholesale_only", "wholesale only"]);

  const hasName = Boolean(toNullableText(getField(product, ["name", "title", "productName", "Product Name", "Item Name", "nombre", "Name", "Artículo", "model", "description", "descripcion", "Descripcion", "shortDescription", "short_description", "Short Description"])));
  const hasIdentifier = Boolean(toNullableText(getField(product, ["id", "sku", "SKU", "code", "Code", "codigo", "Código", "partNumber", "Part Number", "mpn", "MPN", "ean", "EAN", "gtin", "GTIN", "supplierCode", "Supplier Code", "Supplier Part Number"])));

  const signals = {
    visibility,
    status,
    enabledFalse: enabledValue === false,
    deleted: deletedValue === true,
    archived: archivedValue === true,
    vipOnly: vipOnlyValue === true,
    wholesaleOnly: wholesaleOnlyValue === true,
    missingName: !hasName,
    missingIdentifier: !hasIdentifier,
  };

  if (signals.enabledFalse) return { isPublic: false, reason: "enabled_false", signals };
  if (signals.deleted) return { isPublic: false, reason: "deleted", signals };
  if (signals.archived) return { isPublic: false, reason: "archived", signals };
  if (signals.vipOnly) return { isPublic: false, reason: "vip_only", signals };
  if (signals.wholesaleOnly) return { isPublic: false, reason: "wholesale_only", signals };
  if (visibility && REJECTED_STATE_VALUES.has(visibility)) return { isPublic: false, reason: `visibility_${visibility}`, signals };
  if (status && REJECTED_STATE_VALUES.has(status)) return { isPublic: false, reason: `status_${status}`, signals };
  if (!hasName) return { isPublic: false, reason: "missing_name", signals };
  if (!hasIdentifier) return { isPublic: false, reason: "missing_identifier", signals };
  return { isPublic: true, reason: "public", signals };
}

function isProductPublic(product) {
  return computeProductPublicState(product).isPublic;
}

function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  const text = normalizeQueryText(value);
  return text === "true" || text === "1" || text === "yes" || text === "si";
}

function isFalsyFlag(value) {
  if (value === false || value === 0) return true;
  const text = normalizeQueryText(value);
  return text === "false" || text === "0" || text === "no";
}

function getProductMetadata(product = {}) {
  return product?.metadata && typeof product.metadata === "object" ? product.metadata : {};
}

function getSupplierImportMetadata(product = {}) {
  const metadata = getProductMetadata(product);
  return metadata?.supplierImport && typeof metadata.supplierImport === "object" ? metadata.supplierImport : {};
}

function getBulkDisabledReasons(product = {}, signals = {}) {
  const reasons = [];
  const metadata = getProductMetadata(product);
  const supplierImport = getSupplierImportMetadata(product);
  const enabledValue = getField(product, ["enabled"]);
  const disabledValue = getField(product, ["disabled", "deshabilitado"]);

  if (enabledValue === false || normalizeQueryText(enabledValue) === "false") reasons.push("disabled_enabled_false");
  if (enabledValue === 0 || enabledValue === "0") reasons.push("disabled_enabled_zero");
  if (isTruthyFlag(disabledValue)) reasons.push("disabled_field_true");
  if (signals.status === "disabled") reasons.push("disabled_status");
  if (signals.visibility === "disabled") reasons.push("disabled_visibility");

  const isCatalogImport =
    normalizeQueryText(metadata.importSource) === "catalog_csv" ||
    normalizeQueryText(supplierImport.source) === "parts_csv" ||
    Boolean(supplierImport.externalId || supplierImport.supplierPartNumber || metadata.supplierPartNumber);
  const canBeOrdered = supplierImport.csvCanBeOrdered ?? supplierImport.canBeOrdered;
  const csvStatus = normalizeQueryText(supplierImport.csvStatus || supplierImport.status || "");
  const maxOrder = firstNumber([supplierImport.csvMaximumQuantityInOrder, supplierImport.maximumQuantityInOrder]);
  const notOrderable =
    isCatalogImport &&
    (isFalsyFlag(canBeOrdered) ||
      (csvStatus && csvStatus !== "available") ||
      (Number.isFinite(maxOrder) && maxOrder <= 0));
  if (notOrderable) reasons.push("disabled_catalog_import_not_orderable");

  const stockSource = normalizeQueryText(product.stockSource || metadata.stockSource || "");
  const hasStockImport =
    Boolean(stockSource) ||
    Boolean(product.stockUpdatedAt || metadata.stockUpdatedAt) ||
    Object.prototype.hasOwnProperty.call(metadata, "stockQuantity") ||
    Object.prototype.hasOwnProperty.call(metadata, "csvStockQuantity") ||
    Object.prototype.hasOwnProperty.call(supplierImport, "csvStockQuantity");
  const importedStock = firstNumber([
    product.stockQuantity,
    metadata.stockQuantity,
    metadata.csvStockQuantity,
    supplierImport.csvStockQuantity,
    product.remote_stock,
    product.stock,
  ]);
  if ((hasStockImport || isCatalogImport) && Number.isFinite(importedStock) && importedStock <= 0) {
    reasons.push("disabled_stock_import_zero");
  }

  return Array.from(new Set(reasons));
}

function getBulkPrivateHiddenReasons(product = {}, signals = {}) {
  const reasons = [];
  if (signals.visibility === "hidden" || signals.status === "hidden" || isTruthyFlag(getField(product, ["hidden", "oculto"]))) {
    reasons.push("hidden_visibility");
  }
  if (signals.visibility === "private" || signals.status === "private" || isTruthyFlag(getField(product, ["private", "privado"]))) {
    reasons.push("private_visibility");
  }
  return Array.from(new Set(reasons));
}

function hasAbsoluteBulkBlocker(reasons = []) {
  return reasons.some((reason) => [
    "missing_name",
    "missing_identifier",
    "missing_price",
    "deleted",
    "archived",
    "draft",
    "vip_only",
    "wholesale_only",
  ].includes(reason));
}

function isDisabledImportCandidate(disabledReasons = []) {
  if (!disabledReasons.length) return false;
  const importReasons = new Set(["disabled_catalog_import_not_orderable", "disabled_stock_import_zero"]);
  const hardReasons = new Set(["disabled_field_true", "disabled_status", "disabled_visibility"]);
  const hasImportReason = disabledReasons.some((reason) => importReasons.has(reason));
  const hasHardReason = disabledReasons.some((reason) => hardReasons.has(reason));
  return hasImportReason && !hasHardReason;
}

function resolveBulkPublishEligibility(product = {}, options = {}) {
  const reasons = [];
  const warnings = [];
  const updates = {};
  const includePrivateHidden = options?.includePrivateHidden === true;
  const includeDisabledImportCandidates = options?.includeDisabledImportCandidates === true;
  const computed = computeProductPublicState(product);
  const signals = computed?.signals || {};
  const deletedFlag = signals.deleted || isTruthyFlag(getField(product, ["deleted", "eliminado"]));
  const archivedFlag = signals.archived || isTruthyFlag(getField(product, ["archived", "archive", "archivado"]));
  const vipOnlyFlag = signals.vipOnly || isTruthyFlag(getField(product, ["vip_only", "vipOnly", "vip only"]));
  const wholesaleOnlyFlag = signals.wholesaleOnly || isTruthyFlag(getField(product, ["wholesaleOnly", "wholesale_only", "wholesale only"]));
  const privateHiddenReasons = getBulkPrivateHiddenReasons(product, signals);
  const disabledReasons = getBulkDisabledReasons(product, signals);
  const disabledImportCandidate = isDisabledImportCandidate(disabledReasons);

  const hasName = !signals.missingName;
  const hasIdentifier = !signals.missingIdentifier;
  const priceValue = firstNumber([
    getField(product, ["price", "precio", "price_minorista", "precio_minorista", "precio_final", "finalPrice", "salePrice"]),
  ]);
  const hasValidPrice = Number.isFinite(priceValue) && priceValue > 0;
  const hasImage = hasBulkImage(product);

  if (!hasName) reasons.push("missing_name");
  if (!hasIdentifier) reasons.push("missing_identifier");
  if (!hasValidPrice) reasons.push("missing_price");
  if (deletedFlag) reasons.push("deleted");
  if (archivedFlag) reasons.push("archived");
  if (vipOnlyFlag) reasons.push("vip_only");
  if (wholesaleOnlyFlag) reasons.push("wholesale_only");
  if (!includePrivateHidden) reasons.push(...privateHiddenReasons);
  if (!(includeDisabledImportCandidates && disabledImportCandidate)) reasons.push(...disabledReasons);
  if (signals.visibility === "draft" || signals.status === "draft") reasons.push("draft");
  if (signals.visibility === "deleted" || signals.status === "deleted") reasons.push("deleted");
  if (signals.visibility === "archived" || signals.status === "archived") reasons.push("archived");

  const publicSlug = toNullableText(getField(product, ["public_slug", "publicSlug", "slug"]));
  if (!publicSlug) {
    updates.public_slug = buildPublicSlug(product, product?.rowid);
    warnings.push("generated_slug");
  }
  const imageValue = toNullableText(getField(product, ["image", "imagen", "imageUrl", "image_url"]));
  if (!imageValue) warnings.push("missing_image");
  const description = toNullableText(getField(product, ["description", "descripcion", "shortDescription", "short_description"]));
  if (!description) warnings.push("missing_description");
  const stock = Number(firstNumber([getField(product, ["stock", "stock_local"])]) || 0);
  if (stock <= 0) {
    warnings.push("stock_zero_remote_assumed");
    warnings.push("remote_delivery_estimated");
  }
  const uniqueReasons = Array.from(new Set(reasons));
  const hasAbsoluteBlocker = hasAbsoluteBulkBlocker(uniqueReasons);
  const privateHiddenCandidate = privateHiddenReasons.length > 0;
  const strictEligible = !hasAbsoluteBlocker && privateHiddenReasons.length === 0 && disabledReasons.length === 0;
  const advancedPublishable = !hasAbsoluteBlocker && (privateHiddenCandidate || disabledImportCandidate) && !uniqueReasons.some((reason) => ["disabled_field_true", "disabled_status", "disabled_visibility"].includes(reason));
  return {
    eligible: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    warnings: Array.from(new Set(warnings)),
    updates,
    diagnostics: {
      hasName,
      hasIdentifier,
      hasValidPrice,
      hasImage,
      privateHiddenReasons,
      disabledReasons,
      disabledImportCandidate,
      strictEligible,
      advancedPublishable,
    },
  };
}

function parseBulkBooleanFilter(value) {
  if (value === true || value === "true" || value === "1" || value === 1 || value === "yes") return true;
  if (value === false || value === "false" || value === "0" || value === 0 || value === "no") return false;
  return null;
}

function hasBulkImage(product = {}) {
  return Boolean(toNullableText(getField(product, ["image", "imagen", "imageUrl", "image_url", "thumbnail", "photo", "foto"])));
}

function getBulkPrice(product = {}) {
  return firstNumber([
    getField(product, ["price", "precio", "price_minorista", "precio_minorista", "precio_final", "finalPrice", "salePrice"]),
  ]);
}

function isBulkRemoteStockCandidate(product = {}) {
  const stock = Number(firstNumber([getField(product, ["stock", "stock_local"])]) || 0);
  const stockMode = normalizeQueryText(getField(product, ["stock_mode", "stockMode", "fulfillment_mode", "fulfillmentMode"]) || "");
  const availability = normalizeQueryText(getField(product, ["availability", "disponibilidad"]) || "");
  return stock <= 0 || /remote|pedido|a pedido|consultar|supplier|proveedor/.test(`${stockMode} ${availability}`);
}

function isPrivateHiddenProduct(product = {}) {
  const visibility = normalizeQueryText(getField(product, ["visibility", "visibilidad"]) || "");
  const status = normalizeQueryText(getField(product, ["status", "estado"]) || "");
  return visibility === "private" || status === "private" || visibility === "hidden" || status === "hidden" || isTruthyFlag(getField(product, ["private", "privado", "hidden", "oculto"]));
}

function hydrateBulkPublishProduct(row = {}) {
  let raw = {};
  try {
    raw = JSON.parse(row.raw_json || "{}");
  } catch {
    raw = {};
  }
  return {
    ...raw,
    rowid: row.rowid,
    id: raw.id ?? row.id,
    sku: raw.sku ?? row.sku,
    code: raw.code ?? row.code,
    slug: raw.slug ?? row.slug,
    public_slug: raw.public_slug ?? raw.publicSlug ?? row.public_slug,
    image: raw.image ?? row.image,
    name: raw.name ?? row.name,
    title: raw.title ?? row.title,
    brand: raw.brand ?? row.brand,
    model: raw.model ?? row.model,
    category: raw.category ?? row.category,
    status: raw.status ?? row.status,
    visibility: raw.visibility ?? row.visibility,
    stock: raw.stock ?? row.stock,
    price: raw.price ?? row.price,
    price_minorista: raw.price_minorista ?? row.price_minorista,
    precio_minorista: raw.precio_minorista ?? row.precio_minorista,
    precio_final: raw.precio_final ?? row.precio_final,
    is_public: raw.is_public ?? row.is_public,
  };
}

function matchesBulkPublishFilters(product = {}, filters = {}) {
  const search = normalizeQueryText(filters?.search || "");
  const brand = normalizeQueryText(filters?.brand || "");
  const model = normalizeQueryText(filters?.model || "");
  const productType = normalizeQueryText(filters?.productType || filters?.category || "");
  const withImage = parseBulkBooleanFilter(filters?.withImage);
  const withPrice = parseBulkBooleanFilter(filters?.withPrice);
  const remoteStock = parseBulkBooleanFilter(filters?.remoteStock);

  if (brand && !normalizeQueryText(getField(product, ["brand", "marca", "Brand"]) || "").includes(brand)) return false;
  if (model && !normalizeQueryText(getField(product, ["model", "modelo", "Model"]) || "").includes(model)) return false;
  if (productType && !normalizeQueryText(getField(product, ["category", "categoria", "Category", "productType", "tipo"]) || "").includes(productType)) return false;
  if (withImage !== null && hasBulkImage(product) !== withImage) return false;
  if (withPrice !== null) {
    const price = getBulkPrice(product);
    const hasPrice = Number.isFinite(price) && price > 0;
    if (hasPrice !== withPrice) return false;
  }
  if (remoteStock !== null && isBulkRemoteStockCandidate(product) !== remoteStock) return false;
  if (!search) return true;
  const intent = computeSearchIntent(search);
  return scoreProductAgainstIntent(product, intent) > 0;
}

function incCounter(counter, key) {
  if (!key) return;
  counter[key] = Number(counter[key] || 0) + 1;
}

function createBulkPublishSummary({ totalCatalogProducts = 0, publicProductsCount = 0 } = {}) {
  return {
    totalCatalogProducts: Number(totalCatalogProducts || 0),
    publicProductsCount: Number(publicProductsCount || 0),
    scannedRows: 0,
    totalScanned: 0,
    searchMatchedCount: 0,
    withNameCount: 0,
    withIdentifierCount: 0,
    withPriceCount: 0,
    withImageCount: 0,
    strictEligibleCount: 0,
    eligiblePublicCandidates: 0,
    eligiblePrivateHiddenCandidates: 0,
    eligibleDisabledImportCandidates: 0,
    hardBlockedCount: 0,
    privateHiddenCount: 0,
    advancedPublishableCount: 0,
    eligibleCount: 0,
    blockedCount: 0,
    disabledBreakdown: {},
    warningCount: 0,
    reasons: {},
    warnings: {},
    reasonCounts: {},
    warningCounts: {},
    samplesEligible: [],
    samplesBlocked: [],
    privateHiddenEligibleIdentifiers: [],
  };
}

function recordBulkPublishEvaluation(summary, product, result, options = {}) {
  const identifier = product.id || product.sku || product.code || product.public_slug || product.slug || `row:${product.rowid}`;
  const diagnostics = result.diagnostics || {};
  const privateHiddenCandidate = isPrivateHiddenProduct(product);
  summary.searchMatchedCount += 1;
  if (diagnostics.hasName) summary.withNameCount += 1;
  if (diagnostics.hasIdentifier) summary.withIdentifierCount += 1;
  if (diagnostics.hasValidPrice) summary.withPriceCount += 1;
  if (diagnostics.hasImage) summary.withImageCount += 1;
  if (diagnostics.strictEligible) summary.strictEligibleCount += 1;
  if (privateHiddenCandidate) summary.privateHiddenCount += 1;
  (diagnostics.disabledReasons || []).forEach((reason) => incCounter(summary.disabledBreakdown, reason));
  const hasAbsoluteBlocker = hasAbsoluteBulkBlocker(result.reasons || []);
  const hasHardDisabledReason = (diagnostics.disabledReasons || []).some((reason) => ["disabled_field_true", "disabled_status", "disabled_visibility"].includes(reason));
  const advancedPublishable = diagnostics.advancedPublishable === true || (!hasAbsoluteBlocker && !hasHardDisabledReason && (privateHiddenCandidate || diagnostics.disabledImportCandidate === true));
  const disabledImportPublishableWithCurrentOptions =
    diagnostics.disabledImportCandidate === true &&
    !hasAbsoluteBlocker &&
    !hasHardDisabledReason &&
    (!privateHiddenCandidate || options.includePrivateHidden === true);
  if (disabledImportPublishableWithCurrentOptions) summary.eligibleDisabledImportCandidates += 1;
  if (advancedPublishable) summary.advancedPublishableCount += 1;
  if (!result.eligible && !advancedPublishable) summary.hardBlockedCount += 1;
  result.reasons.forEach((reason) => {
    incCounter(summary.reasons, reason);
    incCounter(summary.reasonCounts, reason);
  });
  result.warnings.forEach((warning) => {
    incCounter(summary.warnings, warning);
    incCounter(summary.warningCounts, warning);
  });
  summary.warningCount += result.warnings.length;

  if (result.eligible) {
    summary.eligibleCount += 1;
    if (isPrivateHiddenProduct(product)) {
      summary.eligiblePrivateHiddenCandidates += 1;
      if (summary.privateHiddenEligibleIdentifiers.length < 25) summary.privateHiddenEligibleIdentifiers.push(identifier);
    } else {
      summary.eligiblePublicCandidates += 1;
    }
    if (summary.samplesEligible.length < 10) {
      summary.samplesEligible.push({ identifier, name: product.name || product.title || null, warnings: result.warnings, updates: result.updates });
    }
  } else {
    summary.blockedCount += 1;
    if (summary.samplesBlocked.length < 10) {
      summary.samplesBlocked.push({ identifier, name: product.name || product.title || null, reasons: result.reasons });
    }
  }
}

function summarizeBulkPublishProducts(products = [], { includePrivateHidden = false, includeDisabledImportCandidates = false, totalCatalogProducts = products.length, publicProductsCount = 0 } = {}) {
  const summary = createBulkPublishSummary({ totalCatalogProducts, publicProductsCount });
  for (const product of products) {
    summary.scannedRows += 1;
    summary.totalScanned = summary.scannedRows;
    const result = resolveBulkPublishEligibility(product, { includePrivateHidden, includeDisabledImportCandidates });
    recordBulkPublishEvaluation(summary, product, result, { includePrivateHidden });
  }
  return summary;
}

function buildBulkPublishPatch(product = {}, result = resolveBulkPublishEligibility(product, { includePrivateHidden: true })) {
  const patch = { visibility: "public", status: "active", enabled: true, is_public: true };
  if (result.updates?.public_slug) patch.public_slug = result.updates.public_slug;
  if (Number(product.stock || 0) <= 0) {
    patch.stock_mode = "remote";
    patch.fulfillment_mode = "remote";
    patch.remote_lead_min_days = Number(product.remote_lead_min_days || 20);
    patch.remote_lead_max_days = Number(product.remote_lead_max_days || 30);
  }
  return patch;
}

function buildSearchText(product = {}) {
  const mappedCore = {
    publicSlug: toNullableText(getField(product, ["publicSlug", "public_slug"])),
    slug: toNullableText(getField(product, ["slug"])),
    id: toNullableText(getField(product, ["id"])),
    sku: toNullableText(getField(product, ["sku", "SKU", "Sku"])),
    code: toNullableText(getField(product, ["code", "Code", "codigo", "Código"])),
    name: toNullableText(getField(product, ["name", "Name", "nombre"])),
    title: toNullableText(getField(product, ["title", "Title", "productName", "Product Name", "Item Name"])),
    model: toNullableText(getField(product, ["model", "Model", "modelo"])),
    partNumber: toNullableText(getField(product, ["partNumber", "Part Number"])),
    mpn: toNullableText(getField(product, ["mpn", "MPN"])),
    ean: toNullableText(getField(product, ["ean", "EAN"])),
    gtin: toNullableText(getField(product, ["gtin", "GTIN"])),
    supplierCode: toNullableText(getField(product, ["supplierCode", "Supplier Code", "Supplier Part Number"])),
    description: toNullableText(getField(product, ["description", "Description", "descripcion", "Descripcion"])),
    shortDescription: toNullableText(getField(product, ["shortDescription", "short_description", "Short Description"])),
  };
  const metadataText = product?.metadata ? JSON.stringify(product.metadata) : "";
  const rawText = Object.values(product || {})
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(" ");
  const fields = [
    ...Object.values(mappedCore),
    getField(product, ["brand", "marca", "Brand"]),
    getField(product, ["category", "categoria", "Category"]),
    getField(product, ["description", "descripcion", "shortDescription", "short_description"]),
    metadataText,
    rawText,
  ];
  return normalizeQueryText(fields.filter(Boolean).join(" "));
}

function slugifyValue(value) {
  const input = toNullableText(value);
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function firstText(values = []) {
  for (const value of values) {
    const parsed = toNullableText(value);
    if (parsed) return parsed;
  }
  return null;
}

function getProductIdentifier(product = {}, fallbackRow = null) {
  const candidates = [
    product.id,
    product.sku,
    product.code,
    product.partNumber,
    product.mpn,
    product.ean,
    product.gtin,
    product.supplierCode,
    fallbackRow,
  ];
  return toNullableText(candidates.find((value) => toNullableText(value)));
}

function buildPublicSlug(product = {}, fallbackRow = null) {
  const existing = slugifyValue(product.public_slug || product.publicSlug || product.slug);
  if (existing) return existing;
  const nameBase = slugifyValue(
    product.name || product.title || product.productName || product.nombre || product.model,
  );
  const identifier = slugifyValue(getProductIdentifier(product, fallbackRow));
  if (nameBase && identifier) return `${nameBase}-${identifier.slice(-8)}`;
  if (nameBase) return nameBase;
  if (identifier) return `producto-${identifier}`;
  return `producto-${String(fallbackRow || "sin-id").replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
}

function mapProductRow(product = {}, options = {}) {
  const { rowNumber = null, slugCounts = null } = options;
  const mappedCore = {
    publicSlug: toNullableText(getField(product, ["publicSlug", "public_slug"])),
    id: toNullableText(getField(product, ["id"])),
    sku: toNullableText(getField(product, ["sku", "SKU", "Sku"])),
    code: toNullableText(getField(product, ["code", "Code", "codigo", "Código"])),
    name: toNullableText(getField(product, ["name", "Name", "nombre"])),
    title: toNullableText(getField(product, ["title", "Title", "productName"])),
    model: toNullableText(getField(product, ["model", "Model", "modelo"])),
    partNumber: toNullableText(getField(product, ["partNumber", "Part Number"])),
    mpn: toNullableText(getField(product, ["mpn", "MPN"])),
    ean: toNullableText(getField(product, ["ean", "EAN"])),
    gtin: toNullableText(getField(product, ["gtin", "GTIN"])),
    supplierCode: toNullableText(getField(product, ["supplierCode", "supplier_code", "Supplier Part Number"])),
    slug: toNullableText(getField(product, ["slug"])),
    description: toNullableText(getField(product, ["description", "Description", "descripcion", "Descripcion"])),
    shortDescription: toNullableText(getField(product, ["shortDescription", "short_description", "Short Description"])),
  };
  let publicSlug = buildPublicSlug(mappedCore, rowNumber);
  if (slugCounts instanceof Map) {
    const current = Number(slugCounts.get(publicSlug) || 0) + 1;
    slugCounts.set(publicSlug, current);
    if (current > 1) publicSlug = `${publicSlug}-${current}`;
  }
  const priceFields = resolvePriceFields(product);
  const stock = Math.trunc(toNumber(product.stock, 0));
  if (rowNumber != null && rowNumber <= 3) {
    console.log("[products-price-map]", {
      id: toNullableText(product.id),
      sku: toNullableText(product.sku),
      rawPriceFields: priceFields.rawPriceFields,
      mappedPrice: priceFields.price,
      mappedPriceMinorista: priceFields.price_minorista,
      mappedPriceMayorista: priceFields.price_mayorista,
    });
  }
  return {
    id: toNullableText(getField(product, ["id"])),
    sku: toNullableText(getField(product, ["sku", "SKU", "Sku"])),
    code: toNullableText(getField(product, ["code", "Code", "codigo", "Código"])),
    slug: toNullableText(getField(product, ["slug"])),
    public_slug: publicSlug,
    image: firstText([
      getField(product, ["image", "image_url", "imagen"]),
      getField(product, ["thumbnail", "thumbnail_url"]),
      getField(product, ["picture", "photo", "foto"]),
      Array.isArray(getField(product, ["images", "imagenes", "fotos"])) ? getField(product, ["images", "imagenes", "fotos"])[0] : null,
    ]),
    name: toNullableText(getField(product, ["name", "Name", "nombre"])),
    title: toNullableText(getField(product, ["title", "Title", "productName"])),
    brand: normalizeQueryText(toNullableText(getField(product, ["brand", "Brand", "marca"]))),
    model: normalizeQueryText(toNullableText(getField(product, ["model", "Model", "modelo"]))),
    category: normalizeQueryText(toNullableText(getField(product, ["category", "Category", "categoria"]))),
    part_number: toNullableText(getField(product, ["partNumber", "Part Number"])),
    mpn: toNullableText(getField(product, ["mpn", "MPN"])),
    ean: toNullableText(getField(product, ["ean", "EAN"])),
    gtin: toNullableText(getField(product, ["gtin", "GTIN"])),
    supplier_code: toNullableText(getField(product, ["supplierCode", "supplier_code", "Supplier Part Number"])),
    status: normalizeQueryText(toNullableText(getField(product, ["status", "estado"]))),
    visibility: normalizeQueryText(toNullableText(getField(product, ["visibility", "visibilidad"]))),
    stock,
    price: priceFields.price,
    price_minorista: priceFields.price_minorista,
    price_mayorista: priceFields.price_mayorista,
    precio_minorista: priceFields.precio_minorista,
    precio_mayorista: priceFields.precio_mayorista,
    precio_final: priceFields.precio_final,
    precio_sin_impuestos: priceFields.precio_sin_impuestos,
    cost: priceFields.cost,
    currency: priceFields.currency,
    is_public: computeProductPublicState(product).isPublic ? 1 : 0,
    enabled: boolToInt(getField(product, ["enabled"]), 1),
    deleted: boolToInt(getField(product, ["deleted"]), 0),
    archived: boolToInt(getField(product, ["archived"]), 0),
    vip_only: boolToInt(getField(product, ["vip_only", "vipOnly"]), 0),
    wholesale_only: boolToInt(getField(product, ["wholesaleOnly", "wholesale_only"]), 0),
    search_text: buildSearchText(product),
    raw_json: JSON.stringify(product),
  };
}

function parseImageLikeField(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : item?.url || item?.secure_url || item?.src || ""))
      .map((item) => toNullableText(item))
      .filter(Boolean);
  }
  const one = toNullableText(value);
  if (!one) return [];
  if (one.includes(",")) {
    return one
      .split(",")
      .map((item) => toNullableText(item))
      .filter(Boolean);
  }
  return [one];
}

function normalizeProductForPublic(product = {}, meta = {}) {
  const safe = product && typeof product === "object" ? { ...product } : {};
  const priceFields = resolvePriceFields(safe);
  const name = firstText([
    getField(safe, ["name", "Name", "title", "Title", "productName", "nombre", "model", "Model"]),
  ]) || "Producto";
  const brand = firstText([getField(safe, ["brand", "Brand", "marca", "manufacturer"])]) || "";
  const description =
    firstText([
      getField(safe, ["description", "Description", "descripcion", "details", "detalle", "shortDescription", "longDescription", "meta_description"]),
    ]) || PUBLIC_DESCRIPTION_FALLBACK;
  const identifier = getProductIdentifier(safe, meta.rowid);
  const publicSlug =
    firstText([safe.publicSlug, safe.public_slug, meta.public_slug]) || buildPublicSlug(safe, meta.rowid);
  const images = Array.from(
    new Set(
      [
        ...parseImageLikeField(safe.images),
        ...parseImageLikeField(safe.fotos),
        ...parseImageLikeField(safe.imagenes),
        ...parseImageLikeField(safe.image),
        ...parseImageLikeField(safe.imageUrl),
        ...parseImageLikeField(safe.thumbnail),
        ...parseImageLikeField(safe.thumbnailUrl),
        ...parseImageLikeField(safe.picture),
        ...parseImageLikeField(safe.photo),
        ...parseImageLikeField(safe.foto),
        ...parseImageLikeField(safe.imagen),
      ].filter(Boolean),
    ),
  );
  const image = firstText([safe.image, images[0]]) || "";
  const stock = Math.trunc(
    toNumber(
      safe.stock ?? safe.quantity ?? safe.qty ?? safe.availableQuantity ?? safe.stockQty,
      0,
    ),
  );
  return {
    ...safe,
    id: firstText([safe.id, identifier]) || identifier,
    name,
    brand,
    description,
    images,
    image,
    price: priceFields.price,
    price_minorista: priceFields.price_minorista,
    price_mayorista: priceFields.price_mayorista,
    precio_minorista: priceFields.precio_minorista,
    precio_mayorista: priceFields.precio_mayorista,
    precio_final: priceFields.precio_final,
    precio_sin_impuestos: priceFields.precio_sin_impuestos,
    cost: priceFields.cost,
    currency: priceFields.currency || safe.currency || "ARS",
    stock,
    publicSlug,
    public_slug: publicSlug,
    url: `/p/${encodeURIComponent(publicSlug)}`,
    sku: firstText([getField(safe, ["sku", "SKU", "code", "Code", "partNumber", "Part Number", "mpn", "ean", "gtin", "supplierCode"])]) || "",
    code: firstText([getField(safe, ["code", "Code", "codigo", "Código", "sku", "SKU"])]) || "",
    slug: firstText([safe.slug, safe.publicSlug, safe.public_slug, publicSlug]) || publicSlug,
  };
}

function parseRawItems(rows = [], options = {}) {
  return rows
    .map((row, index) => {
      try {
        const parsed = JSON.parse(row.raw_json);
        if (!options.normalizePublic) return parsed;
        return normalizeProductForPublic(parsed, {
          public_slug: row?.public_slug || null,
          rowid: row?.rowid ?? index + 1,
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeProductForAdminList(product = {}, meta = {}) {
  return normalizeProductForPublic(product, meta);
}

async function updateProductByIdentifier(identifier, patch = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const target = String(identifier || "").trim();
  if (!target) throw new Error("identifier requerido");
  const row = await get(
    db,
    `SELECT rowid, raw_json
     FROM products
     WHERE id = ? OR public_slug = ? OR slug = ? OR sku = ? OR code = ?
     LIMIT 1`,
    [target, target, target, target, target],
  );
  if (!row) return null;
  const current = JSON.parse(row.raw_json || "{}");
  const patchVisibility = normalizeQueryText(patch?.visibility);
  const patchStatus = normalizeQueryText(patch?.status);
  const shouldForceEnabledTrue =
    patchVisibility === "public" ||
    patchVisibility === "visible" ||
    patchStatus === "active" ||
    patchStatus === "published" ||
    patch?.is_public === true ||
    patch?.published === true ||
    patch?.visible === true;
  const mergedPatch = shouldForceEnabledTrue ? { ...patch, enabled: true } : patch;
  const merged = { ...current, ...mergedPatch };
  const mapped = mapProductRow(merged, { rowNumber: row.rowid });
  const changedFields = Object.keys(mergedPatch || {}).filter((field) => current[field] !== mergedPatch[field]);
  const oldVisibility = firstText([current.visibility, current.Visibility, ""]) || "";
  const newVisibility = firstText([merged.visibility, merged.Visibility, ""]) || "";
  const oldStatus = firstText([current.status, current.Status, ""]) || "";
  const newStatus = firstText([merged.status, merged.Status, ""]) || "";
  const oldIsPublic = isProductPublic(current);
  const newIsPublic = Boolean(mapped.is_public);
  const reasonBefore = computeProductPublicState(current).reason;
  const reasonAfter = computeProductPublicState(merged).reason;
  await run(
    db,
    `UPDATE products SET
      id = ?, sku = ?, code = ?, slug = ?, public_slug = ?, image = ?, name = ?, title = ?, brand = ?, model = ?, category = ?,
      part_number = ?, mpn = ?, ean = ?, gtin = ?, supplier_code = ?, status = ?, visibility = ?,
      stock = ?, price = ?, price_minorista = ?, price_mayorista = ?, precio_minorista = ?, precio_mayorista = ?, precio_final = ?, precio_sin_impuestos = ?, cost = ?, currency = ?, is_public = ?, enabled = ?, deleted = ?, archived = ?, vip_only = ?, wholesale_only = ?, search_text = ?, raw_json = ?
      WHERE rowid = ?`,
    [
      mapped.id,
      mapped.sku,
      mapped.code,
      mapped.slug,
      mapped.public_slug,
      mapped.image,
      mapped.name,
      mapped.title,
      mapped.brand,
      mapped.model,
      mapped.category,
      mapped.part_number,
      mapped.mpn,
      mapped.ean,
      mapped.gtin,
      mapped.supplier_code,
      mapped.status,
      mapped.visibility,
      mapped.stock,
      mapped.price,
      mapped.price_minorista,
      mapped.price_mayorista,
      mapped.precio_minorista,
      mapped.precio_mayorista,
      mapped.precio_final,
      mapped.precio_sin_impuestos,
      mapped.cost,
      mapped.currency,
      mapped.is_public,
      mapped.enabled,
      mapped.deleted,
      mapped.archived,
      mapped.vip_only,
      mapped.wholesale_only,
      mapped.search_text,
      mapped.raw_json,
      row.rowid,
    ],
  );
  countCache.clear();
  await saveProductOverride(target, merged, shouldForceEnabledTrue ? "admin_publish" : "admin_update");
  console.log("[products-admin-publication-change]", {
    identifier: target,
    patch: mergedPatch,
    oldEnabled: current.enabled,
    newEnabled: merged.enabled,
    oldVisibility,
    newVisibility,
    oldStatus,
    newStatus,
    oldIsPublic,
    newIsPublic,
    reasonBefore,
    reasonAfter,
    changedFields,
  });
  return normalizeProductForAdminList(merged, { rowid: row.rowid, public_slug: mapped.public_slug });
}

async function loadProductOverrides() {
  try {
    return JSON.parse(await fsp.readFile(OVERRIDES_PATH, "utf8")) || {};
  } catch {
    return {};
  }
}

async function saveProductOverride(identifier, product, source = "admin_update") {
  const key = String(identifier || product?.sku || product?.id || "").trim();
  if (!key) return;
  const overrides = await loadProductOverrides();
  overrides[key] = {
    visibility: product.visibility,
    status: product.status,
    enabled: product.enabled,
    updatedAt: new Date().toISOString(),
    source,
  };
  await fsp.writeFile(OVERRIDES_PATH, JSON.stringify(overrides, null, 2), "utf8");
}

function buildCatalogPathsInfo() {
  const renderDiskMountPath = (process.env.RENDER_DISK_MOUNT_PATH || "").trim() || null;
  return {
    DATA_DIR: path.dirname(SQLITE_PATH),
    dbPath: SQLITE_PATH,
    productsFilePath: PRODUCTS_JSON_PATH,
    renderDiskMountPath,
    dbExists: fs.existsSync(SQLITE_PATH),
    manifestExists: fs.existsSync(MANIFEST_PATH),
  };
}

function createInitializingError(reason = "sqlite_not_ready") {
  const error = new Error("Catálogo rápido inicializando");
  error.code = "CATALOG_INITIALIZING";
  error.reason = reason;
  error.catalogState = catalogStateSnapshot();
  return error;
}

function createCatalogFailedError(reason = "sqlite_failed", originalError = null) {
  const message = originalError?.message || "Catálogo rápido no disponible";
  const error = new Error(message);
  error.code = "CATALOG_SQLITE_FAILED";
  error.reason = reason;
  error.originalError = originalError || null;
  error.catalogState = catalogStateSnapshot();
  return error;
}

async function rebuildProductsDbFromJson({ force = true, reason = "manual" } = {}) {
  if (rebuildPromise) {
    console.log("[products-db] rebuild already in progress; waiting");
    return rebuildPromise;
  }
  rebuildPromise = (async () => {
    const startedAt = Date.now();
    const activeReason = reason || (force ? "forced" : "unknown");
    catalogState.rebuilding = true;
    catalogState.initializing = true;
    catalogState.ready = false;
    catalogState.lastRebuildStartedAt = new Date(startedAt).toISOString();
    const productsStats = await fsp.stat(PRODUCTS_JSON_PATH);
    const tmpDbPath = `${SQLITE_PATH}.tmp-${process.pid}-${Date.now()}`;
    console.log(`[products-db] rebuild start reason=${activeReason} productsFilePath=${PRODUCTS_JSON_PATH}`);

    const tmpDb = await new Promise((resolve, reject) => {
      const conn = new sqlite3.Database(tmpDbPath, (error) => {
        if (error) reject(error);
        else resolve(conn);
      });
    });

    try {
      await run(tmpDb, "PRAGMA journal_mode = OFF");
      await run(tmpDb, "PRAGMA synchronous = OFF");
      await run(tmpDb, "PRAGMA temp_store = MEMORY");
      await createSchema(tmpDb);
      const insertSql = `INSERT INTO products (
        id, sku, code, slug, public_slug, image, name, title, brand, model, category,
        part_number, mpn, ean, gtin, supplier_code, status, visibility,
        stock, price, price_minorista, price_mayorista, precio_minorista, precio_mayorista, precio_final, precio_sin_impuestos, cost, currency, is_public, enabled, deleted, archived, vip_only, wholesale_only,
        search_text, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      let count = 0;
      let publicCount = 0;
      const overrides = await loadProductOverrides();
      const slugCounts = new Map();
      const batch = [];
      const BATCH_SIZE = 500;

      const flush = async () => {
        if (!batch.length) return;
        await withTransaction(tmpDb, async () => {
          for (const item of batch) {
            await run(tmpDb, insertSql, [
              item.id,
              item.sku,
              item.code,
              item.slug,
              item.public_slug,
              item.image,
              item.name,
              item.title,
              item.brand,
              item.model,
              item.category,
              item.part_number,
              item.mpn,
              item.ean,
              item.gtin,
              item.supplier_code,
              item.status,
              item.visibility,
              item.stock,
              item.price,
              item.price_minorista,
              item.price_mayorista,
              item.precio_minorista,
              item.precio_mayorista,
              item.precio_final,
              item.precio_sin_impuestos,
              item.cost,
              item.currency,
              item.is_public,
              item.enabled,
              item.deleted,
              item.archived,
              item.vip_only,
              item.wholesale_only,
              item.search_text,
              item.raw_json,
            ]);
          }
        });
        batch.length = 0;
      };

      await productsStreamRepo.streamProducts({
        filePath: PRODUCTS_JSON_PATH,
        onProduct: async (product) => {
          const identifier = String(product?.id || product?.sku || product?.code || "").trim();
          const override = identifier ? overrides[identifier] : null;
          const mergedProduct = override ? { ...product, ...override } : product;
          const mapped = mapProductRow(mergedProduct, { rowNumber: count + 1, slugCounts });
          batch.push(mapped);
          count += 1;
          if (mapped.is_public === 1) publicCount += 1;
          if (count % 5000 === 0) {
            console.log(`[products-db] rebuild progress count=${count}`);
          }
          if (batch.length >= BATCH_SIZE) {
            await flush();
          }
          return true;
        },
      });

      await flush();

      if (ftsEnabled) {
        await run(tmpDb, "DELETE FROM products_fts");
        await run(
          tmpDb,
          `INSERT INTO products_fts(rowid, id, sku, code, slug, name, title, brand, model, category, search_text)
          SELECT rowid, id, sku, code, slug, name, title, brand, model, category, search_text FROM products`,
        );
      }

      await new Promise((resolve, reject) => {
        tmpDb.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      const validateTmpDb = await new Promise((resolve, reject) => {
        const conn = new sqlite3.Database(tmpDbPath, (error) => {
          if (error) reject(error);
          else resolve(conn);
        });
      });
      await runIntegrityCheck(validateTmpDb);
      await new Promise((resolve, reject) => validateTmpDb.close((error) => (error ? reject(error) : resolve())));

      await closeDbInstance();
      await backupAndRemoveSqliteFiles({ suffix: Date.now() });
      await fsp.rename(tmpDbPath, SQLITE_PATH);
      const finalDb = await openDb();
      await runIntegrityCheck(finalDb);

      const manifest = {
        sqliteSchemaVersion: PRODUCTS_SQLITE_SCHEMA_VERSION,
        mappingVersion: CATALOG_MAPPING_VERSION,
        productCount: count,
        publicProductCount: publicCount,
        productsJsonSizeBytes: Number(productsStats.size || 0),
        productsJsonMtimeMs: Number(productsStats.mtimeMs || 0),
        sqliteBuiltAt: new Date().toISOString(),
        sqlitePath: SQLITE_PATH,
        sqliteFtsEnabled: ftsEnabled,
      };
      await fsp.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");

      const durationMs = Date.now() - startedAt;
      console.log(
        `[products-db] rebuild done productCount=${count} publicProductCount=${publicCount} durationMs=${durationMs}`,
      );
      countCache.clear();
      dbReady = true;
      catalogState.ready = true;
      catalogState.lastReadyAt = new Date().toISOString();
      catalogState.lastRebuildFinishedAt = new Date().toISOString();
      catalogState.lastRebuildDurationMs = durationMs;
      clearCatalogError();
      return manifest;
    } catch (error) {
      console.error(`[products-db] rebuild failed reason=${activeReason}`, error);
      if (isSqliteCorruptionError(error)) {
        markSqliteCorruption(error, { phase: "rebuild", reason: activeReason });
      } else {
        setCatalogError(error, { phase: "rebuild", reason: activeReason });
      }
      catalogState.lastRebuildFinishedAt = new Date().toISOString();
      catalogState.lastRebuildDurationMs = Date.now() - startedAt;
      try {
        await new Promise((resolve) => tmpDb.close(() => resolve()));
      } catch {}
      try {
        if (fs.existsSync(tmpDbPath)) await fsp.unlink(tmpDbPath);
      } catch {}
      throw error;
    }
  })();

  try {
    return await rebuildPromise;
  } finally {
    catalogState.rebuilding = false;
    catalogState.initializing = false;
    rebuildPromise = null;
  }
}

async function repairCorruptSqlite({ reason = "sqlite_corrupt" } = {}) {
  if (rebuildPromise) return rebuildPromise;
  console.log("[products-db] repair start");
  try {
    dbReady = false;
    catalogState.ready = false;
    catalogState.initializing = true;
    await closeDbInstance();
    await backupAndRemoveSqliteFiles({ suffix: Date.now() });
    try {
      if (fs.existsSync(MANIFEST_PATH)) await fsp.unlink(MANIFEST_PATH);
    } catch {}
    const manifest = await rebuildProductsDbFromJson({ force: true, reason });
    console.log("[products-db] repair done");
    return manifest;
  } catch (error) {
    console.error("[products-db] repair failed", error);
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "repair", reason });
    } else {
      setCatalogError(error, { phase: "repair", reason });
    }
    throw error;
  } finally {
    catalogState.initializing = false;
  }
}

function isTextSqlType(columnType) {
  const t = String(columnType || "").trim().toUpperCase();
  return t === "TEXT";
}

async function inspectSqliteSchemaIntegrity() {
  if (!fs.existsSync(SQLITE_PATH)) {
    return { ok: false, reason: "sqlite_missing" };
  }
  try {
    const db = await openDb();
    const columns = await all(db, "PRAGMA table_info(products)");
    const columnByName = new Map(
      columns.map((col) => [String(col?.name || "").toLowerCase(), String(col?.type || "").trim()]),
    );
    if (!columnByName.has("public_slug")) {
      return { ok: false, reason: "public_slug_missing" };
    }
    const priceColumns = [
      "price",
      "price_minorista",
      "price_mayorista",
      "precio_minorista",
      "precio_mayorista",
      "precio_final",
      "precio_sin_impuestos",
      "cost",
    ];
    for (const col of priceColumns) {
      const type = columnByName.get(col);
      if (!type) continue;
      if (isTextSqlType(type)) {
        return { ok: false, reason: "price_column_type_mismatch", column: col, currentType: type };
      }
    }
    return { ok: true };
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "inspect_schema", reason: "sqlite_corrupt" });
      return { ok: false, reason: "sqlite_corrupt" };
    }
    throw error;
  }
}

async function ensureProductsDb({ allowRebuild = true } = {}) {
  catalogState.initializing = true;
  console.log("[products-db] paths", buildCatalogPathsInfo());
  console.log("[products-db] ensure start");
  const productsStats = await fsp.stat(PRODUCTS_JSON_PATH);
  let manifest = null;
  try {
    manifest = JSON.parse(await fsp.readFile(MANIFEST_PATH, "utf8"));
  } catch {
    manifest = null;
  }

  let reason = "";
  if (!fs.existsSync(SQLITE_PATH)) {
    reason = "sqlite_missing";
  } else if (!manifest) {
    reason = "manifest_missing";
  } else if (Number(manifest.sqliteSchemaVersion || 0) !== PRODUCTS_SQLITE_SCHEMA_VERSION) {
    reason = "schema_version_changed";
  } else if (Number(manifest.mappingVersion || 0) !== CATALOG_MAPPING_VERSION) {
    reason = "mapping_version_changed";
  } else if (Number(manifest.productsJsonSizeBytes || -1) !== Number(productsStats.size || 0)) {
    reason = "products_json_size_changed";
  } else if (
    Math.floor(Number(manifest.productsJsonMtimeMs || -1)) !==
    Math.floor(Number(productsStats.mtimeMs || 0))
  ) {
    reason = "products_json_mtime_changed";
  }

  if (!reason && fs.existsSync(SQLITE_PATH)) {
    const integrity = await inspectSqliteSchemaIntegrity();
    if (!integrity.ok) {
      reason = integrity.reason;
      if (reason === "price_column_type_mismatch") {
        console.log("[products-db] rebuild required reason=price_column_type_mismatch");
      }
    }
  }

  if (reason) {
    console.log(`[products-db] rebuild required reason=${reason}`);
    if (!allowRebuild) throw createInitializingError(reason);
    if (reason === "sqlite_corrupt") {
      await repairCorruptSqlite({ reason });
    } else {
      await rebuildProductsDbFromJson({ force: true, reason });
    }
  } else {
    console.log("[products-db] already fresh");
  }

  const db = await openDb();
  await createSchema(db);
  dbReady = true;
  catalogState.ready = true;
  catalogState.lastReadyAt = new Date().toISOString();
  catalogState.initializing = false;
  clearCatalogError();
  return {
    dbPath: SQLITE_PATH,
    manifest: await getManifestFromDb(),
    ftsEnabled,
  };
}

async function ensureProductsDbOnce() {
  if (dbReady) return { dbPath: SQLITE_PATH, source: "sqlite", ready: true };
  if (dbReadyPromise) return dbReadyPromise;
  catalogState.initializing = true;
  dbReadyPromise = ensureProductsDb({ allowRebuild: true });
  try {
    return await dbReadyPromise;
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "ensure_once", reason: "bootstrap_corrupt" });
      try {
        return await repairCorruptSqlite({ reason: "ensure_once_corrupt" });
      } catch (repairError) {
        setCatalogError(repairError, { phase: "ensure_once", reason: "repair_failed" });
        throw repairError;
      }
    }
    setCatalogError(error, { phase: "ensure_once", reason: "bootstrap_failed" });
    throw error;
  } finally {
    catalogState.initializing = false;
    dbReadyPromise = null;
  }
}

function ensureProductsDbInBackground(trigger = "request") {
  if (dbReady || dbReadyPromise) return;
  dbReadyPromise = ensureProductsDb({ allowRebuild: true });
  dbReadyPromise
    .then(() => {
      console.log(`[products-db] background ensure completed trigger=${trigger}`);
    })
    .catch((error) => {
      console.warn(`[products-db] background ensure failed trigger=${trigger} reason=${error?.message || error}`);
    })
    .finally(() => {
      dbReadyPromise = null;
    });
}

async function ensureDbReadyForRequest() {
  if (dbReady) return;
  if (catalogState.lastError) {
    if (catalogState.lastError.code === SQLITE_CORRUPT_CODE) {
      try {
        await repairCorruptSqlite({ reason: "request_corrupt_repair" });
        return;
      } catch (repairError) {
        throw createCatalogFailedError("persisted_corrupt_error", repairError);
      }
    }
    throw createCatalogFailedError("persisted_error");
  }
  if (dbReadyPromise) throw createInitializingError("sqlite_bootstrap_in_progress");
  try {
    await ensureProductsDb({ allowRebuild: false });
  } catch (error) {
    if (error?.code === "CATALOG_INITIALIZING") {
      ensureProductsDbInBackground("request-auto-bootstrap");
      throw error;
    }
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "request_readiness", reason: "ensure_corrupt" });
      try {
        await repairCorruptSqlite({ reason: "request_readiness_corrupt" });
        return;
      } catch (repairError) {
        throw createCatalogFailedError("ensure_corrupt_repair_failed", repairError);
      }
    }
    setCatalogError(error, { phase: "request_readiness", reason: "ensure_failed" });
    throw createCatalogFailedError("ensure_failed", error);
  }
}

function buildSort(sort) {
  const priceExpr = "COALESCE(price_minorista, price, precio_minorista, precio_final)";
  const allowedSorts = {
    price_asc: `${priceExpr} ASC, rowid ASC`,
    price_desc: `${priceExpr} DESC, rowid ASC`,
    name_asc: "name ASC, rowid ASC",
    name_desc: "name DESC, rowid ASC",
    stock_desc: "stock DESC, rowid ASC",
    stock_asc: "stock ASC, rowid ASC",
    "price-asc": `${priceExpr} ASC, rowid ASC`,
    "price-desc": `${priceExpr} DESC, rowid ASC`,
    "stock-desc": "stock DESC, rowid ASC",
    name: "name ASC, rowid ASC",
  };
  return allowedSorts[String(sort || "").trim().toLowerCase()] || "rowid ASC";
}

function buildWhereClause({
  search = "",
  isPublicOnly = false,
  category = "",
  brand = "",
  model = "",
  visibility = "",
  status = "",
  stock = "",
  priceMax = null,
} = {}) {
  const where = [];
  const params = [];

  if (isPublicOnly) where.push("is_public = 1");
  if (category) {
    where.push("category = ?");
    params.push(category);
  }
  if (brand) {
    where.push("brand = ?");
    params.push(brand);
  }
  if (model) {
    where.push("model = ?");
    params.push(model);
  }
  if (visibility) {
    where.push("visibility = ?");
    params.push(visibility);
  }
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (stock === "in-stock" || stock === "in") {
    where.push("stock > 0");
  } else if (stock === "out") {
    where.push("stock <= 0");
  }
  if (priceMax !== null && Number.isFinite(Number(priceMax))) {
    where.push("COALESCE(price_minorista, price, precio_minorista, precio_final) <= ?");
    params.push(Number(priceMax));
  }

  const normalizedSearch = normalizeQueryText(search);
  if (normalizedSearch) {
    if (ftsEnabled) {
      where.push("rowid IN (SELECT rowid FROM products_fts WHERE products_fts MATCH ?)");
      params.push(buildFtsQueryFromSearch(normalizedSearch) || normalizedSearch);
    } else {
      addLikeSearchConditions(where, params, normalizedSearch);
    }
  }

  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

function buildProductSummary(row = {}) {
  const publicSlug = firstText([row.public_slug, row.slug]) || "";
  const fallbackId = String(row.id || row.sku || row.code || "producto");
  return {
    id: firstText([row.id]) || "",
    sku: firstText([row.sku]) || "",
    code: firstText([row.code]) || "",
    name: firstText([row.name, row.title]) || "Producto",
    title: firstText([row.title, row.name]) || "Producto",
    brand: row.brand || "",
    model: row.model || "",
    category: row.category || "",
    price: toFiniteNumberOrNull(row.price),
    price_minorista: toFiniteNumberOrNull(row.price_minorista),
    price_mayorista: toFiniteNumberOrNull(row.price_mayorista),
    precio_minorista: toFiniteNumberOrNull(row.precio_minorista),
    precio_mayorista: toFiniteNumberOrNull(row.precio_mayorista),
    precio_final: toFiniteNumberOrNull(row.precio_final),
    precio_sin_impuestos: toFiniteNumberOrNull(row.precio_sin_impuestos),
    cost: toFiniteNumberOrNull(row.cost),
    currency: row.currency || "ARS",
    stock: Math.trunc(toNumber(row.stock, 0)),
    status: row.status || "",
    visibility: row.visibility || "",
    image: row.image || "",
    thumbnail: row.image || "",
    publicSlug,
    public_slug: publicSlug,
    slug: firstText([row.slug, publicSlug]) || "",
    url: `/p/${encodeURIComponent(publicSlug || fallbackId)}`,
    source: "sqlite",
  };
}

async function queryBase({
  page = 1,
  pageSize = 24,
  search = "",
  sort = "",
  isPublicOnly = false,
  category = "",
  brand = "",
  model = "",
  visibility = "",
  status = "",
  stock = "",
  priceMax = null,
  debugSearch = false,
} = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || 24);
  const offset = (safePage - 1) * safePageSize;
  const normalizedSearch = normalizeQueryText(search);
  const whereClause = buildWhereClause({
    search,
    isPublicOnly,
    category: normalizeQueryText(category),
    brand: normalizeQueryText(brand),
    model: normalizeQueryText(model),
    visibility: normalizeQueryText(visibility),
    status: normalizeQueryText(status),
    stock: normalizeQueryText(stock),
    priceMax,
  });

  const orderBy = buildSort(sort);
  const shouldIntentRank = Boolean(normalizedSearch) && (!sort || String(sort).trim().toLowerCase() === "relevance");
  const totalStartedAt = Date.now();

  const countStartedAt = Date.now();
  const countKey = JSON.stringify({ whereSql: whereClause.sql, whereParams: whereClause.params });
  const cachedCount = countCache.get(countKey);
  let totalItems = 0;
  if (cachedCount && Date.now() - cachedCount.t < COUNT_CACHE_TTL_MS) {
    totalItems = Number(cachedCount.totalItems || 0);
  } else {
    const totalRow = await get(
      db,
      `SELECT COUNT(*) AS totalItems FROM products ${whereClause.sql}`,
      whereClause.params,
    );
    totalItems = Number(totalRow?.totalItems || 0);
    countCache.set(countKey, { t: Date.now(), totalItems });
  }
  const countMs = Date.now() - countStartedAt;

  const selectStartedAt = Date.now();
  let rows = [];
  let searchDebug = undefined;
  if (!shouldIntentRank) {
    rows = await all(
      db,
      `SELECT rowid, id, sku, code, slug, public_slug, image, name, title, brand, model, category, status, visibility, stock, price, price_minorista, price_mayorista, precio_minorista, precio_mayorista, precio_final, precio_sin_impuestos, cost, currency, part_number, mpn, search_text, raw_json
        FROM products ${whereClause.sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...whereClause.params, safePageSize, offset],
    );
  } else {
    const candidateLimit = Math.max(safePageSize, Math.min(SEARCH_RANK_CANDIDATE_LIMIT, totalItems));
    const candidateRows = await all(
      db,
      `SELECT rowid, id, sku, code, slug, public_slug, image, name, title, brand, model, category, status, visibility, stock, price, price_minorista, price_mayorista, precio_minorista, precio_mayorista, precio_final, precio_sin_impuestos, cost, currency, part_number, mpn, search_text, raw_json
        FROM products ${whereClause.sql} ORDER BY ${orderBy} LIMIT ? OFFSET 0`,
      [...whereClause.params, candidateLimit],
    );
    const intent = computeSearchIntent(normalizedSearch);
    const ranked = rankRowsBySearchIntent(candidateRows, intent, { preferPositiveScores: Boolean(intent.modelPhrase || intent.replacementType || intent.skuOrMpn || intent.importantTokens?.length) });
    const pageEntries = ranked.slice(offset, offset + safePageSize);
    rows = pageEntries.map((entry) => entry.row);
    if (debugSearch) {
      searchDebug = {
        query: search,
        normalizedQuery: normalizedSearch,
        expandedQuery: intent.expandedTerms || [],
        appliedSynonyms: intent.appliedSynonyms || {},
        intentPartType: intent.intentPartType || "",
        brand: intent.brand || "",
        queryModel: intent.appleModel || null,
        results: getSearchDebugForRankedEntries(pageEntries, intent, safePageSize),
      };
    }
  }
  const selectMs = Date.now() - selectStartedAt;

  const parseStartedAt = Date.now();
  const items = rows.map((row) => buildProductSummary(row));
  const parseItemsMs = Date.now() - parseStartedAt;

  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const totalDurationMs = Date.now() - totalStartedAt;

  return {
    rows,
    items,
    page: safePage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
    source: "sqlite",
    search: search || undefined,
    searchDebug,
    countMs,
    selectMs,
    parseItemsMs,
    totalDurationMs,
  };
}

async function queryProducts(params = {}) {
  let result;
  try {
    result = await queryBase({ ...params, isPublicOnly: true });
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "query_products", reason: "sqlite_corrupt" });
      await repairCorruptSqlite({ reason: "query_products_corrupt" });
      result = await queryBase({ ...params, isPublicOnly: true });
    } else {
      throw error;
    }
  }
  console.log("[products-sqlite:queryProducts]", {
    page: result.page,
    pageSize: result.pageSize,
    search: params.search || "",
    sort: params.sort || "",
    totalItems: result.totalItems,
    rows: result.rows.length,
    countMs: result.countMs,
    selectMs: result.selectMs,
    parseItemsMs: result.parseItemsMs,
    totalDurationMs: result.totalDurationMs,
  });
  return result;
}

async function queryAdminProducts(params = {}) {
  let result;
  try {
    result = await queryBase({ ...params, isPublicOnly: false });
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "query_admin_products", reason: "sqlite_corrupt" });
      await repairCorruptSqlite({ reason: "query_admin_products_corrupt" });
      result = await queryBase({ ...params, isPublicOnly: false });
    } else {
      throw error;
    }
  }
  console.log("[products-sqlite:queryAdminProducts]", {
    page: result.page,
    pageSize: result.pageSize,
    search: params.search || "",
    sort: params.sort || "",
    totalItems: result.totalItems,
    rows: result.rows.length,
    countMs: result.countMs,
    selectMs: result.selectMs,
    parseItemsMs: result.parseItemsMs,
    totalDurationMs: result.totalDurationMs,
  });
  return result;
}

async function getProductBySlug(slug) {
  try {
    await ensureDbReadyForRequest();
    const db = await openDb();
    const row = await get(
      db,
      "SELECT rowid, raw_json, public_slug FROM products WHERE slug = ? LIMIT 1",
      [String(slug || "").trim()],
    );
    return parseRawItems(row ? [row] : [], { normalizePublic: true })[0] || null;
  } catch (error) {
    if (!isSqliteCorruptionError(error)) throw error;
    markSqliteCorruption(error, { phase: "get_product_by_slug", reason: "sqlite_corrupt" });
    await repairCorruptSqlite({ reason: "get_product_by_slug_corrupt" });
    return getProductBySlug(slug);
  }
}

async function getProductById(id) {
  try {
    await ensureDbReadyForRequest();
    const db = await openDb();
    const row = await get(db, "SELECT rowid, raw_json, public_slug FROM products WHERE id = ? LIMIT 1", [String(id || "").trim()]);
    return parseRawItems(row ? [row] : [], { normalizePublic: true })[0] || null;
  } catch (error) {
    if (!isSqliteCorruptionError(error)) throw error;
    markSqliteCorruption(error, { phase: "get_product_by_id", reason: "sqlite_corrupt" });
    await repairCorruptSqlite({ reason: "get_product_by_id_corrupt" });
    return getProductById(id);
  }
}

async function getProductByCode(code) {
  try {
    await ensureDbReadyForRequest();
    const db = await openDb();
    const target = String(code || "").trim();
    const row = await get(
      db,
      "SELECT rowid, raw_json, public_slug FROM products WHERE code = ? OR sku = ? LIMIT 1",
      [target, target],
    );
    return parseRawItems(row ? [row] : [], { normalizePublic: true })[0] || null;
  } catch (error) {
    if (!isSqliteCorruptionError(error)) throw error;
    markSqliteCorruption(error, { phase: "get_product_by_code", reason: "sqlite_corrupt" });
    await repairCorruptSqlite({ reason: "get_product_by_code_corrupt" });
    return getProductByCode(code);
  }
}

async function getProductByPublicSlugOrAnyIdentifier(value) {
  try {
    await ensureDbReadyForRequest();
    const db = await openDb();
    const target = String(value || "").trim();
    if (!target) return { foundBy: "none", source: "sqlite", product: null };
    const checks = [
    { field: "public_slug", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE public_slug = ? LIMIT 1" },
    { field: "slug", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE slug = ? LIMIT 1" },
    { field: "id", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE id = ? LIMIT 1" },
    { field: "sku", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE sku = ? LIMIT 1" },
    { field: "code", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE code = ? LIMIT 1" },
    { field: "partNumber", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE part_number = ? LIMIT 1" },
    { field: "mpn", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE mpn = ? LIMIT 1" },
    { field: "ean", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE ean = ? LIMIT 1" },
    { field: "gtin", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE gtin = ? LIMIT 1" },
    { field: "supplierCode", sql: "SELECT rowid, raw_json, public_slug FROM products WHERE supplier_code = ? LIMIT 1" },
  ];
    for (const check of checks) {
      const row = await get(db, check.sql, [target]);
      const product = parseRawItems(row ? [row] : [], { normalizePublic: true })[0] || null;
      if (product) return { foundBy: check.field, source: "sqlite", product };
    }
    return { foundBy: "none", source: "sqlite", product: null };
  } catch (error) {
    if (!isSqliteCorruptionError(error)) throw error;
    markSqliteCorruption(error, { phase: "get_product_by_any_identifier", reason: "sqlite_corrupt" });
    await repairCorruptSqlite({ reason: "get_product_by_any_identifier_corrupt" });
    return getProductByPublicSlugOrAnyIdentifier(value);
  }
}

const INVENTORY_IDENTIFIER_FIELDS = [
  { field: "id", column: "id" },
  { field: "sku", column: "sku" },
  { field: "product_id", column: "id" },
  { field: "code", column: "code" },
  { field: "publicSlug", column: "public_slug" },
  { field: "public_slug", column: "public_slug" },
  { field: "slug", column: "slug" },
  { field: "mpn", column: "mpn" },
  { field: "part_number", column: "part_number" },
  { field: "ean", column: "ean" },
  { field: "gtin", column: "gtin" },
  { field: "supplier_code", column: "supplier_code" },
];

function parseProductRawJson(row = {}) {
  try {
    return JSON.parse(row.raw_json || "{}") || {};
  } catch {
    return {};
  }
}

async function getInventoryProductByIdentifier(identifier) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const target = String(identifier || "").trim();
  if (!target) return null;
  for (const check of INVENTORY_IDENTIFIER_FIELDS) {
    const row = await get(
      db,
      `SELECT rowid, * FROM products WHERE LOWER(COALESCE(${check.column}, '')) = LOWER(?) LIMIT 1`,
      [target],
    );
    if (!row) continue;
    const raw = parseProductRawJson(row);
    return {
      source: "sqlite",
      foundBy: check.field,
      rowid: row.rowid,
      product: {
        ...buildProductSummary(row),
        raw,
      },
      raw,
    };
  }
  return null;
}

async function adjustStockForInventory(identifier, delta, { reason = "inventory", orderId = null, timestamp = new Date().toISOString() } = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const target = String(identifier || "").trim();
  if (!target) {
    const err = new Error("PRODUCT_IDENTIFIER_REQUIRED");
    err.code = "PRODUCT_IDENTIFIER_REQUIRED";
    throw err;
  }
  await run(db, "BEGIN IMMEDIATE");
  try {
    let resolved = null;
    for (const check of INVENTORY_IDENTIFIER_FIELDS) {
      const row = await get(
        db,
        `SELECT rowid, * FROM products WHERE LOWER(COALESCE(${check.column}, '')) = LOWER(?) LIMIT 1`,
        [target],
      );
      if (row) {
        resolved = { row, foundBy: check.field };
        break;
      }
    }
    if (!resolved) {
      const err = new Error(`PRODUCT_NOT_FOUND:${target}`);
      err.code = "PRODUCT_NOT_FOUND";
      err.identifier = target;
      throw err;
    }
    const raw = parseProductRawJson(resolved.row);
    const before = Math.trunc(toNumber(resolved.row.stock ?? raw.stock ?? raw.stockQuantity, 0));
    const numericDelta = Math.trunc(toNumber(delta, 0));
    const after = Math.max(0, before + numericDelta);
    raw.stock = after;
    raw.stockQuantity = after;
    raw.stockUpdatedAt = timestamp;
    raw.stockSource = "catalogInventoryRepo";
    await run(
      db,
      "UPDATE products SET stock = ?, raw_json = ? WHERE rowid = ?",
      [after, JSON.stringify(raw), resolved.row.rowid],
    );
    await run(db, "COMMIT");
    return {
      source: "sqlite",
      foundBy: resolved.foundBy,
      rowid: resolved.row.rowid,
      productId: resolved.row.id || raw.id || null,
      sku: resolved.row.sku || raw.sku || null,
      title: resolved.row.name || resolved.row.title || raw.name || raw.title || null,
      before,
      after,
      delta: numericDelta,
      reason,
      orderId,
      timestamp,
    };
  } catch (error) {
    try { await run(db, "ROLLBACK"); } catch {}
    throw error;
  }
}

async function getProductsByIdentifiers(identifiers = []) {
  const list = Array.isArray(identifiers) ? identifiers : [];
  const uniqueTargets = [...new Set(
    list.map((value) => String(value || "").trim()).filter(Boolean),
  )];
  const found = [];
  const missing = [];
  for (const identifier of uniqueTargets) {
    const resolved = await getProductByPublicSlugOrAnyIdentifier(identifier);
    if (resolved?.product) {
      found.push({
        identifier,
        foundBy: resolved.foundBy || "unknown",
        source: "sqlite",
        product: resolved.product,
      });
    } else {
      missing.push(identifier);
    }
  }
  return {
    source: "sqlite",
    requestedCount: uniqueTargets.length,
    foundCount: found.length,
    missingCount: missing.length,
    found,
    missing,
  };
}

async function getManifestFromDb() {
  try {
    const raw = await fsp.readFile(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function getCatalogHealth() {
  const paths = buildCatalogPathsInfo();
  const productsJsonExists = fs.existsSync(PRODUCTS_JSON_PATH);
  const sqliteExists = fs.existsSync(SQLITE_PATH);
  let totalRow = { total: 0 };
  let publicRow = { total: 0 };
  let privateExplicitRow = { total: 0 };
  let hiddenExplicitRow = { total: 0 };
  let missingVisibilityRow = { total: 0 };
  let missingStatusRow = { total: 0 };
  if (sqliteExists) {
    try {
      const db = await openDb();
      totalRow = await get(db, "SELECT COUNT(*) AS total FROM products");
      publicRow = await get(db, "SELECT COUNT(*) AS total FROM products WHERE is_public = 1");
      privateExplicitRow = await get(
        db,
        "SELECT COUNT(*) AS total FROM products WHERE visibility = 'private' OR status = 'private'",
      );
      hiddenExplicitRow = await get(
        db,
        "SELECT COUNT(*) AS total FROM products WHERE visibility = 'hidden' OR status = 'hidden'",
      );
      missingVisibilityRow = await get(
        db,
        "SELECT COUNT(*) AS total FROM products WHERE visibility IS NULL OR visibility = ''",
      );
      missingStatusRow = await get(
        db,
        "SELECT COUNT(*) AS total FROM products WHERE status IS NULL OR status = ''",
      );
    } catch (error) {
      if (isSqliteCorruptionError(error)) {
        markSqliteCorruption(error, { phase: "health", reason: "sqlite_query_failed" });
      } else {
        setCatalogError(error, { phase: "health", reason: "sqlite_query_failed" });
      }
    }
  }
  const manifest = await getManifestFromDb();
  let productsStats = null;
  try {
    productsStats = await fsp.stat(PRODUCTS_JSON_PATH);
  } catch {
    productsStats = null;
  }
  let isFresh = true;
  let freshnessReason = null;
  if (!manifest) {
    isFresh = false;
    freshnessReason = "manifest_missing";
  } else if (Number(manifest.sqliteSchemaVersion || 0) !== PRODUCTS_SQLITE_SCHEMA_VERSION) {
    isFresh = false;
    freshnessReason = "schema_version_changed";
  } else if (Number(manifest.mappingVersion || 0) !== CATALOG_MAPPING_VERSION) {
    isFresh = false;
    freshnessReason = "mapping_version_changed";
  } else if (Number(manifest.productsJsonSizeBytes || -1) !== Number(productsStats.size || 0)) {
    isFresh = false;
    freshnessReason = "products_json_size_changed";
  } else if (
    Math.floor(Number(manifest.productsJsonMtimeMs || -1)) !==
    Math.floor(Number(productsStats.mtimeMs || 0))
  ) {
    isFresh = false;
    freshnessReason = "products_json_mtime_changed";
  }
  const manifestPublicCount = Number(manifest?.publicProductCount || 0);
  const productCount = Number(totalRow?.total || 0);
  const publicProductCount = Number(publicRow?.total || 0);
  if (
    manifest &&
    manifestPublicCount > 0 &&
    productCount > 0 &&
    manifestPublicCount <= 125 &&
    productCount >= manifestPublicCount * 5
  ) {
    console.warn("[products-db] suspicious public count", {
      productCount,
      manifestPublicCount,
      ratio: Number((productCount / manifestPublicCount).toFixed(2)),
    });
  }
  return {
    source: "sqlite",
    ...paths,
    ready: Boolean(dbReady && sqliteExists && !catalogState.lastError),
    initializing: Boolean(catalogState.initializing),
    rebuilding: Boolean(catalogState.rebuilding),
    lastError: catalogState.lastError,
    lastErrorCode: catalogState.lastError?.code || null,
    lastErrorAt: catalogState.lastErrorAt,
    corruptDetected: Boolean(catalogState.corruptDetected),
    lastReadyAt: catalogState.lastReadyAt,
    lastRebuildStartedAt: catalogState.lastRebuildStartedAt,
    lastRebuildFinishedAt: catalogState.lastRebuildFinishedAt,
    lastRebuildDurationMs: catalogState.lastRebuildDurationMs,
    productsJsonExists,
    sqlitePath: SQLITE_PATH,
    sqliteExists,
    productCount,
    publicProductCount,
    privateExplicitCount: Number(privateExplicitRow?.total || 0),
    hiddenExplicitCount: Number(hiddenExplicitRow?.total || 0),
    missingVisibilityCount: Number(missingVisibilityRow?.total || 0),
    missingStatusCount: Number(missingStatusRow?.total || 0),
    sqliteSchemaVersion: PRODUCTS_SQLITE_SCHEMA_VERSION,
    catalogMappingVersion: CATALOG_MAPPING_VERSION,
    manifestSchemaVersion: Number(manifest?.sqliteSchemaVersion || 0) || null,
    manifestMappingVersion: Number(manifest?.mappingVersion || 0) || null,
    sqliteBuiltAt: manifest?.sqliteBuiltAt || null,
    productsJsonSizeBytes: Number(productsStats?.size || 0),
    productsJsonMtimeMs: Number(productsStats?.mtimeMs || 0),
    isFresh,
    freshnessReason,
    manifest,
    lastBuilt: manifest?.sqliteBuiltAt || null,
  };
}

async function getCatalogPublicityAudit() {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const rows = await all(db, `SELECT rowid, id, sku, code, name, title, status, visibility, enabled, deleted, archived, vip_only, wholesale_only, raw_json, is_public FROM products`);
  const rejectedCounts = { explicitPrivate: 0, explicitHidden: 0, explicitDraft: 0, explicitDisabled: 0, enabledFalse: 0, deleted: 0, archived: 0, vipOnly: 0, wholesaleOnly: 0, missingName: 0, missingIdentifier: 0, other: 0 };
  const visibilityDistribution = {};
  const statusDistribution = {};
  const topRawKeysCounter = new Map();
  const examplesRejected = [];
  for (const row of rows) {
    const v = normalizeQueryText(row.visibility || "") || "(empty)";
    const st = normalizeQueryText(row.status || "") || "(empty)";
    visibilityDistribution[v] = (visibilityDistribution[v] || 0) + 1;
    statusDistribution[st] = (statusDistribution[st] || 0) + 1;
    let raw = {};
    try { raw = JSON.parse(row.raw_json || "{}"); } catch {}
    for (const key of Object.keys(raw || {})) topRawKeysCounter.set(key, Number(topRawKeysCounter.get(key) || 0) + 1);
    const computed = computeProductPublicState(raw);
    if (!computed.isPublic) {
      let reasonMatched = false;
      if (v === 'private' || st === 'private') rejectedCounts.explicitPrivate += 1;
      if (v === 'hidden' || st === 'hidden') rejectedCounts.explicitHidden += 1;
      if (v === 'draft' || st === 'draft') rejectedCounts.explicitDraft += 1;
      if (v === 'disabled' || st === 'disabled') rejectedCounts.explicitDisabled += 1;
      if (computed.signals.enabledFalse) { rejectedCounts.enabledFalse += 1; reasonMatched = true; }
      if (computed.signals.deleted) { rejectedCounts.deleted += 1; reasonMatched = true; }
      if (computed.signals.archived) { rejectedCounts.archived += 1; reasonMatched = true; }
      if (computed.signals.vipOnly) { rejectedCounts.vipOnly += 1; reasonMatched = true; }
      if (computed.signals.wholesaleOnly) { rejectedCounts.wholesaleOnly += 1; reasonMatched = true; }
      if (computed.signals.missingName) { rejectedCounts.missingName += 1; reasonMatched = true; }
      if (computed.signals.missingIdentifier) { rejectedCounts.missingIdentifier += 1; reasonMatched = true; }
      if (!reasonMatched) rejectedCounts.other += 1;
      if (examplesRejected.length < 20) examplesRejected.push({ rowid: row.rowid, id: row.id, sku: row.sku, code: row.code, name: row.name || row.title || null, visibility: row.visibility || null, status: row.status || null, is_public: row.is_public, reason: computed.reason });
    }
  }
  const publicProductCount = rows.filter((r)=>Number(r.is_public||0)===1).length;
  const topRawKeys = Array.from(topRawKeysCounter.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([key, count]) => ({ key, count }));
  return { productCount: rows.length, publicProductCount, privateOrRejectedCount: rows.length - publicProductCount, rejectedCounts, visibilityDistribution, statusDistribution, topRawKeys, examplesRejected };
}

async function repairPublicFlags() {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const rows = await all(db, "SELECT rowid, raw_json, is_public FROM products ORDER BY rowid ASC");
  const beforePublicCount = rows.reduce((acc, row) => acc + (Number(row.is_public || 0) === 1 ? 1 : 0), 0);
  const rejectedCounts = { explicitPrivate: 0, explicitHidden: 0, explicitDraft: 0, explicitDisabled: 0, enabledFalse: 0, deleted: 0, archived: 0, vipOnly: 0, wholesaleOnly: 0, missingName: 0, missingIdentifier: 0, other: 0 };
  let afterPublicCount = 0;
  let updatedRows = 0;
  await run(db, "BEGIN IMMEDIATE TRANSACTION");
  try {
    for (const row of rows) {
      let raw = {};
      try { raw = JSON.parse(row.raw_json || "{}"); } catch {}
      const mapped = mapProductRow(raw, { rowNumber: row.rowid });
      const computed = computeProductPublicState(raw);
      if (mapped.is_public === 1) afterPublicCount += 1;
      if (!computed.isPublic) {
        const v = normalizeQueryText(getField(raw, ["visibility", "visibilidad"]) || "");
        const st = normalizeQueryText(getField(raw, ["status", "estado"]) || "");
        if (v === "private" || st === "private") rejectedCounts.explicitPrivate += 1;
        if (v === "hidden" || st === "hidden") rejectedCounts.explicitHidden += 1;
        if (v === "draft" || st === "draft") rejectedCounts.explicitDraft += 1;
        if (v === "disabled" || st === "disabled") rejectedCounts.explicitDisabled += 1;
        if (computed.signals.enabledFalse) rejectedCounts.enabledFalse += 1;
        if (computed.signals.deleted) rejectedCounts.deleted += 1;
        if (computed.signals.archived) rejectedCounts.archived += 1;
        if (computed.signals.vipOnly) rejectedCounts.vipOnly += 1;
        if (computed.signals.wholesaleOnly) rejectedCounts.wholesaleOnly += 1;
        if (computed.signals.missingName) rejectedCounts.missingName += 1;
        if (computed.signals.missingIdentifier) rejectedCounts.missingIdentifier += 1;
      }
      const changes = await run(db, `UPDATE products SET is_public = ?, search_text = ?, public_slug = ?, name = ?, title = ?, sku = ?, code = ?, model = ?, brand = ?, category = ?, stock = ?, price = ?, raw_json = ? WHERE rowid = ?`, [
        mapped.is_public, mapped.search_text, mapped.public_slug, mapped.name, mapped.title, mapped.sku, mapped.code, mapped.model, mapped.brand, mapped.category, mapped.stock, mapped.price, mapped.raw_json, row.rowid,
      ]);
      updatedRows += Number(changes?.changes || 0);
    }
    await run(db, "COMMIT");
  } catch (error) {
    await run(db, "ROLLBACK");
    throw error;
  }
  return { ok: true, total: rows.length, beforePublicCount, afterPublicCount, updatedRows, rejectedCounts };
}

async function bulkPublication({ action = "publish", scope = "private_products", dryRun = false } = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const rows = await all(db, "SELECT rowid, id, sku, code, raw_json, is_public FROM products ORDER BY rowid ASC");
  const beforePublicCount = rows.reduce((acc, row) => acc + (Number(row.is_public || 0) === 1 ? 1 : 0), 0);
  let updatedRows = 0;
  let skipped = 0;
  const examplesUpdated = [];
  for (const row of rows) {
    let raw = {};
    try { raw = JSON.parse(row.raw_json || "{}"); } catch {}
    const computed = computeProductPublicState(raw);
    const isPrivate = !computed.isPublic;
    if (!(action === "publish" && scope === "private_products" && isPrivate)) {
      skipped += 1;
      continue;
    }
    const patch = { visibility: "public", status: "active", enabled: true };
    const merged = { ...raw, ...patch };
    const mapped = mapProductRow(merged, { rowNumber: row.rowid });
    if (!dryRun) {
      await run(
        db,
        `UPDATE products SET visibility=?, status=?, enabled=?, is_public=?, search_text=?, public_slug=?, raw_json=? WHERE rowid=?`,
        [mapped.visibility, mapped.status, mapped.enabled, mapped.is_public, mapped.search_text, mapped.public_slug, mapped.raw_json, row.rowid],
      );
      await saveProductOverride(row.id || row.sku || row.code, merged, "admin_bulk_publish");
    }
    updatedRows += 1;
    if (examplesUpdated.length < 10) examplesUpdated.push({ identifier: row.id || row.sku || row.code, reasonBefore: computed.reason, reasonAfter: computeProductPublicState(merged).reason });
  }
  const afterPublicCount = dryRun ? beforePublicCount + updatedRows : Number((await get(db, "SELECT COUNT(*) AS total FROM products WHERE is_public = 1"))?.total || 0);
  return { ok: true, beforePublicCount, afterPublicCount, updatedRows, skipped, examplesUpdated, dryRun: Boolean(dryRun) };
}

async function scanBulkPublishCandidates({ filters = {}, limit = 500, includePrivateHidden = false, includeDisabledImportCandidates = false, onEligible = null } = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const safeLimit = Math.max(1, Math.min(50000, Number(limit) || 500));
  const totals = await get(
    db,
    "SELECT COUNT(*) AS totalCatalogProducts, SUM(CASE WHEN COALESCE(is_public, 0) = 1 THEN 1 ELSE 0 END) AS publicProductsCount FROM products",
  );
  const summary = createBulkPublishSummary({
    totalCatalogProducts: Number(totals?.totalCatalogProducts || 0),
    publicProductsCount: Number(totals?.publicProductsCount || 0),
  });

  let lastRowid = 0;
  let reachedLimit = false;
  while (true) {
    const rows = await all(
      db,
      `SELECT rowid, id, sku, code, slug, public_slug, image, name, title, brand, model, category,
              status, visibility, stock, price, price_minorista, precio_minorista, precio_final, raw_json, is_public
       FROM products
       WHERE rowid > ? AND COALESCE(is_public, 0) != 1
       ORDER BY rowid ASC
       LIMIT ?`,
      [lastRowid, BULK_PUBLISH_CHUNK_SIZE],
    );
    if (!rows.length) break;
    for (const row of rows) {
      lastRowid = Math.max(lastRowid, Number(row.rowid || 0));
      const product = hydrateBulkPublishProduct(row);
      if (!matchesBulkPublishFilters(product, filters)) continue;

      summary.scannedRows += 1;
      summary.totalScanned = summary.scannedRows;
      const result = resolveBulkPublishEligibility(product, { includePrivateHidden, includeDisabledImportCandidates });
      recordBulkPublishEvaluation(summary, product, result, { includePrivateHidden });

      if (result.eligible && typeof onEligible === "function" && summary.eligibleCount <= safeLimit) {
        await onEligible(product, result, summary.eligibleCount);
      }
      if (result.eligible && summary.eligibleCount >= safeLimit) {
        reachedLimit = true;
        break;
      }
    }
    if (reachedLimit) break;
  }
  return summary;
}

async function previewBulkPublish({ filters = {}, limit = 500, includePrivateHidden = false, includeDisabledImportCandidates = false } = {}) {
  return scanBulkPublishCandidates({
    filters,
    limit,
    includePrivateHidden: includePrivateHidden === true,
    includeDisabledImportCandidates: includeDisabledImportCandidates === true,
  });
}

async function bulkPublishEligible({
  dryRun = false,
  filters = {},
  limit = 500,
  publishMode = "eligible_only",
  includePrivateHidden = false,
  confirmPrivateHiddenPublish = false,
  includeDisabledImportCandidates = false,
  confirmDisabledImportPublish = false,
} = {}) {
  if (publishMode !== "eligible_only") throw new Error("publishMode must be eligible_only");
  let updatedCount = 0;

  if (includePrivateHidden === true && confirmPrivateHiddenPublish !== true && dryRun !== true) {
    const preview = await previewBulkPublish({ filters, limit, includePrivateHidden: true, includeDisabledImportCandidates: includeDisabledImportCandidates === true });
    if (Number(preview.eligiblePrivateHiddenCandidates || 0) > 0) {
      const error = new Error("confirmPrivateHiddenPublish is required when includePrivateHidden=true");
      error.code = "PRIVATE_HIDDEN_CONFIRMATION_REQUIRED";
      throw error;
    }
  }

  if (includeDisabledImportCandidates === true && confirmDisabledImportPublish !== true && dryRun !== true) {
    const preview = await previewBulkPublish({ filters, limit, includePrivateHidden: includePrivateHidden === true, includeDisabledImportCandidates: true });
    if (Number(preview.eligibleDisabledImportCandidates || 0) > 0) {
      const error = new Error("confirmDisabledImportPublish is required when includeDisabledImportCandidates=true");
      error.code = "DISABLED_IMPORT_CONFIRMATION_REQUIRED";
      throw error;
    }
  }

  const summary = await scanBulkPublishCandidates({
    filters,
    limit,
    includePrivateHidden: includePrivateHidden === true,
    includeDisabledImportCandidates: includeDisabledImportCandidates === true,
    async onEligible(product, result) {
      const identifier = product.id || product.sku || product.code || product.public_slug || product.slug;
      if (!identifier) return;
      const patch = buildBulkPublishPatch(product, result);
      if (!dryRun) await updateProductByIdentifier(identifier, patch);
      updatedCount += 1;
    },
  });
  return {
    ok: true,
    dryRun: Boolean(dryRun),
    publishMode,
    includePrivateHidden: includePrivateHidden === true,
    includeDisabledImportCandidates: includeDisabledImportCandidates === true,
    ...summary,
    updatedCount,
  };
}

async function getCatalogFieldAudit({ sampleSize = 300 } = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const safeSampleSize = Math.max(50, Math.min(2000, Number(sampleSize) || 300));
  const summary = await get(
    db,
    "SELECT COUNT(*) AS productCount, SUM(CASE WHEN is_public = 1 THEN 1 ELSE 0 END) AS publicProductCount FROM products",
  );
  const rows = await all(
    db,
    `SELECT rowid, id, sku, code, name, title, is_public, search_text, raw_json
     FROM products
     ORDER BY rowid ASC
     LIMIT ?`,
    [safeSampleSize],
  );
  const rejectedRows = await all(
    db,
    `SELECT rowid, id, sku, code, name, title, visibility, status, enabled, deleted, archived, vip_only, wholesale_only, raw_json
     FROM products
     WHERE is_public = 0
     ORDER BY rowid ASC
     LIMIT 20`,
  );
  const topKeysCounter = new Map();
  const priceKeysCounter = new Map();
  const nameKeysCounter = new Map();
  const skuKeysCounter = new Map();
  const inc = (map, key) => map.set(key, Number(map.get(key) || 0) + 1);
  for (const row of rows) {
    let raw = {};
    try {
      raw = JSON.parse(row.raw_json || "{}");
    } catch {
      raw = {};
    }
    for (const key of Object.keys(raw)) {
      inc(topKeysCounter, key);
      const nk = normalizeFieldKey(key);
      if (
        [
          "price",
          "precio",
          "preciofinal",
          "priceminorista",
          "pricemayorista",
          "preciominorista",
          "preciomayorista",
          "retailprice",
          "wholesaleprice",
        ].includes(nk)
      ) {
        inc(priceKeysCounter, key);
      }
      if (["name", "title", "nombre", "productname", "description", "model"].includes(nk)) inc(nameKeysCounter, key);
      if (["sku", "code", "codigo", "partnumber", "mpn", "ean", "gtin", "suppliercode"].includes(nk)) inc(skuKeysCounter, key);
    }
  }
  const topMap = (map, limit = 20) =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, count]) => ({ key, count }));
  return {
    productCount: Number(summary?.productCount || 0),
    publicProductCount: Number(summary?.publicProductCount || 0),
    sampledRows: rows.length,
    topKeys: topMap(topKeysCounter, 30),
    detectedPriceFields: topMap(priceKeysCounter, 20),
    detectedNameFields: topMap(nameKeysCounter, 20),
    detectedSkuCodeModelFields: topMap(skuKeysCounter, 20),
    sampleImportedProducts: rows.slice(0, 10).map((row) => ({
      rowid: row.rowid,
      id: row.id,
      sku: row.sku,
      code: row.code,
      name: row.name || row.title || null,
      searchTextPreview: String(row.search_text || "").slice(0, 180),
    })),
    sampleRejectedByPublicity: rejectedRows.map((row) => ({
      rowid: row.rowid,
      id: row.id,
      sku: row.sku,
      code: row.code,
      name: row.name || row.title || null,
      visibility: row.visibility || null,
      status: row.status || null,
      enabled: row.enabled,
      deleted: row.deleted,
      archived: row.archived,
      vip_only: row.vip_only,
      wholesale_only: row.wholesale_only,
    })),
  };
}

async function debugCatalogSearch({ search = "", limit = 20 } = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const whereClause = buildWhereClause({ search, isPublicOnly: true });
  const totalRow = await get(db, `SELECT COUNT(*) AS total FROM products ${whereClause.sql}`, whereClause.params);
  const sampleMatches = await all(
    db,
    `SELECT rowid, id, sku, code, name, title, model, brand, category, public_slug, part_number, mpn, search_text, raw_json
     FROM products ${whereClause.sql}
     ORDER BY rowid ASC
     LIMIT ?`,
    [...whereClause.params, Math.max(1, Math.min(SEARCH_RANK_CANDIDATE_LIMIT, Number(limit) || 20))],
  );
  const intent = computeSearchIntent(search);
  const ranked = rankRowsBySearchIntent(sampleMatches, intent, { preferPositiveScores: true });
  const normalizedSearch = normalizeQueryText(search || "");
  const sqliteMatchesAny = await get(db, `SELECT COUNT(*) AS total FROM products WHERE search_text LIKE ?`, [`%${normalizedSearch}%`]);
  const sqlitePublicMatches = await get(db, `SELECT COUNT(*) AS total FROM products WHERE is_public = 1 AND search_text LIKE ?`, [`%${normalizedSearch}%`]);
  let diagnosis = "match_public";
  if (Number(sqliteMatchesAny?.total || 0) === 0) diagnosis = "no_existe_en_sqlite";
  else if (Number(sqlitePublicMatches?.total || 0) === 0) diagnosis = "matchea_pero_is_public_0";
  else if (Number(totalRow?.total || 0) === 0) diagnosis = "no_matchea_search_text";
  return {
    search,
    normalizedQuery: intent.normalizedQuery,
    expandedQuery: intent.expandedTerms || [],
    appliedSynonyms: intent.appliedSynonyms || {},
    intentPartType: intent.intentPartType || "",
    brand: intent.brand || "",
    totalMatches: Number(totalRow?.total || 0),
    diagnosis,
    queryModel: intent.appleModel || null,
    rankedResults: getSearchDebugForRankedEntries(ranked, intent, limit),
    sampleMatches: sampleMatches.map((row) => ({
      id: row.id || null,
      sku: row.sku || null,
      code: row.code || null,
      name: row.name || null,
      title: row.title || null,
      model: row.model || null,
      publicSlug: row.public_slug || null,
      searchTextPreview: String(row.search_text || "").slice(0, 220),
    })),
  };
}


async function debugPublicationByIdentifier(identifier = "") {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const term = String(identifier || "").trim();
  if (!term) return { identifier: term, found: false };
  const q = `%${normalizeQueryText(term)}%`;
  const row = await get(db, `SELECT rowid, * FROM products WHERE
      LOWER(COALESCE(id,'')) = LOWER(?) OR LOWER(COALESCE(sku,'')) = LOWER(?) OR LOWER(COALESCE(code,'')) = LOWER(?) OR LOWER(COALESCE(public_slug,'')) = LOWER(?) OR LOWER(COALESCE(slug,'')) = LOWER(?)
      OR LOWER(COALESCE(name,'')) LIKE ? OR LOWER(COALESCE(title,'')) LIKE ? OR LOWER(COALESCE(model,'')) LIKE ? OR LOWER(COALESCE(part_number,'')) LIKE ?
      OR LOWER(COALESCE(mpn,'')) LIKE ? OR LOWER(COALESCE(ean,'')) LIKE ? OR LOWER(COALESCE(gtin,'')) LIKE ? OR LOWER(COALESCE(supplier_code,'')) LIKE ? OR LOWER(COALESCE(search_text,'')) LIKE ? LIMIT 1`,
    [term, term, term, term, term, q, q, q, q, q, q, q, q, q]);
  if (!row) return { identifier: term, found: false };
  let raw = {};
  try { raw = JSON.parse(row.raw_json || "{}"); } catch {}
  const computed = computeProductPublicState(raw);
  const normalizedSearch = normalizeQueryText(term);
  return {
    identifier: term, found: true, foundBy: "sqlite",
    raw: {
      id: raw.id || null, sku: raw.sku || raw.SKU || null, code: raw.code || raw.Code || null, name: raw.name || raw.Name || null, title: raw.title || raw.Title || null, model: raw.model || null,
      description: raw.description || raw.descripcion || null, shortDescription: raw.shortDescription || raw.short_description || null,
      visibility: raw.visibility || raw.visibilidad || null, status: raw.status || raw.estado || null, enabled: raw.enabled, deleted: raw.deleted, archived: raw.archived, vip_only: raw.vip_only ?? raw.vipOnly, wholesaleOnly: raw.wholesaleOnly ?? raw.wholesale_only,
    },
    sqlite: {
      rowid: row.rowid, id: row.id, sku: row.sku, code: row.code, name: row.name, title: row.title, model: row.model, public_slug: row.public_slug, visibility: row.visibility, status: row.status, enabled: row.enabled, deleted: row.deleted, archived: row.archived, vip_only: row.vip_only, wholesale_only: row.wholesale_only, is_public: row.is_public, search_text: row.search_text,
    },
    computed,
    wouldAppearInPublicQuery: Number(row.is_public || 0) === 1,
    wouldMatchSearch: String(row.search_text || "").includes(normalizedSearch),
  };
}
async function getCatalogPriceAudit({ limit = 20 } = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  const totals = await get(
    db,
    `SELECT
      COUNT(*) AS totalProducts,
      SUM(CASE WHEN COALESCE(price_minorista, price, precio_minorista, precio_final) = 0 THEN 1 ELSE 0 END) AS zeroPriceCount,
      SUM(CASE WHEN COALESCE(price_minorista, price, precio_minorista, precio_final) IS NULL THEN 1 ELSE 0 END) AS nullPriceCount,
      SUM(CASE WHEN COALESCE(price_minorista, price, precio_minorista, precio_final) > 0 THEN 1 ELSE 0 END) AS pricedCount
    FROM products`,
  );
  const examplesZeroPrice = await all(
    db,
    `SELECT id, sku, name, price, price_minorista, price_mayorista, precio_final, raw_json
     FROM products
     WHERE COALESCE(price_minorista, price, precio_minorista, precio_final) = 0
     ORDER BY rowid ASC
     LIMIT ?`,
    [safeLimit],
  );
  const examplesPriced = await all(
    db,
    `SELECT id, sku, name, price, price_minorista, price_mayorista, precio_final, raw_json
     FROM products
     WHERE COALESCE(price_minorista, price, precio_minorista, precio_final) > 0
     ORDER BY rowid ASC
     LIMIT ?`,
    [safeLimit],
  );
  const pickRawAliases = (raw) => {
    const aliases = {};
    const keys = [
      "price",
      "precio",
      "precio_final",
      "precioFinal",
      "finalPrice",
      "salePrice",
      "priceArs",
      "precioARS",
      "precio_ars",
      "precioConIva",
      "precio_con_iva",
      "price_minorista",
      "precio_minorista",
      "price_mayorista",
      "precio_mayorista",
      "retailPrice",
      "wholesalePrice",
    ];
    for (const key of keys) {
      if (raw && Object.prototype.hasOwnProperty.call(raw, key)) aliases[key] = raw[key];
    }
    return aliases;
  };
  const serialize = (row) => {
    let raw = {};
    try {
      raw = JSON.parse(row.raw_json || "{}");
    } catch {
      raw = {};
    }
    return {
      id: row.id || null,
      sku: row.sku || null,
      name: row.name || null,
      rawPriceAliases: pickRawAliases(raw),
      mappedPrice: toFiniteNumberOrNull(row.price),
      price_minorista: toFiniteNumberOrNull(row.price_minorista),
      price_mayorista: toFiniteNumberOrNull(row.price_mayorista),
      precio_final: toFiniteNumberOrNull(row.precio_final),
    };
  };
  return {
    totalProducts: Number(totals?.totalProducts || 0),
    zeroPriceCount: Number(totals?.zeroPriceCount || 0),
    nullPriceCount: Number(totals?.nullPriceCount || 0),
    pricedCount: Number(totals?.pricedCount || 0),
    examplesZeroPrice: examplesZeroPrice.map(serialize),
    examplesPriced: examplesPriced.map(serialize),
  };
}

function isRebuildInProgress() {
  return Boolean(rebuildPromise);
}

module.exports = {
  ensureProductsDb,
  ensureProductsDbOnce,
  rebuildProductsDbFromJson,
  isRebuildInProgress,
  repairCorruptSqlite,
  isSqliteCorruptionError,
  catalogStateSnapshot,
  setCatalogError,
  clearCatalogError,
  queryProducts,
  queryAdminProducts,
  getProductBySlug,
  getProductById,
  getProductByCode,
  getProductByPublicSlugOrAnyIdentifier,
  getInventoryProductByIdentifier,
  adjustStockForInventory,
  getProductsByIdentifiers,
  getManifestFromDb,
  getCatalogHealth,
  getCatalogPriceAudit,
  getCatalogPublicityAudit,
  getCatalogFieldAudit,
  debugCatalogSearch,
  debugPublicationByIdentifier,
  repairPublicFlags,
  bulkPublication,
  resolveBulkPublishEligibility,
  summarizeBulkPublishProducts,
  buildBulkPublishPatch,
  previewBulkPublish,
  bulkPublishEligible,
  computeProductPublicState,
  updateProductByIdentifier,
  normalizeProductForPublic,
  normalizeProductForAdminList,
  normalizeQueryText,
  computeSearchIntent,
  parseAppleModel,
  extractAppleModels,
  getProductAppleModelInfo,
  isAppleVariantMismatch,
  scoreProductAgainstIntent,
  rankRowsBySearchIntent,
  PRODUCTS_SQLITE_SCHEMA_VERSION,
  CATALOG_MAPPING_VERSION,
  getField,
  isProductPublic,
  mapProductRow,
  SQLITE_PATH,
  createInitializingError,
  SQLITE_CORRUPT_CODE,
};
