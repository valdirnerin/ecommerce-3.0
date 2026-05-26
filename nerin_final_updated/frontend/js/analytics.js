import { apiFetch } from "./api.js";

const ANALYTICS_CURRENCY = "ARS";
const PURCHASE_DEDUPE_PREFIX = "nerin.analytics.purchase.";
const RECENT_EVENT_LIMIT = 80;

const hasWindow = () => typeof window !== "undefined";
const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const cleanText = (value) => String(value ?? "").trim();
const lower = (value) => cleanText(value).toLowerCase();
const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && cleanText(value) !== "");

function getConfigValue(...keys) {
  if (!hasWindow()) return "";
  const config = window.NERIN_CONFIG || window.__NERIN_CONFIG__ || {};
  for (const key of keys) {
    if (config[key]) return config[key];
  }
  return "";
}

function stockQty(product = {}) {
  return safeNumber(firstValue(product.stock, product.stock_qty, product.stockQty, product.quantity, product.available_stock), 0);
}

function hasStockQuantity(product = {}) {
  return firstValue(product.stock, product.stock_qty, product.stockQty, product.available_stock) !== undefined;
}

function normalizeAvailability(product = {}) {
  const raw = lower(firstValue(product.availability, product.stock_status, product.stockStatus, product.status, ""));
  if (raw.includes("preorder")) return "preorder";
  if (raw.includes("backorder") || raw.includes("pedido") || raw.includes("remote")) return "backorder";
  if (raw.includes("out_of_stock") || raw.includes("sin stock") || raw.includes("unavailable")) return "out_of_stock";
  if (raw.includes("in_stock") || raw.includes("stock")) return "in_stock";
  return stockQty(product) > 0 ? "in_stock" : "out_of_stock";
}

function isPreorderProduct(product = {}) {
  const availability = normalizeAvailability(product);
  return availability === "preorder" || availability === "backorder" || Boolean(product.allow_backorder || product.allowBackorder || product.remote_stock || product.remoteStock);
}

function isStockRealProduct(product = {}) {
  const availability = normalizeAvailability(product);
  return availability === "in_stock" && !isPreorderProduct(product) && (stockQty(product) > 0 || !hasStockQuantity(product));
}

function productPrice(product = {}) {
  return safeNumber(firstValue(product.price, product.final_price, product.finalPrice, product.sale_price, product.salePrice), 0);
}

function productId(product = {}) {
  return cleanText(firstValue(product.id, product.product_id, product.productId, product.sku, product.code, product.mpn, product.slug, product.publicSlug));
}

function productName(product = {}) {
  return cleanText(firstValue(product.title, product.name, product.product_name, product.productName, product.description, productId(product), "Producto NERIN"));
}

function productBrand(product = {}) {
  return cleanText(firstValue(product.brand, product.marca, product.manufacturer, product.vendor, "NERIN Parts"));
}

function productCategory(product = {}) {
  return cleanText(firstValue(product.category, product.categoria, product.product_type, product.productType, product.part_type, product.partType, "Repuestos"));
}

function productVariant(product = {}) {
  return cleanText(firstValue(product.variant, product.model, product.modelo, product.compatibility, product.compatibilidad, product.exactModel, ""));
}

export function normalizeAnalyticsItem(product = {}, quantity = 1) {
  const availability = normalizeAvailability(product);
  const item = {
    item_id: productId(product),
    item_name: productName(product),
    item_brand: productBrand(product),
    item_category: productCategory(product),
    item_variant: productVariant(product),
    price: productPrice(product),
    quantity: Math.max(1, safeNumber(quantity || product.quantity || product.qty, 1)),
    currency: ANALYTICS_CURRENCY,
    sku: cleanText(firstValue(product.sku, product.code, product.product_sku, "")),
    mpn: cleanText(firstValue(product.mpn, product.MPN, "")),
    public_slug: cleanText(firstValue(product.publicSlug, product.public_slug, product.slug, "")),
    stock_status: availability,
    stock_qty: stockQty(product),
    is_stock_real: isStockRealProduct(product),
    is_preorder: isPreorderProduct(product),
    availability,
  };
  if (!item.item_id) item.item_id = item.sku || item.mpn || item.public_slug || item.item_name;
  return item;
}

