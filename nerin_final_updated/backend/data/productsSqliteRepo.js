const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const sqlite3 = require("sqlite3");
const productsStreamRepo = require("./productsStreamRepo");
const { dataPath } = require("../utils/dataDir");
const {
  PART_LABELS,
  classifyCatalogProduct,
  normalizeText: normalizeCatalogText,
  parseCatalogQuery,
} = require("../utils/catalogClassifier");
const {
  isRealScreenProduct,
  isScreenAdhesiveProduct,
} = require("../utils/screenProductClassifier");

const PRODUCTS_JSON_PATH = dataPath("products.json");
function resolveSqlitePath() {
  const configured = String(process.env.DATABASE_PATH || "").trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }
  return dataPath("products.sqlite");
}

const SQLITE_PATH = resolveSqlitePath();
const MANIFEST_PATH = dataPath("products.manifest.json");
const OVERRIDES_PATH = dataPath("products.overrides.json");
const COUNT_CACHE_TTL_MS = 60_000;
const PRODUCTS_SQLITE_SCHEMA_VERSION = 7;
const CATALOG_MAPPING_VERSION = 5;
const BULK_PUBLISH_CHUNK_SIZE = 1000;
const SEARCH_RANK_CANDIDATE_LIMIT = 1200;
const ENABLE_SQLITE_QUERY_PLAN =
  String(process.env.CATALOG_SQLITE_EXPLAIN || "").trim().toLowerCase() === "true";
const DEBUG_PRICE_MAPPING =
  String(process.env.DEBUG_PRICE_MAPPING || "").trim().toLowerCase() === "true";
const IS_PRODUCTION_RUNTIME = process.env.NODE_ENV === "production";
const CATALOG_AUTO_REBUILD =
  String(process.env.CATALOG_AUTO_REBUILD || "").trim().toLowerCase() === "true";
const TEST_REBUILD_DELAY_MS =
  process.env.NODE_ENV === "test"
    ? Math.max(0, Number(process.env.CATALOG_REBUILD_TEST_DELAY_MS || 0) || 0)
    : 0;
const DEFAULT_REBUILD_TIMEOUT_MS = IS_PRODUCTION_RUNTIME ? 8 * 60 * 1000 : 2 * 60 * 1000;
const CATALOG_REBUILD_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.CATALOG_REBUILD_TIMEOUT_MS || DEFAULT_REBUILD_TIMEOUT_MS) || DEFAULT_REBUILD_TIMEOUT_MS,
);
const SEARCH_INDEX_INSERT_SQL = `INSERT INTO product_search_index (
  product_id, product_rowid, public_slug, title, normalized_title, sku, mpn, part_number, brand,
  device_brand, compatible_brand, official_brand, is_compatible_for_brand, part_type,
  model_family, model_base, model_generation, model_variant, network_variant, quality_tier,
  has_frame, color, stock, stock_status, is_stock_real, price, has_image, is_public,
  classification_confidence, search_blob, filters_blob, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const REJECTED_STATE_VALUES = new Set([
  "hidden",
  "private",
  "draft",
  "disabled",
  "archived",
  "deleted",
]);
const PUBLIC_VISIBILITY_VALUES = new Set(["public", "published", "visible"]);
const PRIVATE_STATE_VALUES = new Set(["private", "privado"]);
const HIDDEN_STATE_VALUES = new Set(["hidden", "oculto"]);
const DRAFT_STATE_VALUES = new Set(["draft", "borrador"]);
const DISABLED_STATE_VALUES = new Set(["disabled", "deshabilitado", "inactive", "inactivo"]);
const ARCHIVED_STATE_VALUES = new Set(["archived", "archivado"]);
const DELETED_STATE_VALUES = new Set(["deleted", "eliminado"]);
const PUBLIC_DESCRIPTION_FALLBACK =
  "Producto disponible para cotización. Consultanos por compatibilidad, stock y condiciones.";

let dbInstance = null;
let ftsEnabled = false;
let dbReadyPromise = null;
let dbReady = false;
let rebuildPromise = null;
let sqliteOptimizePromise = null;
let sqliteMaintenancePromise = null;
const countCache = new Map();
const SQLITE_CORRUPT_CODE = "CATALOG_SQLITE_CORRUPT";
const catalogState = {
  ready: false,
  initializing: false,
  rebuilding: false,
  progress: 0,
  total: 0,
  processed: 0,
  corruptDetected: false,
  failed: false,
  lastError: null,
  lastErrorAt: null,
  lastReadyAt: null,
  lastRebuildStartedAt: null,
  lastRebuildFinishedAt: null,
  lastRebuildDurationMs: null,
  startedAt: null,
  finishedAt: null,
  mappingVersion: CATALOG_MAPPING_VERSION,
  schemaVersion: PRODUCTS_SQLITE_SCHEMA_VERSION,
};

function shouldAllowAutomaticRebuild() {
  return !IS_PRODUCTION_RUNTIME || CATALOG_AUTO_REBUILD;
}

function catalogStateSnapshot() {
  return { ...catalogState, automaticRebuildEnabled: shouldAllowAutomaticRebuild(), rebuildTimeoutMs: CATALOG_REBUILD_TIMEOUT_MS };
}

function updateCatalogProgress(processed, total = catalogState.total) {
  const safeProcessed = Math.max(0, Number(processed || 0));
  const safeTotal = Math.max(0, Number(total || 0));
  catalogState.processed = safeProcessed;
  catalogState.total = safeTotal;
  catalogState.progress = safeTotal > 0 ? Math.min(1, safeProcessed / safeTotal) : 0;
}

function normalizeManifest(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  return {
    ...parsed,
    sqliteSchemaVersion: Number(parsed.sqliteSchemaVersion || parsed.PRODUCTS_SQLITE_SCHEMA_VERSION || 0) || null,
    mappingVersion: Number(parsed.mappingVersion || parsed.CATALOG_MAPPING_VERSION || 0) || null,
    productCount: Number(parsed.productCount || 0) || 0,
    publicProductCount: Number(parsed.publicProductCount || parsed.publicCount || 0) || 0,
    productsJsonSizeBytes: Number(parsed.productsJsonSizeBytes || parsed.productsJsonSize || 0) || 0,
    productsJsonMtimeMs: Number(parsed.productsJsonMtimeMs || 0) || 0,
    productsJsonSha256: parsed.productsJsonSha256 || parsed.productsJsonHash || null,
  };
}

async function readManifest() {
  try {
    return normalizeManifest(JSON.parse(await fsp.readFile(MANIFEST_PATH, "utf8")));
  } catch {
    return null;
  }
}

async function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function sleep(ms) {
  if (!ms) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  catalogState.ready = Boolean(dbReady);
  catalogState.failed = true;
  catalogState.corruptDetected = Boolean(isCorrupt);
}

function clearCatalogError() {
  catalogState.lastError = null;
  catalogState.lastErrorAt = null;
  catalogState.failed = false;
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
  if (sqliteMaintenancePromise) {
    await sqliteMaintenancePromise.catch(() => {});
  }
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
        else {
          db.serialize();
          resolve(db);
        }
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

async function ensureTableColumns(db, tableName, columnDefinitions = {}) {
  const columns = await all(db, `PRAGMA table_info(${tableName})`);
  const existing = new Set(columns.map((column) => String(column.name || "").toLowerCase()));
  for (const [name, definition] of Object.entries(columnDefinitions)) {
    if (existing.has(String(name).toLowerCase())) continue;
    await run(db, `ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`);
    existing.add(String(name).toLowerCase());
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
      availability TEXT,
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
  await ensureTableColumns(db, "products", {
    id: "TEXT",
    sku: "TEXT",
    code: "TEXT",
    slug: "TEXT",
    public_slug: "TEXT",
    image: "TEXT",
    name: "TEXT",
    title: "TEXT",
    brand: "TEXT",
    model: "TEXT",
    category: "TEXT",
    part_number: "TEXT",
    mpn: "TEXT",
    ean: "TEXT",
    gtin: "TEXT",
    supplier_code: "TEXT",
    status: "TEXT",
    visibility: "TEXT",
    availability: "TEXT",
    stock: "INTEGER",
    price: "REAL",
    price_minorista: "REAL",
    price_mayorista: "REAL",
    precio_minorista: "REAL",
    precio_mayorista: "REAL",
    precio_final: "REAL",
    precio_sin_impuestos: "REAL",
    cost: "REAL",
    currency: "TEXT",
    is_public: "INTEGER",
    enabled: "INTEGER",
    deleted: "INTEGER",
    archived: "INTEGER",
    vip_only: "INTEGER",
    wholesale_only: "INTEGER",
    search_text: "TEXT",
    raw_json: "TEXT",
  });

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
    "CREATE INDEX IF NOT EXISTS idx_products_model ON products(model)",
    "CREATE INDEX IF NOT EXISTS idx_products_availability ON products(availability)",
    "CREATE INDEX IF NOT EXISTS idx_products_visibility_nocase ON products(visibility COLLATE NOCASE)",
    "CREATE INDEX IF NOT EXISTS idx_products_status_nocase ON products(status COLLATE NOCASE)",
    "CREATE INDEX IF NOT EXISTS idx_products_category_nocase ON products(category COLLATE NOCASE)",
    "CREATE INDEX IF NOT EXISTS idx_products_brand_nocase ON products(brand COLLATE NOCASE)",
    "CREATE INDEX IF NOT EXISTS idx_products_model_nocase ON products(model COLLATE NOCASE)",
    "CREATE INDEX IF NOT EXISTS idx_products_is_public ON products(is_public)",
    "CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock)",
    "CREATE INDEX IF NOT EXISTS idx_products_price ON products(price)",
    "CREATE INDEX IF NOT EXISTS idx_products_public_category_brand ON products(is_public, category, brand)",
    "CREATE INDEX IF NOT EXISTS idx_products_public_stock_price ON products(is_public, stock, price)",
    "CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)",
  ];

  for (const sql of indexSql) {
    await run(db, sql);
  }

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS product_search_index (
      product_id TEXT,
      product_rowid INTEGER,
      public_slug TEXT,
      title TEXT,
      normalized_title TEXT,
      sku TEXT,
      mpn TEXT,
      part_number TEXT,
      brand TEXT,
      device_brand TEXT,
      compatible_brand TEXT,
      official_brand TEXT,
      is_compatible_for_brand INTEGER,
      part_type TEXT,
      model_family TEXT,
      model_base TEXT,
      model_generation TEXT,
      model_variant TEXT,
      network_variant TEXT,
      quality_tier TEXT,
      has_frame INTEGER,
      color TEXT,
      stock INTEGER,
      stock_status TEXT,
      is_stock_real INTEGER,
      price REAL,
      has_image INTEGER,
      is_public INTEGER,
      classification_confidence REAL,
      search_blob TEXT,
      filters_blob TEXT,
      updated_at TEXT
    )`,
  );
  await ensureTableColumns(db, "product_search_index", {
    product_id: "TEXT",
    product_rowid: "INTEGER",
    public_slug: "TEXT",
    title: "TEXT",
    normalized_title: "TEXT",
    sku: "TEXT",
    mpn: "TEXT",
    part_number: "TEXT",
    brand: "TEXT",
    device_brand: "TEXT",
    compatible_brand: "TEXT",
    official_brand: "TEXT",
    is_compatible_for_brand: "INTEGER",
    part_type: "TEXT",
    model_family: "TEXT",
    model_base: "TEXT",
    model_generation: "TEXT",
    model_variant: "TEXT",
    network_variant: "TEXT",
    quality_tier: "TEXT",
    has_frame: "INTEGER",
    color: "TEXT",
    stock: "INTEGER",
    stock_status: "TEXT",
    is_stock_real: "INTEGER",
    price: "REAL",
    has_image: "INTEGER",
    is_public: "INTEGER",
    classification_confidence: "REAL",
    search_blob: "TEXT",
    filters_blob: "TEXT",
    updated_at: "TEXT",
  });

  const searchIndexSql = [
    "CREATE INDEX IF NOT EXISTS idx_search_product_id ON product_search_index(product_id)",
    "CREATE INDEX IF NOT EXISTS idx_search_product_rowid ON product_search_index(product_rowid)",
    "CREATE INDEX IF NOT EXISTS idx_search_public_slug ON product_search_index(public_slug)",
    "CREATE INDEX IF NOT EXISTS idx_search_sku ON product_search_index(sku)",
    "CREATE INDEX IF NOT EXISTS idx_search_mpn ON product_search_index(mpn)",
    "CREATE INDEX IF NOT EXISTS idx_search_part_type ON product_search_index(part_type)",
    "CREATE INDEX IF NOT EXISTS idx_search_device_brand ON product_search_index(device_brand)",
    "CREATE INDEX IF NOT EXISTS idx_search_model_base ON product_search_index(model_base)",
    "CREATE INDEX IF NOT EXISTS idx_search_model_variant ON product_search_index(model_variant)",
    "CREATE INDEX IF NOT EXISTS idx_search_network_variant ON product_search_index(network_variant)",
    "CREATE INDEX IF NOT EXISTS idx_search_quality_tier ON product_search_index(quality_tier)",
    "CREATE INDEX IF NOT EXISTS idx_search_color ON product_search_index(color)",
    "CREATE INDEX IF NOT EXISTS idx_search_has_frame ON product_search_index(has_frame)",
    "CREATE INDEX IF NOT EXISTS idx_search_stock_status ON product_search_index(stock_status)",
    "CREATE INDEX IF NOT EXISTS idx_search_is_stock_real ON product_search_index(is_stock_real)",
    "CREATE INDEX IF NOT EXISTS idx_search_price ON product_search_index(price)",
    "CREATE INDEX IF NOT EXISTS idx_search_is_public ON product_search_index(is_public)",
    "CREATE INDEX IF NOT EXISTS idx_search_recent ON product_search_index(product_rowid DESC)",
    "CREATE INDEX IF NOT EXISTS idx_search_public_recent ON product_search_index(is_public, product_rowid DESC)",
    "CREATE INDEX IF NOT EXISTS idx_search_part_recent ON product_search_index(part_type, product_rowid DESC)",
    "CREATE INDEX IF NOT EXISTS idx_search_brand_recent ON product_search_index(device_brand, product_rowid DESC)",
    "CREATE INDEX IF NOT EXISTS idx_search_compatible_brand_recent ON product_search_index(compatible_brand, product_rowid DESC)",
    "CREATE INDEX IF NOT EXISTS idx_search_model_recent ON product_search_index(model_base, product_rowid DESC)",
    "CREATE INDEX IF NOT EXISTS idx_search_stock_recent ON product_search_index(stock_status, product_rowid DESC)",
    "CREATE INDEX IF NOT EXISTS idx_search_stock_real_recent ON product_search_index(is_stock_real, product_rowid DESC)",
    "CREATE INDEX IF NOT EXISTS idx_search_quality_recent ON product_search_index(quality_tier, product_rowid DESC)",
    "CREATE INDEX IF NOT EXISTS idx_search_title_nocase ON product_search_index(title COLLATE NOCASE)",
    "CREATE INDEX IF NOT EXISTS idx_search_normalized_title_nocase ON product_search_index(normalized_title COLLATE NOCASE)",
    "CREATE INDEX IF NOT EXISTS idx_search_public_model_variant ON product_search_index(is_public, model_base, model_variant, network_variant)",
    "CREATE INDEX IF NOT EXISTS idx_search_public_brand_part ON product_search_index(is_public, device_brand, compatible_brand, part_type)",
    "CREATE INDEX IF NOT EXISTS idx_search_public_stock_price ON product_search_index(is_public, stock_status, stock, price)",
  ];

  for (const sql of searchIndexSql) {
    await run(db, sql);
  }

  await detectFtsAvailability(db);
}

