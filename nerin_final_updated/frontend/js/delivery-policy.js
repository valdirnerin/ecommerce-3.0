const DELIVERY_POLICY_VERSION = "delivery-policy-20260503-v2";
const REMOTE_MIN_DAYS = 20;
const REMOTE_MAX_DAYS = 30;

console.info("[delivery-policy] loaded", DELIVERY_POLICY_VERSION);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  const text = cleanText(value).toLowerCase();
  try {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    return text;
  }
}

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getImages(product = {}) {
  const values = [];
  const push = (value) => {
    if (typeof value === "string" && value.trim()) values.push(value.trim());
    else if (value && typeof value === "object") {
      push(value.url || value.secure_url || value.src || value.image || value.thumbnail);
    }
  };
  push(product.image);
  push(product.thumbnail);
  push(product.image_url);
  push(product.picture);
  push(product.photo);
  push(product.foto);
  if (Array.isArray(product.images)) product.images.forEach(push);
  if (Array.isArray(product.pictures)) product.pictures.forEach(push);
  if (Array.isArray(product.fotos)) product.fotos.forEach(push);
  return values;
}

function hasLocalUploadedAsset(product = {}) {
  return getImages(product).some((url) => /\/assets\/uploads\/products\//i.test(url));
}

function getMetadata(product = {}) {
  const metadata = product.metadata || product.meta || {};
  return metadata && typeof metadata === "object" ? metadata : {};
}

function hasSupplierImportSignals(product = {}) {
  const metadata = getMetadata(product);
  const supplierImport = metadata.supplierImport || metadata.supplier_import || null;
  const importSource = normalizeText(metadata.importSource || metadata.import_source || product.importSource || product.import_source);
  const source = normalizeText(product.source_type || product.sourceType || product.catalog_source || product.catalogSource);
  const rawSignals = [
    product.externalId,
    product.external_id,
    product.supplierPartNumber,
    product.supplier_part_number,
    product.supplierCode,
    product.supplier_code,
    product.manufacturerArticleCode,
    product.manufacturer_article_code,
    metadata.supplierPartNumber,
    metadata.csvStockQuantity,
  ];
  return Boolean(
    supplierImport ||
      importSource === "catalog_csv" ||
      importSource === "parts_csv" ||
      source === "catalog_csv" ||
      source === "parts_csv" ||
      rawSignals.some((value) => cleanText(value))
  );
}

function hasExplicitPhysicalSignal(product = {}) {
  const explicit = normalizeText(product.stock_mode || product.fulfillment_mode || product.delivery_mode || product.deliveryMode);
  return ["physical", "fisico", "local", "manual", "inmediato", "immediate"].includes(explicit);
}

function hasExplicitRemoteSignal(product = {}) {
  const explicit = normalizeText(product.stock_mode || product.fulfillment_mode || product.delivery_mode || product.deliveryMode);
  if (["remote", "remoto", "supplier", "proveedor", "a_pedido", "pedido"].includes(explicit)) return true;
  const remoteLead = toNumberOrNull(product.remote_lead_days ?? product.remote_lead_min_days ?? product.remote_lead_max_days);
  const remoteStock = toNumberOrNull(product.remote_stock ?? product.stock_remoto ?? product.supplier_stock);
  return Boolean((remoteLead && remoteLead > 0) || (remoteStock && remoteStock > 0));
}

function hasRemoteCopySignal(product = {}) {
  const haystack = [
    product.name,
    product.title,
    product.description,
    product.short_description,
    product.category,
    product.subcategory,
    product.status,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
  return /a pedido|preventa|importad|internacional|encargo|bajo pedido|stock remoto|demora/.test(haystack);
}

export function resolveDeliveryProfile(product = {}) {
  if (!product || typeof product !== "object") return { mode: "remote", minDays: REMOTE_MIN_DAYS, maxDays: REMOTE_MAX_DAYS };

  if (hasExplicitPhysicalSignal(product)) {
    return { mode: "physical", minDays: 1, maxDays: 2, reason: "explicit_physical" };
  }

  if (hasExplicitRemoteSignal(product) || hasSupplierImportSignals(product) || hasRemoteCopySignal(product)) {
    const rawMin = toNumberOrNull(product.remote_lead_min_days ?? product.remote_lead_days);
    const rawMax = toNumberOrNull(product.remote_lead_max_days ?? rawMin);
    return {
      mode: "remote",
      minDays: Math.max(REMOTE_MIN_DAYS, Math.floor(rawMin || REMOTE_MIN_DAYS)),
      maxDays: Math.max(REMOTE_MAX_DAYS, Math.floor(rawMax || REMOTE_MAX_DAYS)),
      reason: "remote_signals",
    };
  }

  if (hasLocalUploadedAsset(product)) {
    return { mode: "physical", minDays: 1, maxDays: 2, reason: "local_uploaded_asset" };
  }

  return { mode: "remote", minDays: REMOTE_MIN_DAYS, maxDays: REMOTE_MAX_DAYS, reason: "default_remote" };
}

export function applyDeliveryPolicyToProduct(product = {}) {
  if (!product || typeof product !== "object") return product;
  const profile = resolveDeliveryProfile(product);
  const normalized = { ...product };
  normalized.delivery_profile = profile.mode;
  normalized.delivery_policy_reason = profile.reason || "delivery_policy";

  if (profile.mode === "remote") {
    normalized.stock_mode = "remote";
    normalized.fulfillment_mode = "remote";
    normalized.remote_lead_days = profile.minDays;
    normalized.remote_lead_min_days = profile.minDays;
    normalized.remote_lead_max_days = profile.maxDays;
    normalized.deliveryPromise = `Entrega estimada: ${profile.minDays} a ${profile.maxDays} días.`;
    normalized.delivery_promise = normalized.deliveryPromise;
  } else {
    normalized.stock_mode = "physical";
    normalized.fulfillment_mode = "physical";
    normalized.remote_stock = 0;
    normalized.remote_lead_days = 0;
    normalized.remote_lead_min_days = 0;
    normalized.remote_lead_max_days = 0;
    normalized.deliveryPromise = "Entrega estimada: 24 a 48 hs hábiles.";
    normalized.delivery_promise = normalized.deliveryPromise;
  }

  return normalized;
}

function rememberDeliveryProduct(product) {
  if (!product || typeof product !== "object") return product;
  if (typeof window !== "undefined") {
    window.NERIN_CURRENT_DELIVERY_PRODUCT = product;
    window.NERIN_CURRENT_DELIVERY_PROFILE = resolveDeliveryProfile(product);
  }
  return product;
}

function normalizePayload(payload) {
  if (Array.isArray(payload)) return payload.map(applyDeliveryPolicyToProduct);
  if (!payload || typeof payload !== "object") return payload;
  const next = { ...payload };
  if (Array.isArray(next.items)) next.items = next.items.map(applyDeliveryPolicyToProduct);
  if (Array.isArray(next.products)) next.products = next.products.map(applyDeliveryPolicyToProduct);
  if (next.product && typeof next.product === "object") next.product = rememberDeliveryProduct(applyDeliveryPolicyToProduct(next.product));
  if (next.item && typeof next.item === "object") next.item = rememberDeliveryProduct(applyDeliveryPolicyToProduct(next.item));
  if ((next.id || next.sku || next.slug || next.publicSlug || next.public_slug) && (next.name || next.title || next.price || next.price_minorista)) {
    return rememberDeliveryProduct(applyDeliveryPolicyToProduct(next));
  }
  return next;
}

function shouldNormalizeResponse(input, response) {
  const contentType = response?.headers?.get?.("content-type") || "";
  if (!contentType.includes("application/json")) return false;
  let url = "";
  try {
    url = typeof input === "string" ? input : input?.url || "";
    const parsed = new URL(url, window.location.origin);
    return /^\/api\/products(?:\/|\?|$)/.test(parsed.pathname + parsed.search) || /^\/api\/product(?:\/|\?|$)/.test(parsed.pathname + parsed.search);
  } catch {
    return String(url).includes("/api/products") || String(url).includes("/api/product");
  }
}

function installFetchPatch() {
  if (window.__NERIN_DELIVERY_POLICY_PATCHED__) return;
  if (typeof window.fetch !== "function") return;
  window.__NERIN_DELIVERY_POLICY_PATCHED__ = DELIVERY_POLICY_VERSION;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function deliveryPolicyFetch(input, init) {
    const response = await nativeFetch(input, init);
    if (!shouldNormalizeResponse(input, response)) return response;
    try {
      const clone = response.clone();
      const payload = await clone.json();
      const normalized = normalizePayload(payload);
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(normalized), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.warn("[delivery-policy] normalize failed", error);
      return response;
    }
  };
}

function buildRemoteDelayTermsMessage(product) {
  const profile = resolveDeliveryProfile(product || {});
  const name = cleanText(product?.name || product?.title || "este producto");
  return [
    `Este producto (${name}) es con stock remoto y demora estimada de ${profile.minDays} a ${profile.maxDays} días.`,
    "La publicación está sujeta a disponibilidad real del proveedor.",
    "Si el proveedor no tiene stock al confirmar la compra, la operación puede cancelarse y se reintegra el 100% del dinero abonado por el mismo medio de pago.",
    "Antes de pagar, recomendamos confirmar por WhatsApp.",
    "Al continuar, confirmás que leíste y aceptás estos términos para productos con demora."
  ].join("\n\n");
}

function isProductDetailPage() {
  const path = String(window.location?.pathname || "");
  return Boolean(document.getElementById("productInfo")) || /^\/p\//.test(path) || /product\.html$/i.test(path);
}

function isAddToCartTarget(target) {
  const clickable = target?.closest?.("button, a, [role='button']");
  if (!clickable) return false;
  const text = normalizeText(clickable.textContent || clickable.getAttribute("aria-label") || "");
  const marker = normalizeText([
    clickable.id,
    clickable.name,
    clickable.className,
    clickable.dataset?.action,
    clickable.dataset?.cartAction,
  ].join(" "));
  return /agregar/.test(text) && /carrito/.test(text) || /add.*cart|cart.*add|agregar.*carrito/.test(marker);
}

function installProductDetailDelayConfirm() {
  if (window.__NERIN_PRODUCT_DELAY_CONFIRM__) return;
  window.__NERIN_PRODUCT_DELAY_CONFIRM__ = DELIVERY_POLICY_VERSION;
  document.addEventListener("click", (event) => {
    if (!isProductDetailPage() || !isAddToCartTarget(event.target)) return;
    const product = window.NERIN_CURRENT_DELIVERY_PRODUCT;
    if (!product) return;
    const profile = resolveDeliveryProfile(product);
    if (profile.mode !== "remote") return;
    const accepted = window.confirm(buildRemoteDelayTermsMessage(product));
    if (accepted) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  }, true);
}

installFetchPatch();
installProductDetailDelayConfirm();

if (typeof window !== "undefined") {
  window.NERIN_DELIVERY_POLICY_VERSION = DELIVERY_POLICY_VERSION;
  window.NERIN_APPLY_DELIVERY_POLICY = applyDeliveryPolicyToProduct;
  window.NERIN_RESOLVE_DELIVERY_PROFILE = resolveDeliveryProfile;
}