function normalizeItems(items = []) {
  const source = Array.isArray(items) ? items : [items];
  return source.filter(Boolean).map((item) => normalizeAnalyticsItem(item, item.quantity || item.qty || 1)).filter((item) => item.item_id && item.item_name);
}

function cartValue(cart = []) {
  return normalizeItems(cart).reduce((sum, item) => sum + safeNumber(item.price) * safeNumber(item.quantity, 1), 0);
}

function debugEnabled() {
  if (!hasWindow()) return false;
  const params = new URLSearchParams(window.location.search || "");
  return params.get("debugAnalytics") === "1" || window.NERIN_ANALYTICS_DEBUG?.enabled === true || window.localStorage?.getItem("NERIN_ANALYTICS_DEBUG") === "1";
}

function ensureDebugState() {
  if (!hasWindow()) return null;
  if (!window.NERIN_ANALYTICS_DEBUG || !Array.isArray(window.NERIN_ANALYTICS_DEBUG.events)) {
    window.NERIN_ANALYTICS_DEBUG = {
      enabled: debugEnabled(),
      events: [],
      hasGtag: typeof window.gtag === "function",
      hasFbq: typeof window.fbq === "function",
      hasDataLayer: Array.isArray(window.dataLayer),
    };
  }
  return window.NERIN_ANALYTICS_DEBUG;
}

function recordDebug(name, payload, status = "sent") {
  if (!hasWindow()) return;
  const state = ensureDebugState();
  if (!state) return;
  const event = {
    name,
    status,
    payload,
    page_path: window.location?.pathname || "",
    sent_at: new Date().toISOString(),
    hasGtag: typeof window.gtag === "function",
    hasFbq: typeof window.fbq === "function",
    hasDataLayer: Array.isArray(window.dataLayer),
  };
  state.events.push(event);
  state.events.splice(0, Math.max(0, state.events.length - RECENT_EVENT_LIMIT));
  state.lastEvent = event;
  state.enabled = debugEnabled();
  state.hasGtag = event.hasGtag;
  state.hasFbq = event.hasFbq;
  state.hasDataLayer = event.hasDataLayer;
  if (state.enabled) {
    renderDebugPanel(state);
    console.info("[NERIN analytics]", name, payload);
  }
}

function renderDebugPanel(state) {
  if (!hasWindow() || !state?.enabled || !document?.body) return;
  let panel = document.getElementById("nerin-analytics-debug-panel");
  if (!panel) {
    panel = document.createElement("aside");
    panel.id = "nerin-analytics-debug-panel";
    panel.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(420px,calc(100vw - 32px));max-height:55vh;overflow:auto;background:#111827;color:#f9fafb;border:1px solid rgba(255,255,255,.18);border-radius:14px;box-shadow:0 18px 45px rgba(0,0,0,.25);font:12px/1.4 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:12px;";
    document.body.appendChild(panel);
  }
  const rows = state.events.slice(-10).reverse().map((event) => `<li><strong>${escapeHtml(event.name)}</strong> <span>${escapeHtml(event.status)}</span><pre>${escapeHtml(JSON.stringify(event.payload, null, 2)).slice(0, 1600)}</pre></li>`).join("");
  panel.innerHTML = `<strong>NERIN_ANALYTICS_DEBUG</strong><p>gtag: ${state.hasGtag ? "si" : "no"} · fbq: ${state.hasFbq ? "si" : "no"} · dataLayer: ${state.hasDataLayer ? "si" : "no"}</p><ol style="padding-left:18px;margin:0;display:grid;gap:8px">${rows}</ol>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[ch]));
}

function loadOptionalTags() {
  if (!hasWindow() || !document?.head) return;
  const ga4Id = getConfigValue("GA4_MEASUREMENT_ID", "ga4MeasurementId", "ga4_measurement_id");
  if (ga4Id && typeof window.gtag !== "function" && !document.getElementById("nerin-ga4-loader")) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(){ window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", ga4Id);
    const script = document.createElement("script");
    script.id = "nerin-ga4-loader";
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`;
    document.head.appendChild(script);
  }
  const metaPixelId = getConfigValue("META_PIXEL_ID", "metaPixelId", "meta_pixel_id");
  if (metaPixelId && typeof window.fbq !== "function" && !document.getElementById("nerin-meta-pixel-loader")) {
    const fbq = function fbq(){ fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];
    window.fbq = fbq;
    window._fbq = fbq;
    fbq("init", metaPixelId);
    fbq("track", "PageView");
    const script = document.createElement("script");
    script.id = "nerin-meta-pixel-loader";
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
}