function optimizeSqlitePlannerOnce(db) {
  if (sqliteOptimizePromise) return sqliteOptimizePromise;
  sqliteOptimizePromise = (async () => {
    try {
      await run(db, "PRAGMA optimize");
    } catch (error) {
      console.warn("[products-db] pragma optimize skipped", error?.message || error);
    }
  })();
  return sqliteOptimizePromise;
}

function ensureSqlitePerformanceMaintenanceInBackground(trigger = "unknown") {
  if (sqliteMaintenancePromise) return sqliteMaintenancePromise;
  sqliteMaintenancePromise = (async () => {
    try {
      const db = await openDb();
      await createSchema(db);
      await optimizeSqlitePlannerOnce(db);
      console.log(`[products-db] performance maintenance completed trigger=${trigger}`);
    } catch (error) {
      console.warn(`[products-db] performance maintenance skipped trigger=${trigger}`, error?.message || error);
    } finally {
      sqliteMaintenancePromise = null;
    }
  })();
  return sqliteMaintenancePromise;
}

function computePublicationState(product = {}) {
  if (!product || typeof product !== "object") {
    return {
      visibility: "",
      status: "",
      enabled: false,
      is_public: false,
      isPublic: false,
      public_slug: "",
      public_blockers: ["invalid_product"],
      admin_visibility_bucket: "invalid",
      reason: "invalid_product",
      signals: { missingName: true, missingIdentifier: true },
    };
  }

  const visibility = normalizeQueryText(getField(product, ["visibility", "visibilidad"]) || "");
  const status = normalizeQueryText(getField(product, ["status", "estado"]) || "");
  const enabledValue = getField(product, ["enabled"]);
  const deletedValue = getField(product, ["deleted"]);
  const archivedValue = getField(product, ["archived"]);
  const vipOnlyValue = getField(product, ["vip_only", "vip only", "vipOnly"]);
  const wholesaleOnlyValue = getField(product, ["wholesaleOnly", "wholesale_only", "wholesale only"]);

  const hasName = Boolean(toNullableText(getField(product, ["name", "title", "productName", "Product Name", "Item Name", "nombre", "Name", "model", "description", "descripcion", "Descripcion", "shortDescription", "short_description", "Short Description"])));
  const hasIdentifier = Boolean(toNullableText(getField(product, ["id", "sku", "SKU", "code", "Code", "codigo", "partNumber", "Part Number", "mpn", "MPN", "ean", "EAN", "gtin", "GTIN", "supplierCode", "Supplier Code", "Supplier Part Number"])));
  const rawPublicFlag = getField(product, ["is_public", "isPublic", "public", "published", "visible"]);
  const explicitPublicFlag = rawPublicFlag === true || rawPublicFlag === 1 || isTruthyFlag(rawPublicFlag);
  const publicSlug = firstText([
    getField(product, ["public_slug", "publicSlug"]),
    getField(product, ["slug"]),
    hasName || hasIdentifier ? buildPublicSlug(product) : "",
  ]);

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
    missingPublicSlug: !publicSlug,
    explicitPublicVisibility: PUBLIC_VISIBILITY_VALUES.has(visibility),
    explicitPublicFlag,
  };

  const blockers = [];
  if (signals.enabledFalse) blockers.push("enabled_false");
  if (signals.deleted || DELETED_STATE_VALUES.has(visibility) || DELETED_STATE_VALUES.has(status)) blockers.push("deleted");
  if (signals.archived || ARCHIVED_STATE_VALUES.has(visibility) || ARCHIVED_STATE_VALUES.has(status)) blockers.push("archived");
  if (signals.vipOnly) blockers.push("vip_only");
  if (signals.wholesaleOnly) blockers.push("wholesale_only");
  if (PRIVATE_STATE_VALUES.has(visibility) || PRIVATE_STATE_VALUES.has(status)) blockers.push("private");
  if (HIDDEN_STATE_VALUES.has(visibility) || HIDDEN_STATE_VALUES.has(status)) blockers.push("hidden");
  if (DRAFT_STATE_VALUES.has(visibility) || DRAFT_STATE_VALUES.has(status)) blockers.push("draft");
  if (DISABLED_STATE_VALUES.has(visibility) || DISABLED_STATE_VALUES.has(status)) blockers.push("disabled");
  if (!hasName) blockers.push("missing_name");
  if (!hasIdentifier) blockers.push("missing_identifier");
  if (!publicSlug) blockers.push("missing_public_slug");
  if (!PUBLIC_VISIBILITY_VALUES.has(visibility) && !explicitPublicFlag) blockers.push("not_public_visibility");

  let bucket = "not_public";
  if (blockers.includes("deleted")) bucket = "deleted";
  else if (blockers.includes("archived")) bucket = "archived";
  else if (blockers.includes("disabled")) bucket = "disabled";
  else if (blockers.includes("draft")) bucket = "draft";
  else if (blockers.includes("hidden")) bucket = "hidden";
  else if (blockers.includes("private")) bucket = "private";

  const isPublic = blockers.length === 0;
  if (isPublic) bucket = "public";

  return {
    visibility,
    status,
    enabled: enabledValue !== false,
    is_public: isPublic,
    isPublic,
    public_slug: publicSlug || "",
    public_blockers: blockers,
    admin_visibility_bucket: bucket,
    reason: isPublic ? "public" : blockers[0] || "not_public",
    signals,
  };
}