function metaPayload(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    content_ids: items.map((item) => item.item_id).filter(Boolean),
    contents: items.map((item) => ({ id: item.item_id, quantity: item.quantity, item_price: item.price })),
    content_type: "product",
    value: safeNumber(payload.value),
    currency: ANALYTICS_CURRENCY,
  };
}

function emitAnalyticsEvent(name, payload = {}, options = {}) {
  if (!hasWindow()) return false;
  loadOptionalTags();
  const eventPayload = { ...payload };
  if (!eventPayload.currency && ["add_to_cart", "view_cart", "begin_checkout", "add_shipping_info", "add_payment_info", "purchase"].includes(name)) {
    eventPayload.currency = ANALYTICS_CURRENCY;
  }
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag === "function") {
    window.gtag("event", name, eventPayload);
  } else {
    if (eventPayload.items) window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({ event: name, ...eventPayload });
  }
  if (options.metaEvent && typeof window.fbq === "function") window.fbq("track", options.metaEvent, options.metaPayload || metaPayload(eventPayload));
  recordDebug(name, eventPayload);
  return true;
}

export function trackViewItem(product = {}) {
  const item = normalizeAnalyticsItem(product, 1);
  return emitAnalyticsEvent("view_item", { currency: ANALYTICS_CURRENCY, value: item.price, items: [item] }, { metaEvent: "ViewContent" });
}

export function trackViewItemList(products = [], context = {}) {
  const items = normalizeItems(products);
  if (!items.length) return false;
  return emitAnalyticsEvent("view_item_list", {
    item_list_id: cleanText(context.item_list_id || context.source || context.page_path || "catalog"),
    item_list_name: cleanText(context.item_list_name || context.source || "Catalogo"),
    context,
    items,
  });
}

export function trackSelectItem(product = {}, context = {}) {
  const item = normalizeAnalyticsItem(product, 1);
  return emitAnalyticsEvent("select_item", {
    item_list_id: cleanText(context.item_list_id || context.source || "catalog"),
    item_list_name: cleanText(context.item_list_name || context.source || "Catalogo"),
    context,
    items: [item],
  });
}

export function trackSearch(query = "", resultCount = 0, context = {}) {
  const searchTerm = cleanText(query);
  if (!searchTerm) return false;
  return emitAnalyticsEvent("search", {
    search_term: searchTerm,
    result_count: safeNumber(resultCount),
    context,
  });
}

export function trackAddToCart(product = {}, quantity = 1) {
  const item = normalizeAnalyticsItem(product, quantity);
  return emitAnalyticsEvent("add_to_cart", { currency: ANALYTICS_CURRENCY, value: item.price * item.quantity, items: [item] }, { metaEvent: "AddToCart" });
}

export function trackRemoveFromCart(product = {}, quantity = 1) {
  const item = normalizeAnalyticsItem(product, quantity);
  return emitAnalyticsEvent("remove_from_cart", { currency: ANALYTICS_CURRENCY, value: item.price * item.quantity, items: [item] });
}

export function trackViewCart(cart = []) {
  const items = normalizeItems(cart);
  return emitAnalyticsEvent("view_cart", { currency: ANALYTICS_CURRENCY, value: cartValue(cart), items });
}

export function trackBeginCheckout(cart = []) {
  const items = normalizeItems(cart);
  return emitAnalyticsEvent("begin_checkout", { currency: ANALYTICS_CURRENCY, value: cartValue(cart), items }, { metaEvent: "InitiateCheckout" });
}