function computeProductPublicState(product = {}) {
  const state = computePublicationState(product);
  return {
    isPublic: state.is_public,
    reason: state.reason,
    signals: state.signals,
    visibility: state.visibility,
    status: state.status,
    public_slug: state.public_slug,
    public_blockers: state.public_blockers,
    admin_visibility_bucket: state.admin_visibility_bucket,
  };
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
  if (DEBUG_PRICE_MAPPING && rowNumber != null && rowNumber <= 3) {
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
    availability: normalizeQueryText(toNullableText(getField(product, ["availability", "disponibilidad", "estado_stock", "stock_status"]))),
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

function serializeSearchFilters(classification = {}) {
  return JSON.stringify({
    part_type: classification.part_type || "",
    device_brand: classification.device_brand || "",
    model_base: classification.model_base || "",
    model_variant: classification.model_variant || "",
    network_variant: classification.network_variant || "",
    quality_tier: classification.quality_tier || "",
    color: classification.color || "",
    has_frame: classification.has_frame,
    stock_status: classification.stock_status || "",
    is_stock_real: Boolean(classification.is_stock_real),
    compatible_brand: classification.compatible_brand || "",
    official_brand: classification.official_brand || "",
    blockers: classification.blockers || [],
    reasons: classification.classification_reasons || [],
  });
}

function buildSearchIndexEntry(row = {}, rawProduct = {}) {
  const product = {
    ...rawProduct,
    id: rawProduct.id ?? row.id,
    sku: rawProduct.sku ?? row.sku,
    code: rawProduct.code ?? row.code,
    publicSlug: rawProduct.publicSlug ?? rawProduct.public_slug ?? row.public_slug,
    public_slug: rawProduct.public_slug ?? rawProduct.publicSlug ?? row.public_slug,
    slug: rawProduct.slug ?? row.slug,
    name: rawProduct.name ?? row.name,
    title: rawProduct.title ?? row.title,
    brand: rawProduct.brand ?? row.brand,
    model: rawProduct.model ?? row.model,
    category: rawProduct.category ?? row.category,
    stock: rawProduct.stock ?? row.stock,
    price: rawProduct.price ?? row.price,
    price_minorista: rawProduct.price_minorista ?? row.price_minorista,
    mpn: rawProduct.mpn ?? row.mpn,
    partNumber: rawProduct.partNumber ?? row.part_number,
    part_number: rawProduct.part_number ?? row.part_number,
  };
  const classification = classifyCatalogProduct(product);
  const title = firstText([row.name, row.title, product.name, product.title]) || "Producto";
  const price = toFiniteNumberOrNull(row.price) ?? toFiniteNumberOrNull(row.price_minorista);
  const image = firstText([row.image, product.image, product.thumbnail, Array.isArray(product.images) ? product.images[0] : ""]);
  const blobTerms = uniqueValues([
    row.search_text,
    title,
    row.brand,
    row.model,
    row.category,
    row.sku,
    row.code,
    row.mpn,
    row.part_number,
    classification.normalized_title,
    classification.part_type,
    PART_LABELS[classification.part_type],
    classification.device_brand,
    classification.compatible_brand,
    classification.official_brand,
    classification.model_family,
    classification.model_base,
    classification.model_generation,
    classification.model_variant,
    classification.network_variant,
    classification.quality_tier,
    ...(classification.quality_signals || []),
    classification.color,
    classification.frame_status,
    ...(classification.searchable_terms || []),
    ...(classification.synonyms || []),
  ].map(normalizeCatalogText).filter(Boolean));
  return {
    product_id: firstText([row.id, row.sku, row.code, classification.product_id]),
    product_rowid: Number(row.rowid || 0),
    public_slug: row.public_slug || row.slug || "",
    title,
    normalized_title: classification.normalized_title || normalizeCatalogText(title),
    sku: row.sku || row.code || "",
    mpn: row.mpn || row.part_number || "",
    part_number: row.part_number || "",
    brand: row.brand || "",
    device_brand: classification.device_brand || "",
    compatible_brand: classification.compatible_brand || "",
    official_brand: classification.official_brand || "",
    is_compatible_for_brand: classification.is_compatible_for_brand ? 1 : 0,
    part_type: classification.part_type || "",
    model_family: classification.model_family || "",
    model_base: classification.model_base || "",
    model_generation: classification.model_generation || "",
    model_variant: classification.model_variant || "",
    network_variant: classification.network_variant || "",
    quality_tier: classification.quality_tier || "",
    has_frame: classification.has_frame === true ? 1 : classification.has_frame === false ? 0 : null,
    color: classification.color || "",
    stock: Math.trunc(toNumber(row.stock, 0)),
    stock_status: classification.stock_status || "",
    is_stock_real: classification.is_stock_real ? 1 : 0,
    price,
    has_image: image ? 1 : 0,
    is_public: Number(row.is_public || 0) === 1 ? 1 : 0,
    classification_confidence: Number(classification.classification_confidence || 0),
    search_blob: blobTerms.join(" "),
    filters_blob: serializeSearchFilters(classification),
    updated_at: new Date().toISOString(),
    classification,
  };
}

function getSearchIndexInsertParams(item = {}) {
  return [
    item.product_id,
    item.product_rowid,
    item.public_slug,
    item.title,
    item.normalized_title,
    item.sku,
    item.mpn,
    item.part_number,
    item.brand,
    item.device_brand,
    item.compatible_brand,
    item.official_brand,
    item.is_compatible_for_brand,
    item.part_type,
    item.model_family,
    item.model_base,
    item.model_generation,
    item.model_variant,
    item.network_variant,
    item.quality_tier,
    item.has_frame,
    item.color,
    item.stock,
    item.stock_status,
    item.is_stock_real,
    item.price,
    item.has_image,
    item.is_public,
    item.classification_confidence,
    item.search_blob,
    item.filters_blob,
    item.updated_at,
  ];
}

async function rebuildProductSearchIndex(db) {
  await run(db, "DELETE FROM product_search_index");
  const pageSize = 1000;
  let offset = 0;
  let indexed = 0;
  while (true) {
    const rows = await all(
      db,
      `SELECT rowid, id, sku, code, slug, public_slug, image, name, title, brand, model, category, stock, price, price_minorista, part_number, mpn, search_text, is_public, raw_json
       FROM products ORDER BY rowid LIMIT ? OFFSET ?`,
      [pageSize, offset],
    );
    if (!rows.length) break;
    await withTransaction(db, async () => {
      for (const row of rows) {
        let raw = {};
        try {
          raw = row.raw_json ? JSON.parse(row.raw_json) : {};
        } catch {
          raw = {};
        }
        const item = buildSearchIndexEntry(row, raw);
        await run(db, SEARCH_INDEX_INSERT_SQL, getSearchIndexInsertParams(item));
      }
    });
    indexed += rows.length;
    offset += rows.length;
  }
  return indexed;
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

async function findProductRowByIdentifier(db, identifier, select = "rowid, *") {
  const target = String(identifier || "").trim();
  if (!target) return null;
  return get(
    db,
    `SELECT ${select}
     FROM products
     WHERE rowid = ? OR id = ? OR public_slug = ? OR slug = ? OR sku = ? OR code = ? OR mpn = ? OR part_number = ?
     LIMIT 1`,
    [target, target, target, target, target, target, target, target],
  );
}

async function reindexProduct(identifier, options = {}) {
  await ensureDbReadyForRequest();
  const db = options.db || await openDb();
  const row = await findProductRowByIdentifier(
    db,
    identifier,
    "rowid, id, sku, code, slug, public_slug, image, name, title, brand, model, category, stock, price, price_minorista, part_number, mpn, search_text, is_public, raw_json",
  );
  if (!row) {
    return { ok: false, found: false, identifier: String(identifier || "") };
  }
  let raw = {};
  try {
    raw = row.raw_json ? JSON.parse(row.raw_json) : {};
  } catch {
    raw = {};
  }
  const item = buildSearchIndexEntry(row, raw);
  await run(db, "DELETE FROM product_search_index WHERE product_rowid = ?", [row.rowid]);
  await run(db, SEARCH_INDEX_INSERT_SQL, getSearchIndexInsertParams(item));
  countCache.clear();
  return {
    ok: true,
    found: true,
    identifier: String(identifier || ""),
    product_rowid: row.rowid,
    product_id: item.product_id,
    public_slug: item.public_slug,
    is_public: Boolean(item.is_public),
    indexUpdated: true,
    classification: item.classification,
  };
}

async function updateProductByIdentifier(identifier, patch = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const target = String(identifier || "").trim();
  if (!target) throw new Error("identifier requerido");
  const row = await findProductRowByIdentifier(db, target, "rowid, raw_json");
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
  let mergedPatch = shouldForceEnabledTrue ? { ...patch, enabled: true } : { ...patch };
  if (patchVisibility === "public" || patchVisibility === "visible" || patch?.is_public === true || patch?.published === true || patch?.visible === true) {
    mergedPatch = { ...mergedPatch, visibility: "public", status: "active", enabled: true, is_public: true };
  } else if (patchVisibility === "private") {
    mergedPatch = { ...mergedPatch, visibility: "private", status: "private", is_public: false };
  } else if (patchVisibility === "hidden") {
    mergedPatch = { ...mergedPatch, visibility: "hidden", status: "hidden", is_public: false };
  } else if (patchVisibility === "draft") {
    mergedPatch = { ...mergedPatch, visibility: "draft", status: "draft", is_public: false };
  } else if (patchVisibility === "disabled" || patchStatus === "disabled") {
    mergedPatch = { ...mergedPatch, visibility: patchVisibility || "disabled", status: "disabled", enabled: false, is_public: false };
  }
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
      part_number = ?, mpn = ?, ean = ?, gtin = ?, supplier_code = ?, status = ?, visibility = ?, availability = ?,
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
      mapped.availability,
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
  const indexResult = await reindexProduct(row.rowid, { db });
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
    indexUpdated: Boolean(indexResult?.indexUpdated),
  });
  return normalizeProductForAdminList(merged, { rowid: row.rowid, public_slug: mapped.public_slug });
}

async function setProductVisibility(identifier, nextVisibility, options = {}) {
  await ensureDbReadyForRequest();
  const db = await openDb();
  const target = String(identifier || "").trim();
  const visibility = normalizeQueryText(nextVisibility || "");
  if (!target) throw new Error("identifier requerido");
  if (!visibility) throw new Error("nextVisibility requerido");
  const beforeRow = await findProductRowByIdentifier(db, target, "rowid, raw_json");
  if (!beforeRow) return null;
  let beforeRaw = {};
  try {
    beforeRaw = JSON.parse(beforeRow.raw_json || "{}");
  } catch {
    beforeRaw = {};
  }
  const before = computePublicationState(beforeRaw);
  const patch = { visibility };
  if (visibility === "public" || visibility === "visible" || visibility === "published") {
    Object.assign(patch, { visibility: "public", status: "active", enabled: true, is_public: true });
  } else if (visibility === "private") {
    Object.assign(patch, { visibility: "private", status: "private", is_public: false });
  } else if (visibility === "hidden") {
    Object.assign(patch, { visibility: "hidden", status: "hidden", is_public: false });
  } else if (visibility === "draft") {
    Object.assign(patch, { visibility: "draft", status: "draft", is_public: false });
  } else if (visibility === "disabled") {
    Object.assign(patch, { visibility: "disabled", status: "disabled", enabled: false, is_public: false });
  }

  const updated = await updateProductByIdentifier(target, patch);
  const debug = await debugPublicationByIdentifier(target);
  return {
    ok: Boolean(updated),
    identifier: target,
    reason: options.reason || "set_visibility",
    before: {
      visibility: before.visibility,
      status: before.status,
      enabled: before.enabled,
      is_public: before.is_public,
      admin_visibility_bucket: before.admin_visibility_bucket,
      public_blockers: before.public_blockers,
    },
    after: debug?.computePublicationState || debug?.computed || null,
    indexUpdated: Boolean(debug?.index?.found),
    publicApiVisible: Boolean(debug?.appearsInPublicApi),
    adminVisibleAs: debug?.computePublicationState?.admin_visibility_bucket || debug?.computed?.admin_visibility_bucket || null,
    debug,
  };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const workerCount = Math.min(Math.max(1, Number(limit) || 1), items.length || 1);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    }),
  );
  return results;
}

function getPublicationStateFromDebug(debug = {}) {
  return debug?.computePublicationState || debug?.computed || debug?.publicationState || {};
}

function getStateVisibility(state = {}) {
  return normalizeQueryText(state.visibility || state.status || state.admin_visibility_bucket || "");
}

function stateMatchesVisibility(state = {}, visibility = "") {
  const target = normalizeQueryText(visibility || "");
  if (target === "public") return state.is_public === true || state.isPublic === true;
  const stateVisibility = getStateVisibility(state);
  if (target === "private") return stateVisibility === "private" && state.is_public !== true;
  if (target === "hidden") return stateVisibility === "hidden" && state.is_public !== true;
  return false;
}