export function trackAddShippingInfo(cart = [], shippingInfo = {}) {
  const items = normalizeItems(cart);
  return emitAnalyticsEvent("add_shipping_info", {
    currency: ANALYTICS_CURRENCY,
    value: cartValue(cart),
    shipping_tier: cleanText(firstValue(shippingInfo.shipping_tier, shippingInfo.method, shippingInfo.tipo, shippingInfo.carrier, "pending")),
    shipping_info: shippingInfo,
    items,
  });
}

export function trackAddPaymentInfo(cart = [], paymentInfo = {}) {
  const items = normalizeItems(cart);
  return emitAnalyticsEvent("add_payment_info", {
    currency: ANALYTICS_CURRENCY,
    value: cartValue(cart),
    payment_type: cleanText(firstValue(paymentInfo.payment_type, paymentInfo.method, paymentInfo.metodo, paymentInfo.type, "pending")),
    payment_info: paymentInfo,
    items,
  });
}

function orderItems(order = {}) {
  return normalizeItems(firstValue(order.items, order.cart, order.order?.items, order.order?.cart, []));
}

function orderTransactionId(order = {}) {
  return cleanText(firstValue(order.transaction_id, order.transactionId, order.orderId, order.order_id, order.id, order.nrn, order.order?.id, order.order?.orderId));
}

function orderValue(order = {}, items = []) {
  return safeNumber(firstValue(order.value, order.total, order.amount, order.totalAmount, order.order?.total, order.order?.amount), items.reduce((sum, item) => sum + item.price * item.quantity, 0));
}

function storageHas(key) {
  try {
    return window.localStorage?.getItem(key) === "1" || window.sessionStorage?.getItem(key) === "1";
  } catch (_) {
    return false;
  }
}

function storageSet(key) {
  try { window.localStorage?.setItem(key, "1"); } catch (_) {}
  try { window.sessionStorage?.setItem(key, "1"); } catch (_) {}
}

export function trackPurchase(order = {}) {
  if (!hasWindow()) return false;
  const transactionId = orderTransactionId(order);
  if (!transactionId) {
    recordDebug("purchase", { error: "missing transaction_id", order }, "skipped");
    return false;
  }
  const dedupeKey = `${PURCHASE_DEDUPE_PREFIX}${transactionId}`;
  if (storageHas(dedupeKey)) {
    recordDebug("purchase", { transaction_id: transactionId, reason: "deduplicated" }, "skipped");
    return false;
  }
  const items = orderItems(order);
  const payload = {
    transaction_id: transactionId,
    value: orderValue(order, items),
    currency: ANALYTICS_CURRENCY,
    shipping: safeNumber(firstValue(order.shipping, order.shipping_total, order.envio?.costo, order.order?.shipping), 0),
    tax: safeNumber(firstValue(order.tax, order.tax_total, order.order?.tax), 0),
    payment_type: cleanText(firstValue(order.payment_type, order.paymentType, order.method, order.payment?.type, order.payment?.method, "")),
    items,
  };
  const sent = emitAnalyticsEvent("purchase", payload, { metaEvent: "Purchase" });
  if (sent) storageSet(dedupeKey);
  return sent;
}

export function trackWhatsappClick(context = {}) {
  return emitAnalyticsEvent("whatsapp_click", {
    source: cleanText(context.source || "unknown"),
    product_id: cleanText(firstValue(context.product_id, context.productId, context.id, "")),
    sku: cleanText(context.sku || ""),
    product_name: cleanText(firstValue(context.product_name, context.productName, context.title, context.name, "")),
    stock_status: cleanText(context.stock_status || ""),
    is_stock_real: Boolean(context.is_stock_real),
    page_path: hasWindow() ? window.location.pathname : "",
    context,
  }, { metaEvent: "Contact", metaPayload: { content_name: context.product_name || context.productName || context.source || "WhatsApp", currency: ANALYTICS_CURRENCY } });
}

export function trackStockRealProductView(product = {}) {
  if (!isStockRealProduct(product)) return false;
  return emitAnalyticsEvent("stock_real_product_view", { currency: ANALYTICS_CURRENCY, value: productPrice(product), items: [normalizeAnalyticsItem(product, 1)] });
}

export function trackStockRealAddToCart(product = {}, quantity = 1) {
  if (!isStockRealProduct(product)) return false;
  const item = normalizeAnalyticsItem(product, quantity);
  return emitAnalyticsEvent("stock_real_add_to_cart", { currency: ANALYTICS_CURRENCY, value: item.price * item.quantity, items: [item] });
}

export function trackStockRealPurchase(order = {}) {
  const transactionId = orderTransactionId(order);
  const items = orderItems(order).filter((item) => item.is_stock_real);
  if (!items.length || !transactionId) return false;
  const dedupeKey = `${PURCHASE_DEDUPE_PREFIX}stock_real.${transactionId}`;
  if (storageHas(dedupeKey)) {
    recordDebug("stock_real_purchase", { transaction_id: transactionId, reason: "deduplicated" }, "skipped");
    return false;
  }
  const sent = emitAnalyticsEvent("stock_real_purchase", {
    transaction_id: transactionId,
    value: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    currency: ANALYTICS_CURRENCY,
    items,
  });
  if (sent) storageSet(dedupeKey);
  return sent;
}

if (hasWindow()) ensureDebugState();

const LIVE_MS = 8000;
const DETAIL_MS = 0;
const state = { range: "7d", from: "", to: "" };
let liveTimer = null;
let detailTimer = null;
let liveBusy = false;
let detailBusy = false;
let hasDetail = false;

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const num = (v) => (Number(v) || 0).toLocaleString("es-AR");
const money = (v) => (Number(v) || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const pct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`;
const mins = (v) => { const n = Number(v) || 0; return n >= 120 ? `${(n / 60).toFixed(1)} h` : `${n.toFixed(1)} min`; };
const clock = (v) => { const d = v ? new Date(v) : new Date(); return Number.isNaN(d.getTime()) ? "sin eventos" : d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); };
const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

function params() {
  const p = new URLSearchParams();
  p.set("range", state.range || "7d");
  if (state.range === "custom") {
    if (state.from) p.set("from", state.from);
    if (state.to) p.set("to", state.to);
  }
  return p;
}

function card(id, title, subtitle, tone = "default") {
  return `<article class="analytics-card analytics-card--${tone}"><h4>${esc(title)}</h4><p class="analytics-card__metric" id="${id}">—</p><p class="analytics-card__caption" id="${id}-caption">${esc(subtitle)}</p></article>`;
}

function shell(container) {
  if (!container || container.dataset.fastAnalytics === "1") return;
  container.dataset.fastAnalytics = "1";
  container.dataset.analyticsReady = "1";
  container.innerHTML = `
    <div class="analytics-controls"><div class="analytics-range">
      <label for="analytics-range-select">Rango de análisis</label>
      <select id="analytics-range-select"><option value="today">Hoy</option><option value="7d">7 días</option><option value="30d">30 días</option><option value="custom">Personalizado</option></select>
      <div class="analytics-range__custom" id="analytics-custom-range" style="display:none"><input type="date" id="analytics-from-date"><input type="date" id="analytics-to-date"><button type="button" class="button secondary" id="analytics-apply-range">Aplicar</button></div>
      <button type="button" class="button secondary" id="analytics-refresh-now">Actualizar ahora</button>
    </div></div>
    <div class="analytics-meta" role="status"><span class="analytics-meta__status" id="analytics-live-updated-at">Cargando datos en vivo...</span><span class="analytics-meta__hint">En vivo cada ${Math.round(LIVE_MS / 1000)} s</span><span class="analytics-meta__hint">Reporte detallado limitado para proteger rendimiento. Actualizar manualmente</span><span class="analytics-meta__hint" id="analytics-live-health">Último evento: cargando...</span><span class="analytics-meta__hint" id="analytics-detail-status">Métricas detalladas: cargando...</span></div>
    <div class="analytics-summary-grid">${card("analytics-live-active-sessions", "Sesiones activas", "Personas navegando en tiempo real", "primary")}${card("analytics-live-checkout-in-progress", "Checkout en curso", "Usuarios a punto de comprar", "warning")}${card("analytics-visitors-today", "Visitantes hoy", "Datos detallados")}${card("analytics-revenue-today", "Ingresos hoy", "Datos detallados", "success")}${card("analytics-conversion-rate", "Tasa de conversión", "Datos detallados", "info")}${card("analytics-average-session-duration", "Duración media sesión", "Datos detallados")}</div>
    <div class="analytics-two-column"><section class="analytics-panel"><h4>Sesiones en vivo</h4><div id="analytics-live-sessions-panel" class="analytics-empty">Cargando sesiones...</div></section><section class="analytics-panel"><h4>Productos más vistos</h4><div id="analytics-hot-products-panel" class="analytics-empty">Cargando productos...</div></section></div>
    <div class="analytics-two-column analytics-two-column--balanced"><section class="analytics-panel"><h4>Insights automáticos</h4><div id="analytics-insights-panel" class="analytics-empty">Cargando insights...</div></section><section class="analytics-panel"><h4>Calidad de tráfico</h4><div id="analytics-quality-panel" class="analytics-empty">Cargando calidad...</div></section></div>
    <div class="analytics-charts" id="analytics-charts-panel"><div class="analytics-empty analytics-empty--inline">Los gráficos se actualizan en segundo plano.</div></div>`;

  const range = document.getElementById("analytics-range-select");
  const custom = document.getElementById("analytics-custom-range");
  const from = document.getElementById("analytics-from-date");
  const to = document.getElementById("analytics-to-date");
  range.value = state.range;
  range.addEventListener("change", () => {
    state.range = range.value;
    custom.style.display = state.range === "custom" ? "flex" : "none";
    if (state.range !== "custom") { state.from = ""; state.to = ""; fetchDetail(true); }
  });
  document.getElementById("analytics-apply-range")?.addEventListener("click", () => { state.range = "custom"; state.from = from?.value || ""; state.to = to?.value || ""; fetchDetail(true); });
  document.getElementById("analytics-refresh-now")?.addEventListener("click", () => { fetchLive(true); fetchDetail(true); });
}

function renderLiveSessions(sessions = []) {
  const panel = document.getElementById("analytics-live-sessions-panel");
  if (!panel) return;
  const list = Array.isArray(sessions) ? sessions.slice(0, 12) : [];
  if (!list.length) { panel.className = "analytics-empty"; panel.textContent = "No hay sesiones activas en este momento."; return; }
  panel.className = "";
  panel.innerHTML = `<table class="analytics-live-table"><thead><tr><th>Usuario</th><th>Última actividad</th><th>Etapa</th><th>Carrito</th></tr></thead><tbody>${list.map((s) => `<tr><td><strong>${esc(s.userName || s.userEmail || s.id || "Visitante")}</strong></td><td>${esc(clock(s.lastSeenAt || s.updatedAt))}</td><td>${esc(String(s.currentStep || "Explorando").replace(/_/g, " "))}</td><td>${esc(s.cartValue ? money(s.cartValue) : "—")}</td></tr>`).join("")}</tbody></table>`;
}

function applyLive(data = {}) {
  setText("analytics-live-active-sessions", num(data.activeSessions));
  setText("analytics-live-checkout-in-progress", num(data.checkoutInProgress));
  setText("analytics-live-updated-at", `Última actualización ${clock(data.updatedAt)}`);
  setText("analytics-live-health", `Último evento ${clock(data.lastEventAt)} · ${num(data.eventsLastHour)} eventos/h`);
  renderLiveSessions(data.liveSessions);
}

async function fetchLive(force = false) {
  if (liveBusy && !force) return;
  liveBusy = true;
  try {
    const res = await apiFetch("/api/analytics/live", { cache: "no-store" });
    if (!res.ok) throw new Error(`live analytics ${res.status}`);
    applyLive(await res.json());
  } catch (err) {
    console.warn("analytics-live-refresh-error", err);
    setText("analytics-live-updated-at", "No se pudieron actualizar los datos en vivo");
  } finally { liveBusy = false; }
}

function renderListPanel(id, items, emptyText) {
  const panel = document.getElementById(id);
  if (!panel) return;
  if (!items.length) { panel.className = "analytics-empty"; panel.textContent = emptyText; return; }
  panel.className = "analytics-hot-products";
  panel.innerHTML = `<ol class="analytics-hot-products__list">${items.map((i) => `<li><span>${esc(i.name || i.path || i.message || "Item")}</span><strong>${i.count != null ? num(i.count) : ""}</strong></li>`).join("")}</ol>`;
}

function applyDetail(a = {}) {
  setText("analytics-visitors-today", num(a.visitorsToday));
  setText("analytics-revenue-today", money(a.revenueToday));
  setText("analytics-revenue-today-caption", `${num(a.ordersToday)} órdenes confirmadas`);
  setText("analytics-conversion-rate", pct(a.conversionRate));
  setText("analytics-conversion-rate-caption", `Abandono ${pct(a.cartAbandonmentRate)}`);
  setText("analytics-average-session-duration", mins(a.averageSessionDuration));
  setText("analytics-average-session-duration-caption", `Mediana ${mins(a.medianSessionDuration)}`);
  const products = (Array.isArray(a.productViewsToday) ? a.productViewsToday : []).concat(Array.isArray(a.productViewsWeek) ? a.productViewsWeek : []).sort((x, y) => Number(y.count || 0) - Number(x.count || 0)).slice(0, 8);
  renderListPanel("analytics-hot-products-panel", products, "Sin datos de productos vistos todavía.");
  renderListPanel("analytics-insights-panel", Array.isArray(a.insights) ? a.insights.slice(0, 6) : [], "Sin insights por ahora.");
  const quality = [{ name: "Tasa de rebote", count: pct(a.bounceRate) }, { name: "Sesiones comprometidas", count: pct(a.engagedSessionsRate) }, { name: "Clientes recurrentes", count: pct(a.repeatCustomerRate) }];
  renderListPanel("analytics-quality-panel", quality, "Sin datos de calidad todavía.");
  const charts = document.getElementById("analytics-charts-panel");
  if (charts) charts.innerHTML = `<div class="analytics-empty analytics-empty--inline">Métricas detalladas actualizadas. Gráficos completos se mantienen desactivados para priorizar carga rápida.</div>`;
}

async function fetchDetail(force = false) {
  if (detailBusy && !force) return;
  detailBusy = true;
  setText("analytics-detail-status", "Métricas detalladas: actualizando...");
  try {
    const p = params();
    if (force) p.set("force", "1");
    const res = await apiFetch(`/api/analytics/detailed?${p.toString()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`detailed analytics ${res.status}`);
    const payload = await res.json();
    const analytics = payload?.analytics || payload || {};
    if (analytics.analyticsAvailable === false) { setText("analytics-detail-status", analytics.error || analytics.message || "No se pudieron cargar las métricas detalladas."); return; }
    hasDetail = true;
    applyDetail(analytics);
    setText("analytics-detail-status", `Métricas detalladas actualizadas ${clock(new Date().toISOString())}`);
    if (payload?.disabled) setText("analytics-detail-status", "Reporte detallado desactivado para proteger rendimiento.");
    if (payload?.partial || payload?.truncated) setText("analytics-detail-status", `Reporte limitado: ${payload.error || "truncated"}`);
  } catch (err) {
    console.error("analytics-detailed-refresh-error", err);
    setText("analytics-detail-status", "No se pudieron actualizar las métricas detalladas.");
  } finally { detailBusy = false; }
}

function timers() {
  if (!liveTimer) liveTimer = window.setInterval(() => fetchLive(), LIVE_MS);
  // detailed manual refresh only
}

export async function renderAnalyticsDashboard(containerId = "analytics-dashboard", options = {}) {
  const { range, from, to, isAutoRefresh = false, forceDetailed = false } = options || {};
  const container = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
  if (!container) return;
  if (range) state.range = range;
  if (from !== undefined) state.from = from || "";
  if (to !== undefined) state.to = to || "";
  shell(container);
  timers();
  fetchLive(true);
  if (!isAutoRefresh || forceDetailed || !hasDetail) fetchDetail(Boolean(forceDetailed));
}