async function setProductsVisibilityBatch(identifiers = [], visibility, options = {}) {
  const startedAt = Date.now();
  const uniqueIdentifiers = Array.from(
    new Set(
      (Array.isArray(identifiers) ? identifiers : [])
        .map((identifier) => String(identifier || "").trim())
        .filter(Boolean),
    ),
  );
  const nextVisibility = normalizeQueryText(visibility || "");
  const allowedVisibility = new Set(["public", "private", "hidden"]);
  if (!allowedVisibility.has(nextVisibility)) {
    const error = new Error("visibility debe ser public, private o hidden");
    error.code = "INVALID_VISIBILITY";
    throw error;
  }
  const maxBatchSize = Number(options.maxBatchSize || 200);
  if (uniqueIdentifiers.length > maxBatchSize) {
    const error = new Error(`El lote supera el maximo de ${maxBatchSize} productos`);
    error.code = "BULK_VISIBILITY_TOO_LARGE";
    throw error;
  }
  console.info("[admin-bulk-visibility:start]", {
    requestedCount: uniqueIdentifiers.length,
    visibility: nextVisibility,
    reindex: options.reindex !== false,
  });
  const sampleUpdated = [];
  const sampleAlreadyInTargetState = [];
  const sampleFailed = [];
  let updatedCount = 0;
  let alreadyInTargetStateCount = 0;
  let failedCount = 0;
  await runWithConcurrency(uniqueIdentifiers, options.concurrency || 5, async (identifier) => {
    const itemStartedAt = Date.now();
    try {
      const beforeDebug = await debugPublicationByIdentifier(identifier);
      if (!beforeDebug?.found) {
        throw new Error("Producto no encontrado");
      }
      const beforeState = getPublicationStateFromDebug(beforeDebug);
      const beforeMatchesTarget = stateMatchesVisibility(beforeState, nextVisibility);
      const result = await setProductVisibility(identifier, nextVisibility, {
        reason: options.reason || "admin_bulk_visibility",
      });
      if (!result?.ok) {
        throw new Error("Producto no encontrado");
      }
      let reindexResult = null;
      if (options.reindex !== false) {
        reindexResult = await reindexProduct(identifier);
      }
      const afterDebug = await debugPublicationByIdentifier(identifier);
      const afterState = getPublicationStateFromDebug(afterDebug);
      const afterMatchesTarget = stateMatchesVisibility(afterState, nextVisibility);
      const changed = !beforeMatchesTarget && afterMatchesTarget;
      if (!afterMatchesTarget) {
        const error = new Error("postVerificationFailed");
        error.beforeState = beforeState;
        error.afterState = afterState;
        throw error;
      }
      const sample = {
        identifier,
        title: beforeDebug?.sqlite?.title || beforeDebug?.sqlite?.name || result?.debug?.sqlite?.title || result?.debug?.sqlite?.name || null,
        before: {
          visibility: beforeState.visibility || null,
          status: beforeState.status || null,
          is_public: beforeState.is_public === true,
        },
        after: {
          visibility: afterState.visibility || null,
          status: afterState.status || null,
          is_public: afterState.is_public === true,
        },
        reindexed: Boolean(reindexResult?.indexUpdated || result.indexUpdated),
      };
      let itemResult = "updated";
      if (beforeMatchesTarget) {
        alreadyInTargetStateCount += 1;
        itemResult = "already";
        if (sampleAlreadyInTargetState.length < 20) sampleAlreadyInTargetState.push(sample);
      } else {
        updatedCount += 1;
        if (sampleUpdated.length < 20) sampleUpdated.push(sample);
      }
      console.info("[admin-bulk-visibility:item]", {
        identifier,
        beforeIsPublic: beforeState.is_public === true,
        afterIsPublic: afterState.is_public === true,
        beforeVisibility: beforeState.visibility || null,
        afterVisibility: afterState.visibility || null,
        changed,
        result: itemResult,
        durationMs: Date.now() - itemStartedAt,
      });
      return result;
    } catch (error) {
      failedCount += 1;
      if (sampleFailed.length < 20) {
        sampleFailed.push({
          identifier,
          error: error?.message || "No se pudo actualizar el producto",
        });
      }
      console.info("[admin-bulk-visibility:item]", {
        identifier,
        beforeIsPublic: error?.beforeState?.is_public === true,
        afterIsPublic: error?.afterState?.is_public === true,
        beforeVisibility: error?.beforeState?.visibility || null,
        afterVisibility: error?.afterState?.visibility || null,
        changed: false,
        result: "failed",
        error: error?.message || "bulk_visibility_item_failed",
        durationMs: Date.now() - itemStartedAt,
      });
      return null;
    }
  });
  const durationMs = Date.now() - startedAt;
  console.info("[admin-bulk-visibility:end]", {
    requestedCount: uniqueIdentifiers.length,
    updatedCount,
    alreadyInTargetStateCount,
    failedCount,
    visibility: nextVisibility,
    durationMs,
  });
  return {
    ok: true,
    requestedCount: uniqueIdentifiers.length,
    updatedCount,
    alreadyInTargetStateCount,
    failedCount,
    visibility: nextVisibility,
    sampleUpdated,
    sampleAlreadyInTargetState,
    sampleFailed,
    durationMs,
  };
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
    databasePathEnv: (process.env.DATABASE_PATH || "").trim() || null,
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


function createRebuildTimeoutError(reason = "rebuild_timeout") {
  const error = new Error(`Catalog SQLite rebuild timed out after ${CATALOG_REBUILD_TIMEOUT_MS}ms`);
  error.code = "CATALOG_REBUILD_TIMEOUT";
  error.reason = reason;
  error.catalogState = catalogStateSnapshot();
  return error;
}

function markExistingSqliteReady(context = {}) {
  dbReady = true;
  catalogState.ready = true;
  catalogState.failed = false;
  catalogState.initializing = false;
  catalogState.lastReadyAt = catalogState.lastReadyAt || new Date().toISOString();
  if (context.reason) catalogState.freshnessReason = context.reason;
  clearCatalogError();
  console.warn("[products-db] using existing sqlite while rebuild is pending/failed", {
    reason: context.reason || null,
    productCount: context.productCount || null,
    publicProductCount: context.publicProductCount || null,
    dbPath: SQLITE_PATH,
  });
}

async function listSqliteTables(db) {
  const rows = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return rows.map((row) => String(row?.name || "")).filter(Boolean);
}

async function tableExists(db, tableName) {
  const row = await get(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND lower(name) = lower(?) LIMIT 1",
    [tableName],
  );
  return Boolean(row?.name);
}

async function migrateExistingSqliteSchema(db) {
  const productsExists = await tableExists(db, "products");
  if (!productsExists) return { ok: false, reason: "products_table_missing", migrated: false };
  const columns = await all(db, "PRAGMA table_info(products)");
  const columnByName = new Map(
    columns.map((col) => [String(col?.name || "").toLowerCase(), String(col?.type || "").trim()]),
  );
  const migrations = [];
  try {
    if (!columnByName.has("availability")) {
      await run(db, "ALTER TABLE products ADD COLUMN availability TEXT");
      migrations.push("add_products_availability");
    }
    await run(db, "CREATE INDEX IF NOT EXISTS idx_products_availability ON products(availability)");
    return { ok: true, migrated: migrations.length > 0, migrations };
  } catch (error) {
    console.warn("[products-db] legacy schema migration failed; keeping readable sqlite if possible", {
      message: error?.message || String(error),
      migrations,
    });
    return { ok: false, reason: "migration_failed", migrated: migrations.length > 0, migrations, error };
  }
}

async function inspectUsableSqlite() {
  if (!fs.existsSync(SQLITE_PATH)) {
    return { ok: false, reason: "sqlite_missing", tables: [], productTable: null, productCount: 0, publicProductCount: 0 };
  }
  try {
    const db = await openDb();
    const tables = await listSqliteTables(db);
    const productTable = tables.find((name) => String(name).toLowerCase() === "products") || null;
    if (!productTable) {
      return { ok: false, reason: "products_table_missing", tables, productTable, productCount: 0, publicProductCount: 0 };
    }
    const migration = await migrateExistingSqliteSchema(db);
    if (!migration.ok) {
      console.warn("[products-db] legacy sqlite migration unavailable; probing catalog read mode", {
        reason: migration.reason,
      });
    }
    await runIntegrityCheck(db);
    const productRow = await get(db, "SELECT COUNT(*) AS total FROM products");
    const publicRow = await get(db, "SELECT COUNT(*) AS total FROM products WHERE is_public = 1");
    const productCount = Number(productRow?.total || 0);
    const publicProductCount = Number(publicRow?.total || 0);
    return {
      ok: productCount > 0,
      reason: productCount > 0 ? "usable" : "sqlite_empty",
      tables,
      productTable,
      productCount,
      publicProductCount,
      migrated: Boolean(migration.migrated),
      migrations: migration.migrations || [],
    };
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "inspect_usable_sqlite", reason: "sqlite_corrupt" });
      return { ok: false, reason: "sqlite_corrupt", tables: [], productTable: null, productCount: 0, publicProductCount: 0, error };
    }
    return { ok: false, reason: "sqlite_unusable", tables: [], productTable: null, productCount: 0, publicProductCount: 0, error };
  }
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
    catalogState.initializing = !dbReady;
    catalogState.ready = Boolean(dbReady);
    catalogState.failed = false;
    catalogState.startedAt = new Date(startedAt).toISOString();
    catalogState.finishedAt = null;
    catalogState.lastRebuildStartedAt = new Date(startedAt).toISOString();
    let rebuildTimedOut = false;
    const timeout = setTimeout(() => {
      rebuildTimedOut = true;
      const timeoutError = createRebuildTimeoutError(activeReason);
      console.error("[products-db] rebuild timeout", {
        reason: activeReason,
        timeoutMs: CATALOG_REBUILD_TIMEOUT_MS,
        dbPath: SQLITE_PATH,
        dataDir: path.dirname(SQLITE_PATH),
      });
      setCatalogError(timeoutError, { phase: "rebuild", reason: activeReason, code: timeoutError.code });
      catalogState.rebuilding = false;
      catalogState.initializing = false;
      catalogState.lastRebuildFinishedAt = new Date().toISOString();
      catalogState.lastRebuildDurationMs = Date.now() - startedAt;
      catalogState.finishedAt = catalogState.lastRebuildFinishedAt;
    }, CATALOG_REBUILD_TIMEOUT_MS);
    const throwIfTimedOut = () => {
      if (rebuildTimedOut) throw createRebuildTimeoutError(activeReason);
    };
    const productsStats = await fsp.stat(PRODUCTS_JSON_PATH);
    const previousManifest = await readManifest();
    updateCatalogProgress(0, Number(previousManifest?.productCount || 0));
    const tmpDbPath = `${SQLITE_PATH}.tmp-${process.pid}-${Date.now()}`;
    console.log(`[products-db] rebuild started reason=${activeReason} productsFilePath=${PRODUCTS_JSON_PATH}`);

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
        part_number, mpn, ean, gtin, supplier_code, status, visibility, availability,
        stock, price, price_minorista, price_mayorista, precio_minorista, precio_mayorista, precio_final, precio_sin_impuestos, cost, currency, is_public, enabled, deleted, archived, vip_only, wholesale_only,
        search_text, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
              item.availability,
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
          throwIfTimedOut();
          const identifier = String(product?.id || product?.sku || product?.code || "").trim();
          const override = identifier ? overrides[identifier] : null;
          const mergedProduct = override ? { ...product, ...override } : product;
          const mapped = mapProductRow(mergedProduct, { rowNumber: count + 1, slugCounts });
          batch.push(mapped);
          count += 1;
          if (mapped.is_public === 1) publicCount += 1;
          if (count <= 100 || count % 1000 === 0) {
            updateCatalogProgress(count);
          }
          if (count % 5000 === 0) {
            console.log(`[products-db] rebuild progress count=${count}`);
          }
          if (TEST_REBUILD_DELAY_MS) {
            await sleep(TEST_REBUILD_DELAY_MS);
          }
          if (batch.length >= BATCH_SIZE) {
            await flush();
          }
          return true;
        },
      });

      throwIfTimedOut();
      await flush();
      throwIfTimedOut();

      if (ftsEnabled) {
        await run(tmpDb, "DELETE FROM products_fts");
        await run(
          tmpDb,
          `INSERT INTO products_fts(rowid, id, sku, code, slug, name, title, brand, model, category, search_text)
          SELECT rowid, id, sku, code, slug, name, title, brand, model, category, search_text FROM products`,
        );
      }
      const searchIndexCount = await rebuildProductSearchIndex(tmpDb);
      throwIfTimedOut();

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
        PRODUCTS_SQLITE_SCHEMA_VERSION,
        mappingVersion: CATALOG_MAPPING_VERSION,
        CATALOG_MAPPING_VERSION,
        productCount: count,
        publicProductCount: publicCount,
        publicCount,
        searchIndexCount,
        productsJsonSizeBytes: Number(productsStats.size || 0),
        productsJsonMtimeMs: Number(productsStats.mtimeMs || 0),
        productsJsonSha256: await computeFileSha256(PRODUCTS_JSON_PATH),
        indexBuiltAt: new Date().toISOString(),
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
      catalogState.finishedAt = catalogState.lastRebuildFinishedAt;
      updateCatalogProgress(count, count);
      clearTimeout(timeout);
      clearCatalogError();
      return manifest;
    } catch (error) {
      clearTimeout(timeout);
      console.error(`[products-db] rebuild failed reason=${activeReason}`, error);
      if (isSqliteCorruptionError(error)) {
        markSqliteCorruption(error, { phase: "rebuild", reason: activeReason });
      } else {
        setCatalogError(error, { phase: "rebuild", reason: activeReason });
      }
      catalogState.lastRebuildFinishedAt = new Date().toISOString();
      catalogState.lastRebuildDurationMs = Date.now() - startedAt;
      catalogState.finishedAt = catalogState.lastRebuildFinishedAt;
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
    const migration = await migrateExistingSqliteSchema(db);
    if (!migration.ok) return { ok: false, reason: migration.reason || "schema_migration_failed" };
    const columns = await all(db, "PRAGMA table_info(products)");
    const columnByName = new Map(
      columns.map((col) => [String(col?.name || "").toLowerCase(), String(col?.type || "").trim()]),
    );
    if (!columnByName.has("public_slug")) {
      return { ok: false, reason: "public_slug_missing" };
    }
    if (!columnByName.has("availability")) {
      return { ok: false, reason: "availability_column_missing" };
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
  let manifest = await readManifest();

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
    const currentHash = await computeFileSha256(PRODUCTS_JSON_PATH);
    if (manifest.productsJsonSha256 && manifest.productsJsonSha256 !== currentHash) {
      reason = "products_json_hash_changed";
    } else if (!manifest.productsJsonSha256) {
      reason = "products_json_mtime_changed";
    } else {
      manifest = {
        ...manifest,
        productsJsonMtimeMs: Number(productsStats.mtimeMs || 0),
        productsJsonSha256: currentHash,
      };
      await fsp.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
      console.log("[products-db] products mtime changed but hash is unchanged; manifest refreshed");
    }
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
    const usableExisting = reason === "sqlite_corrupt" ? { ok: false } : await inspectUsableSqlite();
    if (usableExisting.ok) {
      markExistingSqliteReady({ ...usableExisting, reason });
      ensureSqlitePerformanceMaintenanceInBackground(`legacy-ready-${reason}`);
      return {
        dbPath: SQLITE_PATH,
        manifest: await getManifestFromDb(),
        ftsEnabled,
        source: "sqlite_legacy_usable",
        ready: true,
        freshnessReason: reason,
        productsCount: usableExisting.productCount,
        productCount: usableExisting.productCount,
        publicProductCount: usableExisting.publicProductCount,
        tables: usableExisting.tables || [],
        productTable: usableExisting.productTable || null,
        migrated: Boolean(usableExisting.migrated),
        migrations: usableExisting.migrations || [],
      };
    }
    if (!allowRebuild) {
      throw createInitializingError(usableExisting.reason || reason);
    }
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
  await optimizeSqlitePlannerOnce(db);
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

async function ensureProductsDbOnce(options = {}) {
  if (dbReady) return { dbPath: SQLITE_PATH, source: "sqlite", ready: true };
  if (dbReadyPromise) return dbReadyPromise;
  const allowRebuild = options.allowRebuild ?? shouldAllowAutomaticRebuild();
  catalogState.initializing = true;
  dbReadyPromise = ensureProductsDb({ allowRebuild });
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

function ensureProductsDbInBackground(trigger = "request", options = {}) {
  if (dbReady || dbReadyPromise) return;
  const allowRebuild = options.allowRebuild ?? shouldAllowAutomaticRebuild();
  catalogState.initializing = true;
  catalogState.startedAt = catalogState.startedAt || new Date().toISOString();
  dbReadyPromise = ensureProductsDb({ allowRebuild });
  dbReadyPromise
    .then(() => {
      console.log(`[products-db] background ensure completed trigger=${trigger} allowRebuild=${allowRebuild}`);
    })
    .catch((error) => {
      console.warn(`[products-db] background ensure failed trigger=${trigger} allowRebuild=${allowRebuild} reason=${error?.message || error}`);
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
      if (shouldAllowAutomaticRebuild()) {
        ensureProductsDbInBackground("request-auto-bootstrap", { allowRebuild: true });
      }
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
  let filters = {};
  try {
    filters = JSON.parse(row.filters_blob || "{}") || {};
  } catch {
    filters = {};
  }
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
    is_public: Number(row.is_public || 0) === 1,
    image: row.image || "",
    thumbnail: row.image || "",
    publicSlug,
    public_slug: publicSlug,
    slug: firstText([row.slug, publicSlug]) || "",
    url: `/p/${encodeURIComponent(publicSlug || fallbackId)}`,
    source: "sqlite",
    part_type: row.part_type || "",
    device_brand: row.device_brand || "",
    compatible_brand: row.compatible_brand || "",
    official_brand: row.official_brand || "",
    is_compatible_for_brand: Boolean(row.is_compatible_for_brand),
    model_family: row.model_family || "",
    model_base: row.model_base || row.model || "",
    model_variant: row.model_variant || "",
    network_variant: row.network_variant || "",
    quality_tier: row.quality_tier || "",
    has_frame: row.has_frame === 1 ? true : row.has_frame === 0 ? false : null,
    color: row.color || "",
    stock_status: row.stock_status || "",
    is_stock_real: Boolean(row.is_stock_real),
    classification_confidence: toFiniteNumberOrNull(row.classification_confidence),
    classification_blockers: Array.isArray(filters.blockers) ? filters.blockers : [],
    classification_reasons: Array.isArray(filters.reasons) ? filters.reasons : [],
  };
}

function buildAdminProductListSummary(row = {}) {
  const publicSlug = firstText([row.public_slug, row.slug]) || "";
  const fallbackId = String(row.id || row.sku || row.code || row.product_id || "producto");
  const price = toFiniteNumberOrNull(row.price_minorista) ?? toFiniteNumberOrNull(row.price);
  return {
    id: firstText([row.id, row.product_id]) || "",
    sku: firstText([row.sku]) || "",
    code: firstText([row.code]) || "",
    name: firstText([row.name, row.title]) || "Producto",
    title: firstText([row.title, row.name]) || "Producto",
    brand: row.brand || row.device_brand || "",
    model: row.model || row.model_base || "",
    category: row.category || "",
    part_type: row.part_type || "",
    visibility: row.visibility || (Number(row.is_public || 0) === 1 ? "public" : ""),
    status: row.status || "",
    stock: Math.trunc(toNumber(row.stock, 0)),
    price,
    price_minorista: toFiniteNumberOrNull(row.price_minorista) ?? price,
    price_mayorista: toFiniteNumberOrNull(row.price_mayorista),
    image: row.image || "",
    thumbnail: row.image || "",
    publicSlug,
    public_slug: publicSlug,
    slug: firstText([row.slug, publicSlug]) || "",
    url: `/p/${encodeURIComponent(publicSlug || fallbackId)}`,
    source: "sqlite_admin_projection",
    device_brand: row.device_brand || "",
    model_base: row.model_base || row.model || "",
    quality_tier: row.quality_tier || "",
    stock_status: row.stock_status || "",
    is_stock_real: Boolean(row.is_stock_real),
    is_public: Number(row.is_public || 0) === 1,
    classification_confidence: toFiniteNumberOrNull(row.classification_confidence),
    classification_blockers: [],
    classification_reasons: [],
    updatedAt: row.updated_at || "",
    updated_at: row.updated_at || "",
  };
}

async function explainQueryPlan(db, sql, params = []) {
  try {
    const rows = await all(db, `EXPLAIN QUERY PLAN ${sql}`, params);
    return rows.map((row) => ({
      id: row.id,
      parent: row.parent,
      detail: row.detail || Object.values(row).join(" "),
    }));
  } catch (error) {
    return [{ error: error?.message || String(error) }];
  }
}



function shouldUseStreamingFallback(error) {
  const code = String(error?.code || "");
  return code === "CATALOG_INITIALIZING" || code === "CATALOG_SQLITE_FAILED" || code === "CATALOG_REBUILD_TIMEOUT";
}

function productMatchesFallbackFilters(product = {}, params = {}, { publicOnly = true } = {}) {
  if (publicOnly && !computePublicationState(product).is_public) return false;
  const normalizedSearch = normalizeQueryText(params.search || params.q || "");
  if (normalizedSearch) {
    const haystack = normalizeQueryText([
      product.id,
      product.sku,
      product.code,
      product.name,
      product.title,
      product.brand,
      product.model,
      product.category,
      product.part_number,
      product.mpn,
      product.description,
    ].filter(Boolean).join(" "));
    if (!haystack.includes(normalizedSearch)) return false;
  }
  const exactFilters = ["category", "brand", "model", "visibility", "status"];
  for (const key of exactFilters) {
    const expected = normalizeQueryText(params[key] || "");
    if (!expected) continue;
    if (normalizeQueryText(product[key] || "") !== expected) return false;
  }
  const stock = normalizeQueryText(params.stock || params.stockStatus || "");
  const stockValue = toNumber(product.stock ?? product.quantity ?? product.availableStock, 0);
  if ((stock === "in-stock" || stock === "in") && stockValue <= 0) return false;
  if ((stock === "out" || stock === "out-of-stock") && stockValue > 0) return false;
  if (params.priceMax !== null && params.priceMax !== undefined && params.priceMax !== "") {
    const price = toFiniteNumberOrNull(product.price_minorista ?? product.price ?? product.precio_minorista ?? product.precio_final);
    if (price !== null && Number.isFinite(Number(params.priceMax)) && price > Number(params.priceMax)) return false;
  }
  return true;
}

async function queryProductsStreamingFallback(params = {}, { adminMode = false } = {}) {
  const safePage = Math.max(1, Number(params.page) || 1);
  const safePageSize = Math.max(1, Math.min(100, Number(params.pageSize) || 24));
  const slugCounts = new Map();
  let fallbackRow = 0;
  const result = await productsStreamRepo.getProductsEmergencyPage({
    page: safePage,
    pageSize: safePageSize,
    filePath: PRODUCTS_JSON_PATH,
    matchItem: (product) => productMatchesFallbackFilters(product, params, { publicOnly: !adminMode }),
    mapItem: (product) => {
      fallbackRow += 1;
      const mapped = mapProductRow(product, { rowNumber: fallbackRow, slugCounts });
      return buildProductSummary({
        ...mapped,
        rowid: fallbackRow,
        part_type: "",
        device_brand: mapped.brand || "",
        compatible_brand: "",
        official_brand: mapped.brand || "",
        is_compatible_for_brand: 0,
        model_family: "",
        model_base: mapped.model || "",
        model_variant: "",
        network_variant: "",
        quality_tier: "",
        has_frame: null,
        color: "",
        stock_status: Number(mapped.stock || 0) > 0 ? "in_stock" : "out_of_stock",
        is_stock_real: 0,
        classification_confidence: null,
        filters_blob: "{}",
      });
    },
  });
  const totalItems = Number(result.matchedCount || result.items.length || 0);
  return {
    rows: [],
    items: result.items,
    page: result.page,
    pageSize: result.pageSize,
    totalItems,
    totalPages: result.hasNextPage ? result.page + 1 : Math.max(1, Math.ceil(totalItems / result.pageSize)),
    hasNextPage: Boolean(result.hasNextPage),
    hasPrevPage: Boolean(result.hasPrevPage),
    source: adminMode ? "streaming_fallback_admin" : "streaming_fallback",
    search: params.search || undefined,
    facets: {},
    searchDebug: undefined,
    countMs: 0,
    selectMs: 0,
    parseItemsMs: 0,
    totalDurationMs: 0,
    fallback: true,
    catalogState: catalogStateSnapshot(),
  };
}
function normalizeFacetValue(value = "") {
  return normalizeCatalogText(value);
}

function adminVisibilityBucketSql() {
  return `CASE
    WHEN si.is_public = 1 THEN 'public'
    WHEN lower(COALESCE(p.visibility, '')) = 'private' OR lower(COALESCE(p.status, '')) = 'private' THEN 'private'
    WHEN lower(COALESCE(p.visibility, '')) = 'hidden' OR lower(COALESCE(p.status, '')) = 'hidden' THEN 'hidden'
    WHEN lower(COALESCE(p.visibility, '')) = 'draft' OR lower(COALESCE(p.status, '')) = 'draft' THEN 'draft'
    WHEN lower(COALESCE(p.visibility, '')) = 'archived' OR lower(COALESCE(p.status, '')) = 'archived' OR COALESCE(p.archived, 0) = 1 THEN 'archived'
    WHEN lower(COALESCE(p.visibility, '')) = 'deleted' OR lower(COALESCE(p.status, '')) = 'deleted' OR COALESCE(p.deleted, 0) = 1 THEN 'deleted'
    WHEN lower(COALESCE(p.visibility, '')) = 'disabled' OR lower(COALESCE(p.status, '')) = 'disabled' OR COALESCE(p.enabled, 1) = 0 THEN 'disabled'
    ELSE 'not_public'
  END`;
}

function adminVisibilityBucketWhere(bucket) {
  const normalized = normalizeFacetValue(bucket || "");
  if (normalized === "public") return { sql: "si.is_public = 1", params: [] };
  if (normalized === "not_public") return { sql: "si.is_public != 1", params: [] };
  const bucketSql = "si.is_public != 1";
  const pVisibility = "p.visibility COLLATE NOCASE";
  const pStatus = "p.status COLLATE NOCASE";
  if (normalized === "private") return { sql: `${bucketSql} AND (${pVisibility} = 'private' OR ${pStatus} = 'private')`, params: [] };
  if (normalized === "hidden") return { sql: `${bucketSql} AND (${pVisibility} = 'hidden' OR ${pStatus} = 'hidden')`, params: [] };
  if (normalized === "draft") return { sql: `${bucketSql} AND (${pVisibility} = 'draft' OR ${pStatus} = 'draft')`, params: [] };
  if (normalized === "archived") return { sql: `${bucketSql} AND (${pVisibility} = 'archived' OR ${pStatus} = 'archived' OR COALESCE(p.archived, 0) = 1)`, params: [] };
  if (normalized === "deleted") return { sql: `${bucketSql} AND (${pVisibility} = 'deleted' OR ${pStatus} = 'deleted' OR COALESCE(p.deleted, 0) = 1)`, params: [] };
  if (normalized === "disabled") return { sql: `${bucketSql} AND (${pVisibility} = 'disabled' OR ${pStatus} = 'disabled' OR COALESCE(p.enabled, 1) = 0)`, params: [] };
  return null;
}

function buildSearchIndexWhere({
  search = "",
  isPublicOnly = false,
  category = "",
  brand = "",
  model = "",
  stock = "",
  priceMax = null,
  partType = "",
  deviceBrand = "",
  modelBase = "",
  qualityTier = "",
  color = "",
  hasFrame = "",
  stockStatus = "",
  visibility = "",
  status = "",
  missingImage = "",
  missingPrice = "",
  lowConfidence = "",
  missingModel = "",
  missingBrand = "",
  missingPartType = "",
} = {}) {
  const intent = parseCatalogQuery(search || "");
  const where = [];
  const params = [];
  if (isPublicOnly) where.push("si.is_public = 1");
  const requestedVisibility = normalizeFacetValue(visibility || "");
  if (requestedVisibility) {
    const visibilityWhere = adminVisibilityBucketWhere(requestedVisibility);
    if (visibilityWhere) {
      where.push(visibilityWhere.sql);
      params.push(...visibilityWhere.params);
    } else if (requestedVisibility !== "all") {
      where.push("p.visibility COLLATE NOCASE = ?");
      params.push(requestedVisibility);
    }
  }
  const requestedStatus = normalizeFacetValue(status || "");
  if (requestedStatus) {
    where.push("p.status COLLATE NOCASE = ?");
    params.push(requestedStatus);
  }
  if (String(missingImage) === "1" || String(missingImage) === "true") where.push("si.has_image = 0");
  if (String(missingPrice) === "1" || String(missingPrice) === "true") where.push("(si.price IS NULL OR si.price <= 0)");
  if (String(lowConfidence) === "1" || String(lowConfidence) === "true") where.push("si.classification_confidence < 0.55");
  if (String(missingModel) === "1" || String(missingModel) === "true") where.push("(si.model_base IS NULL OR si.model_base = '')");
  if (String(missingBrand) === "1" || String(missingBrand) === "true") where.push("(si.device_brand IS NULL OR si.device_brand = '')");
  if (String(missingPartType) === "1" || String(missingPartType) === "true") where.push("(si.part_type IS NULL OR si.part_type = '')");
  const requestedPartType = normalizeFacetValue(partType || "");
  if (requestedPartType) {
    where.push("si.part_type = ?");
    params.push(requestedPartType);
  }
  const requestedCategory = normalizeFacetValue(category || "");
  if (requestedCategory && !requestedPartType) {
    if (PART_LABELS[requestedCategory]) {
      where.push("si.part_type = ?");
      params.push(requestedCategory);
    } else {
      where.push("p.category COLLATE NOCASE = ?");
      params.push(category);
    }
  }
  const requestedBrand = normalizeFacetValue(deviceBrand || brand || "");
  if (requestedBrand) {
    where.push("(si.device_brand = ? OR si.compatible_brand = ?)");
    params.push(requestedBrand, requestedBrand);
  }
  const requestedModel = normalizeFacetValue(modelBase || model || "");
  if (requestedModel) {
    where.push("si.model_base = ?");
    params.push(requestedModel);
  }
  const requestedQuality = normalizeFacetValue(qualityTier || "");
  if (requestedQuality) {
    where.push("si.quality_tier = ?");
    params.push(requestedQuality);
  }
  const requestedColor = normalizeFacetValue(color || "");
  if (requestedColor) {
    where.push("si.color = ?");
    params.push(requestedColor);
  }
  if (hasFrame !== "" && hasFrame !== null && hasFrame !== undefined) {
    const frameValue = String(hasFrame) === "true" || String(hasFrame) === "1" ? 1 : String(hasFrame) === "false" || String(hasFrame) === "0" ? 0 : null;
    if (frameValue !== null) {
      where.push("si.has_frame = ?");
      params.push(frameValue);
    }
  }
  const requestedStock = normalizeFacetValue(stockStatus || stock || "");
  if (requestedStock === "in_stock" || requestedStock === "stock-real" || requestedStock === "in-stock" || requestedStock === "physical") {
    where.push("si.is_stock_real = 1");
  } else if (requestedStock === "low") {
    where.push("si.stock > 0 AND si.stock <= 5");
  } else if (requestedStock === "preorder" || requestedStock === "backorder" || requestedStock === "remote") {
    where.push("si.stock_status = 'preorder'");
  } else if (requestedStock === "out_of_stock" || requestedStock === "out" || requestedStock === "sin-stock") {
    where.push("si.stock_status = 'out_of_stock'");
  }
  const numericPriceMax = Number(priceMax);
  if (Number.isFinite(numericPriceMax) && numericPriceMax > 0) {
    where.push("si.price <= ?");
    params.push(numericPriceMax);
  }
  const searchTerms = uniqueValues([
    intent.model_code,
    intent.part_type,
    intent.device_brand,
    intent.model_base,
    intent.network_variant,
    intent.quality_tier,
    intent.color,
    ...(intent.tokens || []).filter((token) => token.length >= 2 && !SEARCH_STOPWORDS.has(token)),
  ].map(normalizeFacetValue).filter(Boolean));
  if (intent.normalized_query) {
    const strictTerms = searchTerms.filter((term) => !["display", "pantalla", "modulo", "battery", "bateria"].includes(term)).slice(0, 8);
    for (const term of strictTerms) {
      where.push("si.search_blob LIKE ?");
      params.push(`%${term}%`);
    }
  }
  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
    intent,
  };
}

function addStructuredReason(entry, label, score) {
  if (!score) return;
  entry.score += score;
  entry.reasons.push({ label, score });
}

function scoreSearchIndexRow(row = {}, intent = {}) {
  const entry = { score: 0, reasons: [] };
  const blob = normalizeFacetValue(row.search_blob || "");
  const rowModel = normalizeFacetValue(row.model_base || "");
  const queryModel = normalizeFacetValue(intent.model_base || "");
  const rowVariant = normalizeFacetValue(row.model_variant || "base") || "base";
  const queryVariant = normalizeFacetValue(intent.model_variant || "");
  const rowNetwork = normalizeFacetValue(row.network_variant || "");
  const queryNetwork = normalizeFacetValue(intent.network_variant || "");
  const queryText = normalizeFacetValue(intent.normalized_query || intent.original_query || "");
  const adhesiveIntent = /\b(adhesivo|adhesive|gasket|seal|junta|cinta|tape)\b/.test(queryText) && /\b(pantalla|display|screen|lcd|oled|pixel|iphone|galaxy)\b/.test(queryText);
  const displayIntent = !adhesiveIntent && /\b(pantalla|display|screen|modulo|modulo|lcd|oled|amoled)\b/.test(queryText);
  const screenClass = isRealScreenProduct(row);
  const adhesiveClass = isScreenAdhesiveProduct(row);
  const identifiers = [row.sku, row.mpn, row.part_number, row.product_id, row.public_slug, row.id, row.code].map(normalizeFacetValue).filter(Boolean);
  if (queryText && identifiers.includes(queryText)) addStructuredReason(entry, "SKU/MPN/slug exacto", 2600);
  if (intent.model_code && blob.includes(normalizeFacetValue(intent.model_code))) addStructuredReason(entry, "SKU/MPN/model code exacto", 800);
  if (queryModel && rowModel === queryModel) addStructuredReason(entry, "modelo exacto estructurado", 3000);
  else if (intent.model_generation && row.model_generation === intent.model_generation && row.model_family === intent.model_family) addStructuredReason(entry, "generacion/familia modelo", 900);
  else if (queryModel && rowModel && rowModel !== queryModel) addStructuredReason(entry, "modelo parecido pero no exacto", -1000);
  if (queryVariant) {
    if (rowVariant === queryVariant) addStructuredReason(entry, "variante exacta", 2500);
    else addStructuredReason(entry, `variante incorrecta ${rowVariant} vs ${queryVariant}`, -2500);
  } else if (queryModel && rowModel !== queryModel && /iphone\s+\d+/.test(queryModel) && /iphone\s+\d+/.test(rowModel)) {
    addStructuredReason(entry, "variante iphone no solicitada", -1800);
  }
  if (queryNetwork) {
    if (rowNetwork === queryNetwork) addStructuredReason(entry, "red exacta", 1200);
    else if (rowNetwork) addStructuredReason(entry, `red incorrecta ${rowNetwork} vs ${queryNetwork}`, -1500);
  }
  if (intent.part_type) {
    if (row.part_type === intent.part_type) addStructuredReason(entry, `tipo exacto ${intent.part_type}`, 2200);
    else if (row.part_type) addStructuredReason(entry, `tipo incorrecto ${row.part_type}`, -2200);
  }
  if (adhesiveIntent) {
    if (adhesiveClass.isScreenAdhesive) addStructuredReason(entry, "intencion adhesivo de pantalla", 3200);
    if (screenClass.isScreen) addStructuredReason(entry, "pantalla real debajo de adhesivo", -1800);
  } else if (displayIntent) {
    if (screenClass.isScreen) addStructuredReason(entry, "intencion pantalla real", 3200);
    if (adhesiveClass.isScreenAdhesive) addStructuredReason(entry, "adhesivo debajo de pantalla", -2400);
    if (screenClass.excludedAsAccessory) addStructuredReason(entry, `accesorio excluido ${screenClass.excludeReason}`, -2600);
  }
  if (intent.device_brand) {
    if (normalizeFacetValue(row.device_brand) === normalizeFacetValue(intent.device_brand) || normalizeFacetValue(row.compatible_brand) === normalizeFacetValue(intent.device_brand)) {
      addStructuredReason(entry, `marca/dispositivo ${intent.device_brand}`, 1200);
    } else if (row.device_brand) {
      addStructuredReason(entry, `marca incorrecta ${row.device_brand}`, -800);
    }
  }
  if (intent.quality_tier) {
    if (row.quality_tier === intent.quality_tier) addStructuredReason(entry, "calidad pedida coincide", 700);
    else if (row.quality_tier) addStructuredReason(entry, "calidad distinta", -250);
  }
  if (intent.color) {
    if (row.color === intent.color) addStructuredReason(entry, "color pedido coincide", 500);
    else if (row.color) addStructuredReason(entry, "color distinto", -250);
  }
  if (intent.has_frame !== null && intent.has_frame !== undefined && intent.has_frame !== "") {
    const wantedFrame = intent.has_frame === true ? 1 : 0;
    if (Number(row.has_frame) === wantedFrame) addStructuredReason(entry, "frame pedido coincide", 500);
    else if (row.has_frame !== null && row.has_frame !== undefined) addStructuredReason(entry, "frame distinto", -300);
  }
  if (Number(row.is_stock_real) === 1) addStructuredReason(entry, "stock real", 1800);
  else if (row.stock_status === "preorder") addStructuredReason(entry, "a pedido debajo de stock real", -900);
  else addStructuredReason(entry, "sin stock", -1500);
  if (Number(row.has_image) === 1) addStructuredReason(entry, "imagen valida", 400);
  else addStructuredReason(entry, "sin imagen", -700);
  if (Number(row.price) > 0) addStructuredReason(entry, "precio valido", 400);
  else addStructuredReason(entry, "sin precio", -700);
  for (const token of intent.tokens || []) {
    if (token.length >= 3 && blob.includes(token)) addStructuredReason(entry, `token ${token}`, 20);
  }
  return entry;
}

function facetLabel(group, value) {
  if (group === "part_type") return PART_LABELS[value] || value;
  if (group === "has_frame") return Number(value) === 1 ? "Con marco" : "Sin marco";
  if (group === "stock_status") {
    if (value === "in_stock") return "Stock real";
    if (value === "preorder") return "A pedido";
    if (value === "out_of_stock") return "Sin stock";
  }
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\bIPhone\b/g, "iPhone")
    .replace(/\bIphone\b/g, "iPhone")
    .replace(/\bMacbook\b/g, "MacBook");
}

async function buildSearchFacets(db, whereClause, options = {}) {
  const groups = ["part_type", "device_brand", "model_base", "quality_tier", "color", "has_frame", "stock_status"];
  const facets = {};
  for (const group of groups) {
    const prefix = whereClause.sql ? `${whereClause.sql} AND` : "WHERE";
    const rows = await all(
      db,
      `SELECT si.${group} AS value, COUNT(*) AS count FROM product_search_index si JOIN products p ON p.rowid = si.product_rowid ${prefix} si.${group} IS NOT NULL AND si.${group} != '' GROUP BY si.${group} ORDER BY count DESC, value ASC LIMIT ${group === "model_base" ? 40 : 20}`,
      whereClause.params,
    );
    facets[group] = rows.map((row) => ({ value: String(row.value), label: facetLabel(group, row.value), count: Number(row.count || 0) }));
  }
  if (options.adminMode) {
    const adminGroups = [
      { key: "visibility", expr: adminVisibilityBucketSql() },
      { key: "status", expr: "COALESCE(NULLIF(p.status, ''), 'unknown')" },
    ];
    for (const group of adminGroups) {
      const rows = await all(
        db,
        `SELECT ${group.expr} AS value, COUNT(*) AS count FROM product_search_index si JOIN products p ON p.rowid = si.product_rowid ${whereClause.sql} GROUP BY value ORDER BY count DESC, value ASC LIMIT 20`,
        whereClause.params,
      );
      facets[group.key] = rows.map((row) => ({ value: String(row.value), label: facetLabel(group.key, row.value), count: Number(row.count || 0) }));
    }
    const issueRows = await all(
      db,
      `SELECT
        SUM(CASE WHEN si.has_image = 0 THEN 1 ELSE 0 END) AS missing_image,
        SUM(CASE WHEN si.price IS NULL OR si.price <= 0 THEN 1 ELSE 0 END) AS missing_price,
        SUM(CASE WHEN si.classification_confidence < 0.55 THEN 1 ELSE 0 END) AS low_confidence,
        SUM(CASE WHEN si.model_base IS NULL OR si.model_base = '' THEN 1 ELSE 0 END) AS missing_model,
        SUM(CASE WHEN si.device_brand IS NULL OR si.device_brand = '' THEN 1 ELSE 0 END) AS missing_brand,
        SUM(CASE WHEN si.part_type IS NULL OR si.part_type = '' THEN 1 ELSE 0 END) AS missing_part_type
       FROM product_search_index si JOIN products p ON p.rowid = si.product_rowid ${whereClause.sql}`,
      whereClause.params,
    );
    facets.issues = issueRows[0] || {};
  }
  const priceRow = await get(db, `SELECT MIN(si.price) AS min, MAX(si.price) AS max FROM product_search_index si JOIN products p ON p.rowid = si.product_rowid ${whereClause.sql}`, whereClause.params);
  facets.price_range = {
    min: Number(priceRow?.min || 0),
    max: Number(priceRow?.max || 0),
  };
  return facets;
}

async function querySearchIndex(params = {}) {
  const totalStartedAt = Date.now();
  await ensureDbReadyForRequest();
  const db = await openDb();
  const safePage = Math.max(1, Number(params.page) || 1);
  const safePageSize = Math.max(1, Math.min(100, Number(params.pageSize) || 24));
  const includeFacets = params.includeFacets === true || String(params.includeFacets || "") === "1";
  const includeQueryPlan = ENABLE_SQLITE_QUERY_PLAN || params.debugSearch === true || params.debugQueryPlan === true || String(params.debugQueryPlan || "") === "1";
  const offset = (safePage - 1) * safePageSize;
  const whereClause = buildSearchIndexWhere(params);
  const countStartedAt = Date.now();
  const totalRow = await get(db, `SELECT COUNT(*) AS totalItems FROM product_search_index si JOIN products p ON p.rowid = si.product_rowid ${whereClause.sql}`, whereClause.params);
  const totalItems = Number(totalRow?.totalItems || 0);
  const countMs = Date.now() - countStartedAt;
  const selectStartedAt = Date.now();
  const hasSearch = Boolean(normalizeFacetValue(params.search || ""));
  const candidateLimit = hasSearch ? Math.max(safePageSize, Math.min(SEARCH_RANK_CANDIDATE_LIMIT, totalItems || SEARCH_RANK_CANDIDATE_LIMIT)) : safePageSize;
  const candidateOffset = hasSearch ? 0 : offset;
  const orderBy =
    params.sort === "recent" ? "si.product_rowid DESC" :
    params.sort === "stock" || params.sort === "stock_desc" ? "si.stock DESC, si.title ASC" :
    params.sort === "price_asc" ? "si.price ASC, si.title ASC" :
    params.sort === "price_desc" ? "si.price DESC, si.title ASC" :
    params.sort === "name_desc" ? "si.title DESC" :
    params.sort === "name_asc" ? "si.title ASC" :
    params.sort === "stock_real" ? "si.is_stock_real DESC, si.title ASC" :
    "si.is_stock_real DESC, si.classification_confidence DESC, si.title ASC";
  const selectColumns = [
    "si.product_id",
    "si.product_rowid",
    "si.public_slug",
    "si.title",
    "si.normalized_title",
    "si.sku",
    "si.mpn",
    "si.part_number",
    "si.brand",
    "si.device_brand",
    "si.compatible_brand",
    "si.official_brand",
    "si.is_compatible_for_brand",
    "si.part_type",
    "si.model_family",
    "si.model_base",
    "si.model_generation",
    "si.model_variant",
    "si.network_variant",
    "si.quality_tier",
    "si.has_frame",
    "si.color",
    "si.stock",
    "si.stock_status",
    "si.is_stock_real",
    "si.price",
    "si.has_image",
    "si.is_public",
    "si.classification_confidence",
    "si.updated_at",
    "p.rowid",
    "p.id",
    "p.code",
    "p.slug",
    "p.image",
    "p.name",
    "p.category",
    "p.status",
    "p.visibility",
    "p.price_minorista",
    "p.price_mayorista",
    "p.precio_minorista",
    "p.precio_mayorista",
    "p.precio_final",
    "p.precio_sin_impuestos",
    "p.cost",
    "p.currency",
  ];
  if (hasSearch || params.debugSearch) selectColumns.push("si.search_blob");
  if (!params.adminMode) selectColumns.push("si.filters_blob");
  const selectSql = `SELECT ${selectColumns.join(", ")}
     FROM product_search_index si
     JOIN products p ON p.rowid = si.product_rowid
     ${whereClause.sql}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`;
  const selectParams = [...whereClause.params, candidateLimit, candidateOffset];
  const candidates = await all(
    db,
    selectSql,
    selectParams,
  );
  let ranked = hasSearch
    ? candidates.map((row, index) => ({ row, index, ...scoreSearchIndexRow(row, whereClause.intent) }))
    : candidates.map((row, index) => ({ row, index, score: 0, reasons: [] }));
  if (hasSearch && (!params.sort || String(params.sort) === "relevance")) {
    ranked.sort((a, b) => b.score - a.score || Number(b.row.is_stock_real || 0) - Number(a.row.is_stock_real || 0) || a.index - b.index);
  }
  const pageEntries = hasSearch ? ranked.slice(offset, offset + safePageSize) : ranked;
  const rows = pageEntries.map((entry) => entry.row);
  const selectMs = Date.now() - selectStartedAt;
  const mapStartedAt = Date.now();
  const items = rows.map((row) => params.adminMode ? buildAdminProductListSummary(row) : buildProductSummary(row));
  const mapMs = Date.now() - mapStartedAt;
  const facetStartedAt = Date.now();
  const facets = includeFacets
    ? await buildSearchFacets(db, whereClause, { adminMode: Boolean(params.adminMode) })
    : {};
  const facetMs = Date.now() - facetStartedAt;
  const queryPlan = includeQueryPlan
    ? {
        count: await explainQueryPlan(
          db,
          `SELECT COUNT(*) AS totalItems FROM product_search_index si JOIN products p ON p.rowid = si.product_rowid ${whereClause.sql}`,
          whereClause.params,
        ),
        select: await explainQueryPlan(db, selectSql, selectParams),
      }
    : undefined;
  const searchDebug = params.debugSearch ? {
    engine: params.adminMode ? "product_search_index_admin" : "product_search_index",
    queryOriginal: params.search || "",
    queryNormalized: whereClause.intent.normalized_query || "",
    intent: whereClause.intent,
    inferredFilters: {
      part_type: whereClause.intent.part_type || "",
      device_brand: whereClause.intent.device_brand || "",
      model_base: whereClause.intent.model_base || "",
      model_variant: whereClause.intent.model_variant || "",
      network_variant: whereClause.intent.network_variant || "",
      quality_tier: whereClause.intent.quality_tier || "",
      color: whereClause.intent.color || "",
      has_frame: whereClause.intent.has_frame,
    },
    tokensUsed: whereClause.intent.tokens || [],
    results: pageEntries.slice(0, 20).map((entry, position) => ({
      position: position + 1,
      score: entry.score,
      reasons: entry.reasons,
      penalties: entry.reasons.filter((reason) => reason.score < 0),
      title: entry.row.title,
      product_id: entry.row.product_id,
      sku: entry.row.sku,
      structured: {
        part_type: entry.row.part_type,
        device_brand: entry.row.device_brand,
        compatible_brand: entry.row.compatible_brand,
        official_brand: entry.row.official_brand,
        is_compatible_for_brand: Boolean(entry.row.is_compatible_for_brand),
        model_base: entry.row.model_base,
        model_variant: entry.row.model_variant,
        network_variant: entry.row.network_variant,
        quality_tier: entry.row.quality_tier,
        color: entry.row.color,
        has_frame: entry.row.has_frame,
        stock_status: entry.row.stock_status,
        is_stock_real: Boolean(entry.row.is_stock_real),
      },
    })),
    queryPlan,
  } : undefined;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  return {
    rows,
    items,
    page: safePage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
    source: params.adminMode ? "sqlite_search_index_admin" : "sqlite_search_index",
    search: params.search || undefined,
    facets,
    searchDebug,
    queryPlan: params.debugSearch ? undefined : queryPlan,
    countMs,
    selectMs,
    mapMs,
    facetMs,
    parseItemsMs: mapMs,
    totalDurationMs: Date.now() - totalStartedAt,
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
  const safePageSize = Math.max(1, Math.min(100, Number(pageSize) || 24));
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
    result = await querySearchIndex({ ...params, isPublicOnly: true });
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "query_products", reason: "sqlite_corrupt" });
      await repairCorruptSqlite({ reason: "query_products_corrupt" });
      result = await querySearchIndex({ ...params, isPublicOnly: true });
    } else if (shouldUseStreamingFallback(error)) {
      console.warn("[products-sqlite:fallback] public catalog using streaming fallback", {
        code: error?.code || null,
        reason: error?.reason || null,
        message: error?.message || String(error),
      });
      result = await queryProductsStreamingFallback(params, { adminMode: false });
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
    mapMs: result.mapMs ?? result.parseItemsMs,
    facetMs: result.facetMs,
    totalDurationMs: result.totalDurationMs,
  });
  return result;
}

async function getPublicSitemapStats() {
  const startedAt = Date.now();
  try {
    await ensureDbReadyForRequest();
    const db = await openDb();
    const countStartedAt = Date.now();
    const row = await get(
      db,
      `SELECT
        COUNT(*) AS totalPublicProducts,
        SUM(CASE WHEN public_slug IS NOT NULL AND trim(public_slug) != '' THEN 1 ELSE 0 END) AS indexableProducts,
        SUM(CASE WHEN public_slug IS NULL OR trim(public_slug) = '' THEN 1 ELSE 0 END) AS missingSlugProducts
       FROM product_search_index
       WHERE is_public = 1`,
    );
    const countMs = Date.now() - countStartedAt;
    return {
      totalPublicProducts: Number(row?.totalPublicProducts || 0),
      indexableProducts: Number(row?.indexableProducts || 0),
      missingSlugProducts: Number(row?.missingSlugProducts || 0),
      countMs,
      totalDurationMs: Date.now() - startedAt,
      source: "sqlite_search_index",
    };
  } catch (error) {
    if (!isSqliteCorruptionError(error)) throw error;
    markSqliteCorruption(error, { phase: "sitemap_stats", reason: "sqlite_corrupt" });
    await repairCorruptSqlite({ reason: "sitemap_stats_corrupt" });
    return getPublicSitemapStats();
  }
}

async function listPublicSitemapProducts({ page = 1, pageSize = 2500 } = {}) {
  const startedAt = Date.now();
  try {
    await ensureDbReadyForRequest();
    const db = await openDb();
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.max(1, Math.min(5000, Number(pageSize) || 2500));
    const offset = (safePage - 1) * safePageSize;
    const selectStartedAt = Date.now();
    const rows = await all(
      db,
      `SELECT product_rowid, product_id, public_slug, updated_at
       FROM product_search_index
       WHERE is_public = 1
         AND public_slug IS NOT NULL
         AND trim(public_slug) != ''
       ORDER BY product_rowid ASC
       LIMIT ? OFFSET ?`,
      [safePageSize, offset],
    );
    const selectMs = Date.now() - selectStartedAt;
    return {
      rows,
      page: safePage,
      pageSize: safePageSize,
      offset,
      limit: safePageSize,
      count: rows.length,
      selectMs,
      totalDurationMs: Date.now() - startedAt,
      source: "sqlite_search_index",
    };
  } catch (error) {
    if (!isSqliteCorruptionError(error)) throw error;
    markSqliteCorruption(error, { phase: "sitemap_products", reason: "sqlite_corrupt" });
    await repairCorruptSqlite({ reason: "sitemap_products_corrupt" });
    return listPublicSitemapProducts({ page, pageSize });
  }
}


async function queryAdminProducts(params = {}) {
  let result;
  try {
    result = await querySearchIndex({ ...params, isPublicOnly: false, adminMode: true });
  } catch (error) {
    if (isSqliteCorruptionError(error)) {
      markSqliteCorruption(error, { phase: "query_admin_products", reason: "sqlite_corrupt" });
      await repairCorruptSqlite({ reason: "query_admin_products_corrupt" });
      result = await querySearchIndex({ ...params, isPublicOnly: false, adminMode: true });
    } else if (shouldUseStreamingFallback(error)) {
      console.warn("[products-sqlite:fallback] admin catalog using streaming fallback", {
        code: error?.code || null,
        reason: error?.reason || null,
        message: error?.message || String(error),
      });
      result = await queryProductsStreamingFallback(params, { adminMode: true });
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
    mapMs: result.mapMs ?? result.parseItemsMs,
    facetMs: result.facetMs,
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
    try {
      await reindexProduct(resolved.row.rowid, { db });
      countCache.clear();
    } catch (reindexError) {
      console.warn("[products-inventory] reindex after stock adjustment failed", reindexError?.message || reindexError);
    }
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
  return readManifest();
}

async function getCatalogHealth() {
  const paths = buildCatalogPathsInfo();
  const productsJsonExists = fs.existsSync(PRODUCTS_JSON_PATH);
  const sqliteExists = fs.existsSync(SQLITE_PATH);
  const manifestExists = fs.existsSync(MANIFEST_PATH);
  let tables = [];
  let productTable = null;
  let totalRow = { total: 0 };
  let publicRow = { total: 0 };
  let privateExplicitRow = { total: 0 };
  let hiddenExplicitRow = { total: 0 };
  let missingVisibilityRow = { total: 0 };
  let missingStatusRow = { total: 0 };
  if (sqliteExists) {
    try {
      const db = await openDb();
      tables = await listSqliteTables(db);
      productTable = tables.find((name) => String(name).toLowerCase() === "products") || null;
      if (!productTable) {
        throw new Error("products_table_missing");
      }
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
    if (manifest.productsJsonSha256) {
      try {
        const currentHash = await computeFileSha256(PRODUCTS_JSON_PATH);
        if (manifest.productsJsonSha256 !== currentHash) {
          isFresh = false;
          freshnessReason = "products_json_hash_changed";
        }
      } catch {
        isFresh = false;
        freshnessReason = "products_json_hash_unavailable";
      }
    } else {
      isFresh = false;
      freshnessReason = "products_json_mtime_changed";
    }
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
    ready: Boolean((dbReady || productCount > 0) && sqliteExists && productTable && !catalogState.lastError),
    initializing: Boolean(catalogState.initializing),
    rebuilding: Boolean(catalogState.rebuilding),
    failed: Boolean(catalogState.failed || catalogState.lastError || (sqliteExists && !productTable)),
    progress: Number(catalogState.progress || 0),
    total: Number(catalogState.total || manifest?.productCount || 0),
    processed: Number(catalogState.processed || 0),
    lastError: catalogState.lastError,
    lastErrorCode: catalogState.lastError?.code || null,
    lastErrorAt: catalogState.lastErrorAt,
    corruptDetected: Boolean(catalogState.corruptDetected),
    lastReadyAt: catalogState.lastReadyAt,
    lastRebuildStartedAt: catalogState.lastRebuildStartedAt,
    lastRebuildFinishedAt: catalogState.lastRebuildFinishedAt,
    lastRebuildDurationMs: catalogState.lastRebuildDurationMs,
    startedAt: catalogState.startedAt,
    finishedAt: catalogState.finishedAt,
    mappingVersion: CATALOG_MAPPING_VERSION,
    schemaVersion: PRODUCTS_SQLITE_SCHEMA_VERSION,
    expectedSchemaVersion: PRODUCTS_SQLITE_SCHEMA_VERSION,
    productsJsonExists,
    manifestExists,
    dbPath: SQLITE_PATH,
    dbExists: sqliteExists,
    sqlitePath: SQLITE_PATH,
    sqliteExists,
    productCount,
    productsCount: productCount,
    publicProductCount,
    tables,
    productTable,
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
    await rebuildProductSearchIndex(db);
    countCache.clear();
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
    const patch = { visibility: "public", status: "active", enabled: true, is_public: true };
    const merged = { ...raw, ...patch };
    const mapped = mapProductRow(merged, { rowNumber: row.rowid });
    if (!dryRun) {
      await setProductVisibility(row.id || row.sku || row.code || row.public_slug || row.slug || row.rowid, "public", { reason: "admin_bulk_publish_legacy" });
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
  const failedItems = [];
  const sampleUpdated = [];
  const sampleStillPrivate = [];
  const sampleNotVisibleInPublicApi = [];

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
      if (dryRun) {
        updatedCount += 1;
        return;
      }
      try {
        const publication = await setProductVisibility(identifier, "public", { reason: "bulk_publish" });
        const isPublic = publication?.after?.is_public === true || publication?.debug?.computePublicationState?.is_public === true;
        const publicVisible = publication?.publicApiVisible === true || publication?.debug?.appearsInPublicApi === true;
        if (isPublic && publicVisible) {
          updatedCount += 1;
          if (sampleUpdated.length < 10) sampleUpdated.push({
            identifier,
            title: product.name || product.title || null,
            publicSlug: publication?.debug?.sqlite?.public_slug || null,
            indexUpdated: Boolean(publication?.indexUpdated),
          });
        } else {
          if (!isPublic && sampleStillPrivate.length < 10) sampleStillPrivate.push({ identifier, reason: publication?.after?.reason || publication?.debug?.computePublicationState?.reason || "not_public" });
          if (!publicVisible && sampleNotVisibleInPublicApi.length < 10) sampleNotVisibleInPublicApi.push({ identifier, indexUpdated: Boolean(publication?.indexUpdated) });
          failedItems.push({ identifier, reason: "post_publish_verification_failed", publication });
        }
      } catch (error) {
        failedItems.push({ identifier, reason: error?.message || "publish_failed" });
      }
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
    failedItems,
    sampleUpdated,
    sampleStillPrivate,
    sampleNotVisibleInPublicApi,
    verificationOk: failedItems.length === 0,
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
  const publicationState = computePublicationState(raw);
  const normalizedSearch = normalizeQueryText(term);
  const indexRow = await get(db, `SELECT product_id, product_rowid, public_slug, title, sku, mpn, part_number, device_brand, part_type, model_base, stock_status, price, is_public, updated_at
    FROM product_search_index
    WHERE product_rowid = ? OR LOWER(COALESCE(product_id,'')) = LOWER(?) OR LOWER(COALESCE(sku,'')) = LOWER(?) OR LOWER(COALESCE(public_slug,'')) = LOWER(?) OR LOWER(COALESCE(mpn,'')) = LOWER(?)
    LIMIT 1`, [row.rowid, term, term, term, term]);
  const publicApiRow = await get(db, `SELECT si.product_rowid
    FROM product_search_index si JOIN products p ON p.rowid = si.product_rowid
    WHERE si.product_rowid = ? AND si.is_public = 1
    LIMIT 1`, [row.rowid]);
  const adminPublicRow = await get(db, `SELECT si.product_rowid
    FROM product_search_index si JOIN products p ON p.rowid = si.product_rowid
    WHERE si.product_rowid = ? AND si.is_public = 1
    LIMIT 1`, [row.rowid]);
  const adminPrivateRow = await get(db, `SELECT si.product_rowid
    FROM product_search_index si JOIN products p ON p.rowid = si.product_rowid
    WHERE si.product_rowid = ? AND si.is_public != 1 AND (${adminVisibilityBucketSql()}) = 'private'
    LIMIT 1`, [row.rowid]);
  return {
    identifier: term, found: true, foundBy: "sqlite",
    raw: {
      id: raw.id || null, sku: raw.sku || raw.SKU || null, code: raw.code || raw.Code || null, name: raw.name || raw.Name || null, title: raw.title || raw.Title || null, model: raw.model || null,
      description: raw.description || raw.descripcion || null, shortDescription: raw.shortDescription || raw.short_description || null,
      visibility: raw.visibility || raw.visibilidad || null, status: raw.status || raw.estado || null, enabled: raw.enabled, is_public: raw.is_public ?? raw.isPublic,
      deleted: raw.deleted, archived: raw.archived, vip_only: raw.vip_only ?? raw.vipOnly, wholesaleOnly: raw.wholesaleOnly ?? raw.wholesale_only,
    },
    sqlite: {
      rowid: row.rowid, id: row.id, sku: row.sku, code: row.code, name: row.name, title: row.title, model: row.model, public_slug: row.public_slug, visibility: row.visibility, status: row.status, enabled: row.enabled, deleted: row.deleted, archived: row.archived, vip_only: row.vip_only, wholesale_only: row.wholesale_only, is_public: row.is_public, search_text: row.search_text,
    },
    computed,
    computePublicationState: publicationState,
    index: indexRow ? { found: true, ...indexRow } : { found: false },
    appearsInPublicApi: Boolean(publicApiRow),
    appearsInAdminPublicFilter: Boolean(adminPublicRow),
    appearsInAdminPrivateFilter: Boolean(adminPrivateRow),
    blockers: publicationState.public_blockers,
    wouldAppearInPublicQuery: Number(row.is_public || 0) === 1,
    indexPublicMatchesSqlite: indexRow ? Number(indexRow.is_public || 0) === Number(row.is_public || 0) : false,
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

function closeProductsDbOnShutdown(signal) {
  closeDbInstance()
    .then(() => {
      if (signal) console.log(`[products-db] sqlite connection closed on ${signal}`);
    })
    .catch((error) => {
      console.warn("[products-db] sqlite close failed", error?.message || error);
    });
}

if (require.main !== module && !global.__NERIN_PRODUCTS_SQLITE_SHUTDOWN_HOOKS__) {
  global.__NERIN_PRODUCTS_SQLITE_SHUTDOWN_HOOKS__ = true;
  process.once("SIGINT", () => closeProductsDbOnShutdown("SIGINT"));
  process.once("SIGTERM", () => closeProductsDbOnShutdown("SIGTERM"));
}

function isRebuildInProgress() {
  return Boolean(rebuildPromise);
}

module.exports = {
  ensureProductsDb,
  ensureProductsDbOnce,
  rebuildProductsDbFromJson,
  isRebuildInProgress,
  ensureProductsDbInBackground,
  repairCorruptSqlite,
  closeProductsDbForTests: closeDbInstance,
  isSqliteCorruptionError,
  catalogStateSnapshot,
  setCatalogError,
  clearCatalogError,
  queryProducts,
  getPublicSitemapStats,
  listPublicSitemapProducts,
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
  computePublicationState,
  computeProductPublicState,
  setProductVisibility,
  setProductsVisibilityBatch,
  reindexProduct,
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
  shouldAllowAutomaticRebuild,
  getField,
  isProductPublic,
  mapProductRow,
  SQLITE_PATH,
  createInitializingError,
  SQLITE_CORRUPT_CODE,
};
