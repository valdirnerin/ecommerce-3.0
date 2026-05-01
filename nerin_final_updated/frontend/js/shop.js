import { fetchProductsPage, getUserRole, isWholesale } from "./api.js";
import { createPriceLegalBlock } from "./components/PriceLegalBlock.js";
import { calculateNetNoNationalTaxes } from "./utils/pricing.js";

console.info("[shop-products] shop.js loaded", {
  version: "sqlite-public-debug-v3",
  timestamp: new Date().toISOString(),
});

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});


function toNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveProductTitle(product) {
  return cleanLabel(product.name || product.title || product.product_title || "");
}

function resolveCategoryLabel(product) {
  return cleanLabel(product.category || product.categoria || product.product_category || "");
}

function resolveStockQuantity(product) {
  const candidates = [product.stock, product.quantity, product.available_quantity, product.qty_available];
  for (const candidate of candidates) {
    const parsed = toNumberOrNull(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function normalizeStorefrontProduct(product) {
  if (!product || typeof product !== "object") return product;
  const normalized = { ...product };
  const title = resolveProductTitle(product);
  if (title && !cleanLabel(normalized.name)) normalized.name = title;
  const category = resolveCategoryLabel(product);
  if (category && !cleanLabel(normalized.category)) normalized.category = category;
  const stockQty = resolveStockQuantity(product);
  if (stockQty !== null && !Number.isFinite(Number(normalized.stock))) normalized.stock = stockQty;
  if (!normalized.image) {
    normalized.image =
      product.image_url ||
      product.thumbnail ||
      product.picture ||
      (Array.isArray(product.pictures) && product.pictures[0]) ||
      "";
  }
  if (!Array.isArray(normalized.images) || !normalized.images.length) {
    const candidates = [normalized.image, product.image_url, product.thumbnail, product.picture]
      .map((value) => cleanLabel(value))
      .filter(Boolean);
    if (Array.isArray(product.pictures)) {
      product.pictures.forEach((pic) => {
        const value = cleanLabel(typeof pic === "string" ? pic : pic?.url || pic?.secure_url || "");
        if (value) candidates.push(value);
      });
    }
    normalized.images = Array.from(new Set(candidates));
  }
  return normalized;
}

const PLACEHOLDER_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const productGrid = document.getElementById("productGrid");
const searchInput = document.getElementById("searchInput");
const searchClear = document.getElementById("searchClear");
const brandFilter = document.getElementById("brandFilter");
const modelFilter = document.getElementById("modelFilter");
const categoryFilter = document.getElementById("categoryFilter");
const stockFilter = document.getElementById("stockFilter");
const priceRange = document.getElementById("priceRange");
const priceRangeValue = document.getElementById("priceRangeValue");
const sortSelect = document.getElementById("sortSelect");
const activeFiltersContainer = document.getElementById("activeFilters");
const resultCountEl = document.getElementById("resultCount");
const filtersToggle = document.getElementById("filtersToggle");
const shopFilters = document.getElementById("shopFilters");
const filtersBackdrop = document.getElementById("filtersBackdrop");
const applyFiltersBtn = document.getElementById("applyFilters");
const clearFiltersBtn = document.getElementById("clearFilters");
const mobileLayoutQuery = window.matchMedia("(max-width: 900px)");

let allProducts = [];
let priceFilterTouched = false;
let currentProductsPage = 1;
let productsPageSize = 24;
let publicProductsHasNextPage = false;
let publicProductsHasPrevPage = false;
let publicProductsTotalItems = null;
let publicProductsTotalPages = null;
let totalFilteredItems = 0;
let hasRealCatalogResponse = false;
let latestRequestId = 0;
let filtersInitialized = false;
let productsAbortController = null;
let searchDebounceTimer = null;
let priceDebounceTimer = null;
const SEARCH_DEBOUNCE_MS = 400;
const FILTER_DEBOUNCE_MS = 350;

const SHOP_DEBUG =
  new URLSearchParams(window.location.search).get("shopDebug") === "1" ||
  localStorage.getItem("nerinShopDebug") === "1";

function shopLog(message, payload = undefined) {
  if (!SHOP_DEBUG) return;
  if (payload === undefined) {
    console.info(`[shop] ${message}`);
    return;
  }
  console.info(`[shop] ${message}`, payload);
}

function isProductionStorefront() {
  const host = String(window.location.hostname || "").toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1";
}

async function disableCatalogClientCaches() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
      if (regs.length) shopLog("serviceWorker:unregistered", { count: regs.length });
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => /products|catalog|shop|api/i.test(key))
          .map((key) => caches.delete(key)),
      );
    }
    localStorage.removeItem("nerinProductsCache");
    sessionStorage.removeItem("nerinProductsCache");
  } catch (err) {
    shopLog("disableCatalogClientCaches:error", { message: err?.message || String(err) });
  }
}

const PAGE_SIZE_OPTIONS = [24, 48, 96];
const publicProductsPagination = document.getElementById("publicProductsPagination");
const pageSizeSelect = document.createElement("select");
pageSizeSelect.id = "shopPageSize";
PAGE_SIZE_OPTIONS.forEach((size) => {
  const option = document.createElement("option");
  option.value = String(size);
  option.textContent = `${size} por página`;
  pageSizeSelect.appendChild(option);
});

function formatCurrency(value) {
  const amount = Number(value);
  if (Number.isNaN(amount)) return "$0";
  return currencyFormatter.format(amount);
}

function cleanLabel(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  const cleaned = cleanLabel(value);
  if (!cleaned) return "";
  return cleaned
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getCatalogBrand(product) {
  return cleanLabel(product.catalog_brand || product.brand || product.manufacturer || "");
}

function getCatalogModel(product) {
  return cleanLabel(product.catalog_model || product.model || product.subcategory || "");
}

function getPartLabel(product) {
  return cleanLabel(
    product.catalog_piece ||
      product.part ||
      product.component ||
      product.part_type ||
      product.category ||
      product.subcategory ||
      "",
  );
}

function getPrimaryImage(product) {
  if (Array.isArray(product.images) && product.images.length) return product.images[0];
  return product.image;
}


function getFulfillmentMode(product) {
  const explicitMode = cleanLabel(product.stock_mode || product.fulfillment_mode || "").toLowerCase();
  if (explicitMode === "remote" || explicitMode === "remoto") return "remote";
  if (explicitMode === "physical" || explicitMode === "fisico" || explicitMode === "físico") return "physical";

  if (Number(product.remote_stock) > 0 || Number(product.remote_lead_days) > 0) return "remote";

  const stock = resolveStockQuantity(product);
  const textSignals = [product.name, product.description, product.category, product.subcategory]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/a pedido|preventa|importad|internacional|encargo|bajo pedido/.test(textSignals)) {
    return "remote";
  }
  if (Number.isFinite(stock) && stock <= 0 && /a pedido|encargo/.test(textSignals)) {
    return "remote";
  }
  return "physical";
}

function getRemoteLeadTimeCopy(product) {
  const minDays = Number(product.remote_lead_min_days || product.remote_lead_days || 0);
  const maxDays = Number(product.remote_lead_max_days || minDays || 0);
  if (minDays > 0 && maxDays >= minDays) {
    if (maxDays === minDays) return `Entrega estimada: ${minDays} día${minDays === 1 ? "" : "s"}.`;
    return `Entrega estimada: ${minDays} a ${maxDays} días.`;
  }
  return "Entrega estimada: 20 a 30 días (importación a pedido + preparación).";
}

function getDeliveryPromiseCopy(product, fulfillmentMode) {
  if (fulfillmentMode === "remote") {
    return getRemoteLeadTimeCopy(product).replace("Entrega estimada: ", "");
  }
  return "24 a 48 hs hábiles.";
}


function shouldRequireDelayTermsAcceptance(product, fulfillmentMode = getFulfillmentMode(product)) {
  if (fulfillmentMode !== "remote") return false;
  return true;
}

function buildDelayTermsMessage(product) {
  const deliveryCopy = getDeliveryPromiseCopy(product, "remote");
  return [
    `Este producto es con demora: ${deliveryCopy}`,
    "Condiciones legales (AR): la publicación es informativa y está sujeta a disponibilidad real del proveedor.",
    "Si no hay stock al momento de confirmar, la operación puede cancelarse y se reintegra el 100% del dinero abonado por el mismo medio de pago.",
    "Antes de pagar, te recomendamos confirmar por WhatsApp.",
    "Al continuar, confirmás que leíste y aceptás estos términos para productos con demora."
  ].join("\n\n");
}

function matchesStockFilter(product, stockFilterValue) {
  if (!stockFilterValue) return true;
  const fulfillmentMode = getFulfillmentMode(product);
  const stockQty = resolveStockQuantity(product);
  const hasStock = Number.isFinite(stockQty) ? stockQty > 0 : true;

  if (stockFilterValue === "in-stock") return hasStock;
  if (stockFilterValue === "physical") return fulfillmentMode === "physical" && hasStock;
  if (stockFilterValue === "remote") return fulfillmentMode === "remote";
  return true;
}

function getStockStatus(product) {
  const stock = resolveStockQuantity(product);
  if (!Number.isFinite(stock)) return "unknown";
  if (stock <= 0) return "out";
  if (Number.isFinite(Number(product.min_stock)) && stock <= Number(product.min_stock)) {
    return "low";
  }
  return "in";
}

function sanitizePublicProduct(product) {
  if (!product || typeof product !== "object") return null;
  const sanitized = { ...product };
  if (!isWholesale()) {
    delete sanitized.price_mayorista;
    delete sanitized.price_wholesale;
  }
  return sanitized;
}

function resolvePriceContext(product) {
  const retail = Number(
    product.price_minorista ?? product.price ?? product.precio_minorista ?? product.precio_final,
  );
  const wholesale = Number(product.price_mayorista ?? product.price_wholesale ?? product.precio_mayorista);
  const canUseWholesale =
    isWholesale() && Number.isFinite(wholesale) && wholesale >= 0;
  const safeRetail = Number.isFinite(retail) && retail >= 0 ? retail : null;
  const safeWholesale = canUseWholesale ? wholesale : null;
  const active = canUseWholesale ? safeWholesale : safeRetail;
  const discountAmount =
    canUseWholesale && safeRetail > safeWholesale ? safeRetail - safeWholesale : 0;
  const discountPercent =
    discountAmount > 0 && safeRetail > 0
      ? Math.round((discountAmount / safeRetail) * 100)
      : 0;
  return {
    retail: safeRetail,
    wholesale: safeWholesale,
    active,
    canUseWholesale,
    discountAmount,
    discountPercent,
  };
}

function resolveDisplayPrice(product) {
  const context = resolvePriceContext(product);
  if (context.canUseWholesale) {
    return {
      active: context.wholesale,
      retail: context.retail,
      mode: "wholesale",
      discountAmount: context.discountAmount,
      discountPercent: context.discountPercent,
    };
  }
  return {
    active: context.retail,
    retail: null,
    mode: "retail",
    discountAmount: 0,
    discountPercent: 0,
  };
}

function shouldShowWholesaleLockedNotice(product) {
  const wholesale = Number(product?.price_mayorista ?? product?.price_wholesale);
  return isWholesale() && !Number.isFinite(wholesale);
}

function createPriceTierCard(label, value, modifier) {
  const tier = document.createElement("div");
  tier.className = `price-tier ${modifier || ""}`.trim();
  const labelEl = document.createElement("span");
  labelEl.className = "price-tier__label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "price-tier__value";
  valueEl.textContent = Number.isFinite(value) ? formatCurrency(value) : "Consultar";
  tier.append(labelEl, valueEl);
  return tier;
}

function populateSelect(select, values) {
  if (!select) return;
  const current = select.value;
  while (select.options.length > 1) select.remove(1);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  select.value = values.includes(current) ? current : "";
}

function populateFilters(products) {
  const localeCompare = (a, b) => a.localeCompare(b, "es", { sensitivity: "base" });
  const brands = new Map();
  const categories = new Map();
  products.forEach((product) => {
    const brand = getCatalogBrand(product);
    const category = resolveCategoryLabel(product);
    if (brand) brands.set(normalizeKey(brand), brand);
    if (category) categories.set(normalizeKey(category), category);
  });
  populateSelect(brandFilter, Array.from(brands.values()).sort(localeCompare));
  populateSelect(categoryFilter, Array.from(categories.values()).sort(localeCompare));
}

function updateModelOptions(selectedBrand) {
  if (!modelFilter) return;
  const localeCompare = (a, b) => a.localeCompare(b, "es", { sensitivity: "base" });
  const selectedKey = normalizeKey(selectedBrand);
  const models = new Map();
  allProducts.forEach((product) => {
    const brand = getCatalogBrand(product);
    if (selectedBrand && normalizeKey(brand) !== selectedKey) return;
    const model = getCatalogModel(product);
    if (!model) return;
    models.set(normalizeKey(model), model);
  });
  const sorted = Array.from(models.values()).sort(localeCompare);
  populateSelect(modelFilter, sorted);
}

function configurePriceSlider(products) {
  if (!priceRange || !priceRangeValue) return;
  const maxPrice = products.reduce((max, product) => {
    const price = resolveDisplayPrice(product).active;
    return Number.isFinite(price) && price > max ? price : max;
  }, 0);
  const normalizedMax = Math.max(1000, Math.ceil(maxPrice / 500) * 500);
  priceRange.min = "0";
  priceRange.max = String(normalizedMax);
  priceRange.step = String(Math.max(100, Math.round(normalizedMax / 40)));
  priceRange.value = String(normalizedMax);
  priceFilterTouched = false;
  priceRange.dataset.userSet = "false";
  updatePriceRangeDisplay();
}

function updatePriceRangeDisplay() {
  if (!priceRange || !priceRangeValue) return;
  const max = Number(priceRange.max) || 0;
  const value = Number(priceRange.value) || 0;
  if (!priceFilterTouched || value >= max) {
    priceRangeValue.textContent = "Sin tope";
    return;
  }
  priceRangeValue.textContent = formatCurrency(value);
}

function resetAllFilters() {
  if (searchInput) searchInput.value = "";
  if (brandFilter) brandFilter.value = "";
  updateModelOptions("");
  if (modelFilter) modelFilter.value = "";
  if (categoryFilter) categoryFilter.value = "";
  if (stockFilter) stockFilter.value = "";
  if (sortSelect) sortSelect.value = "relevance";
  if (priceRange) {
    priceRange.value = priceRange.max;
    priceFilterTouched = false;
    priceRange.dataset.userSet = "false";
    updatePriceRangeDisplay();
  }
}

function addToCart(product) {
  const fulfillmentMode = getFulfillmentMode(product);
  if (shouldRequireDelayTermsAcceptance(product, fulfillmentMode)) {
    const acceptedTerms = window.confirm(buildDelayTermsMessage(product));
    if (!acceptedTerms) return;
  }
  if (typeof product.stock === "number" && product.stock <= 0 && fulfillmentMode !== "remote") {
    alert("Sin stock disponible");
    return;
  }
  const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
  const existing = cart.find((item) => item.id === product.id);
  const available = typeof product.stock === "number" ? product.stock : Infinity;
  if (existing) {
    if (existing.quantity + 1 > available) {
      alert(`Ya tienes ${existing.quantity} unidades en el carrito. Disponibles: ${available}`);
      return;
    }
    existing.quantity += 1;
  } else {
    const display = resolveDisplayPrice(product);
    const url = buildProductUrl(product);
    const stableIdentifier =
      product.adminIdentifier ||
      product.id ||
      product.sku ||
      product.code ||
      product.publicSlug ||
      product.slug ||
      "";
    cart.push({
      id: product.id,
      identifier: String(stableIdentifier || ""),
      sku: product.sku || "",
      code: product.code || "",
      publicSlug: product.publicSlug || product.public_slug || "",
      slug: product.slug || "",
      url,
      name: product.name,
      price: display.active,
      quantity: 1,
      image: getPrimaryImage(product) || PLACEHOLDER_IMAGE,
    });
  }
  localStorage.setItem("nerinCart", JSON.stringify(cart));
  if (window.updateNav) window.updateNav();
  if (window.showCartIndicator) {
    window.showCartIndicator({
      productId: product.id,
      productName: product.name,
      productSku: product.sku || product.id,
      source: "shop",
    });
  }
}

function buildProductUrl(product) {
  if (typeof product.url === "string" && product.url.trim()) {
    return product.url.trim();
  }
  if (typeof product.publicSlug === "string" && product.publicSlug.trim()) {
    return `/p/${encodeURIComponent(product.publicSlug.trim())}`;
  }
  if (typeof product.slug === "string" && product.slug.trim()) {
    return `/p/${encodeURIComponent(product.slug.trim())}`;
  }
  return `/product.html?id=${encodeURIComponent(String(product.id ?? ""))}`;
}

function createChip(label) {
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.textContent = label;
  return chip;
}

function createProductCard(product) {
  const card = document.createElement("article");
  card.className = "product-card";
  card.setAttribute("role", "listitem");

  const img = document.createElement("img");
  img.src = getPrimaryImage(product) || PLACEHOLDER_IMAGE;
  img.alt = product.name || "Producto";
  card.appendChild(img);

  const meta = document.createElement("div");
  meta.className = "product-meta";
  if (product.sku) {
    const sku = document.createElement("span");
    sku.className = "sku";
    sku.textContent = product.sku;
    meta.appendChild(sku);
  }
  const chips = [getPartLabel(product), product.quality_label, product.display_type]
    .map(cleanLabel)
    .filter(Boolean)
    .slice(0, 3);
  chips.forEach((label) => meta.appendChild(createChip(label)));
  card.appendChild(meta);

  const title = document.createElement("h3");
  title.textContent = product.name || "Producto";
  card.appendChild(title);

  const availability = document.createElement("p");
  availability.className = "description";
  const status = getStockStatus(product);
  const fulfillmentMode = getFulfillmentMode(product);
  if (fulfillmentMode === "remote") {
    availability.textContent =
      status === "out"
        ? "Stock remoto (a pedido)"
        : `Stock remoto: ${resolveStockQuantity(product) || 0} unidades`;
  } else if (status === "out") availability.textContent = "Sin stock";
  else if (status === "low") availability.textContent = `Pocas unidades (${product.stock})`;
  else availability.textContent = `Stock: ${resolveStockQuantity(product) || 0} unidades`;
  card.appendChild(availability);

  if (fulfillmentMode === "remote") {
    const fulfillmentNote = document.createElement("p");
    fulfillmentNote.className = "product-fulfillment-note";
    fulfillmentNote.textContent = "Stock remoto · Entrega sujeta a disponibilidad.";
    card.appendChild(fulfillmentNote);
  }

  const deliveryPromise = document.createElement("p");
  deliveryPromise.className = "product-delivery-promise";
  deliveryPromise.textContent =
    fulfillmentMode === "remote"
      ? `El vendedor necesita ${getDeliveryPromiseCopy(product, fulfillmentMode)} para tener listo este producto.`
      : `Entrega estimada: ${getDeliveryPromiseCopy(product, fulfillmentMode)}`;
  card.appendChild(deliveryPromise);

  if (fulfillmentMode === "remote") {
    const legalBanner = document.createElement("div");
    legalBanner.className = "product-legal-banner";
    legalBanner.innerHTML =
      '<strong>Importante:</strong> Publicación sujeta a disponibilidad del distribuidor oficial. ' +
      'Si no hay stock, la compra puede cancelarse y se reintegra el dinero. ' +
      'Consultá por WhatsApp antes de pagar. Al agregar al carrito aceptás estos términos.';
    card.appendChild(legalBanner);
  }

  const priceBlock = document.createElement("div");
  priceBlock.className = "price-block";
  const display = resolveDisplayPrice(product);
  if (display.mode === "wholesale") {
    priceBlock.classList.add("price-block--wholesale");
  }
  const priceFinal = display.active;
  if (Number.isFinite(priceFinal)) {
    const legalPrice = createPriceLegalBlock({
      priceFinal,
      priceNetNoNationalTaxes: calculateNetNoNationalTaxes(priceFinal),
      compact: true,
    });
    priceBlock.appendChild(legalPrice);
  } else {
    const consult = document.createElement("p");
    consult.className = "price-comparison-locked";
    consult.textContent = "Precio a consultar";
    priceBlock.appendChild(consult);
  }
  if (display.mode === "wholesale" && Number.isFinite(display.retail)) {
    const comparison = document.createElement("div");
    comparison.className = "price-comparison-grid";
    comparison.append(
      createPriceTierCard("Precio minorista", display.retail, "price-tier--retail"),
      createPriceTierCard(
        "Tu precio mayorista",
        display.active,
        "price-tier--wholesale",
      ),
    );
    const summary = document.createElement("p");
    summary.className = "price-comparison-summary";
    summary.textContent = `Ahorro mayorista: ${display.discountPercent}% (${formatCurrency(display.discountAmount)}).`;
    priceBlock.append(comparison, summary);
  } else if (shouldShowWholesaleLockedNotice(product)) {
    const locked = document.createElement("p");
    locked.className = "price-comparison-locked";
    locked.textContent =
      "Cuenta mayorista detectada, pero sin autorización activa para ver precio mayorista en este momento.";
    priceBlock.appendChild(locked);
  }
  card.appendChild(priceBlock);


  const actions = document.createElement("div");
  actions.className = "product-actions";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "button";
  addBtn.textContent = "Agregar";
  addBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    addToCart(product);
  });

  const detailBtn = document.createElement("button");
  detailBtn.type = "button";
  detailBtn.className = "button secondary info-btn";
  detailBtn.textContent = "Ver detalle";
  detailBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    window.location.href = buildProductUrl(product);
  });

  actions.append(addBtn, detailBtn);
  card.appendChild(actions);

  card.addEventListener("click", () => {
    window.location.href = buildProductUrl(product);
  });

  return card;
}

function updateResultSummary({ displayedCount = 0, totalCount = 0, hasKnownTotal = false } = {}) {
  if (!resultCountEl) return;
  const parent = resultCountEl.parentElement;
  if (!parent) {
    resultCountEl.textContent = String(hasKnownTotal ? totalCount : displayedCount);
    return;
  }
  if (hasKnownTotal) {
    resultCountEl.textContent = `${displayedCount} de ${totalCount}`;
    parent.textContent = "";
    parent.appendChild(resultCountEl);
    parent.append(" productos.");
    return;
  }
  resultCountEl.textContent = String(displayedCount);
  parent.textContent = "";
  parent.append("Mostrando ");
  parent.appendChild(resultCountEl);
  parent.append(" productos.");
}

function syncQueryParams(filters) {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.brand) params.set("brand", filters.brand);
  if (filters.model) params.set("model", filters.model);
  if (filters.category) params.set("category", filters.category);
  if (filters.stock) params.set("stock", filters.stock);
  if (filters.priceActive && filters.price) params.set("price_max", String(filters.price));
  if (filters.sort && filters.sort !== "relevance") params.set("sort", filters.sort);
  const query = params.toString();
  history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function updateActiveFilters(filters) {
  if (!activeFiltersContainer) return;
  activeFiltersContainer.innerHTML = "";
  const descriptors = [
    ["Búsqueda", filters.search],
    ["Marca", filters.brand],
    ["Modelo", filters.model],
    ["Tipo", filters.category],
    ["Stock",
      filters.stock === "in-stock"
        ? "Solo con stock"
        : filters.stock === "physical"
          ? "Stock físico"
          : filters.stock === "remote"
            ? "Stock remoto"
            : ""],
    ["Precio ≤", filters.priceActive ? formatCurrency(filters.price) : ""],
  ];
  descriptors.filter(([, value]) => value).forEach(([label, value]) => {
    const chip = document.createElement("span");
    chip.className = "filter-chip";
    chip.textContent = `${label}: ${value}`;
    activeFiltersContainer.appendChild(chip);
  });
}

function getCurrentFilters() {
  const search = searchInput?.value?.trim() || "";
  const brand = brandFilter?.value || "";
  const model = modelFilter?.value || "";
  const category = categoryFilter?.value || "";
  const stock = stockFilter?.value || "";
  const sort = sortSelect?.value || "relevance";
  const price = Number(priceRange?.value) || 0;
  const priceMax = Number(priceRange?.max) || 0;
  const priceActive = priceFilterTouched && priceMax > 0 && price < priceMax;
  return { search, brand, model, category, stock, sort, price, priceActive };
}

function mapSortForBackend(sortValue) {
  const sortMap = {
    price_asc: "price_asc",
    price_desc: "price_desc",
    name_asc: "name_asc",
    name_desc: "name_desc",
    stock_desc: "stock_desc",
    stock_asc: "stock_asc",
    "price-asc": "price_asc",
    "price-desc": "price_desc",
    "stock-desc": "stock_desc",
    "stock-asc": "stock_asc",
    name: "name_asc",
  };
  return sortMap[String(sortValue || "").trim()] || "";
}

function scrollToCatalogTop() {
  const anchor = document.getElementById("catalogo") || productGrid;
  if (!anchor || typeof anchor.scrollIntoView !== "function") return;
  anchor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function createPaginationButton({ label, page = null, disabled = false, active = false, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "products-pagination__btn";
  if (active) button.classList.add("is-active");
  if (disabled) {
    button.disabled = true;
    button.classList.add("is-disabled");
  }
  button.textContent = label;
  if (page !== null) button.dataset.page = String(page);
  if (typeof onClick === "function" && !disabled) {
    button.addEventListener("click", onClick);
  }
  return button;
}

function renderPublicProductsPagination() {
  if (!publicProductsPagination) return;
  publicProductsPagination.innerHTML = "";

  const knownTotalPages = Number(publicProductsTotalPages);
  const hasKnownTotalPages = Number.isFinite(knownTotalPages) && knownTotalPages > 0;
  const canGoPrev = currentProductsPage > 1;
  const canGoNext =
    hasKnownTotalPages ? currentProductsPage < knownTotalPages : Boolean(publicProductsHasNextPage);

  const prevBtn = createPaginationButton({
    label: "Anterior",
    disabled: !canGoPrev,
    onClick: () => {
      console.info("[shop-products] prev clicked", { currentProductsPage });
      if (currentProductsPage <= 1) return;
      currentProductsPage -= 1;
      safelyRenderProducts({ page: currentProductsPage, scrollToTop: true });
    },
  });
  publicProductsPagination.appendChild(prevBtn);

  let startPage = 1;
  let endPage = 1;
  if (hasKnownTotalPages) {
    const windowSize = 5;
    const half = Math.floor(windowSize / 2);
    startPage = Math.max(1, currentProductsPage - half);
    endPage = Math.min(knownTotalPages, startPage + windowSize - 1);
    startPage = Math.max(1, endPage - windowSize + 1);
  } else {
    startPage = Math.max(1, currentProductsPage - 2);
    endPage = currentProductsPage + 2;
    if (!publicProductsHasNextPage) {
      endPage = Math.min(endPage, currentProductsPage);
    }
  }

  for (let page = startPage; page <= endPage; page += 1) {
    const isActive = page === currentProductsPage;
    publicProductsPagination.appendChild(
      createPaginationButton({
        label: String(page),
        page,
        active: isActive,
        disabled: isActive,
        onClick: () => {
          console.info("[shop-products] page clicked", { page });
          currentProductsPage = page;
          safelyRenderProducts({ page, scrollToTop: true });
        },
      }),
    );
  }

  const nextBtn = createPaginationButton({
    label: "Siguiente",
    disabled: !canGoNext,
    onClick: () => {
      console.info("[shop-products] next clicked", {
        currentProductsPage,
        hasNextPage: publicProductsHasNextPage,
      });
      if (!publicProductsHasNextPage && !hasKnownTotalPages) return;
      if (hasKnownTotalPages && currentProductsPage >= knownTotalPages) return;
      currentProductsPage += 1;
      safelyRenderProducts({ page: currentProductsPage, scrollToTop: true });
    },
  });
  publicProductsPagination.appendChild(nextBtn);
}

async function renderProducts({ page = currentProductsPage, scrollToTop = false } = {}) {
  if (!productGrid) return;
  const filters = getCurrentFilters();
  const requestId = ++latestRequestId;
  const normalizedPage = Math.max(1, Number(page) || 1);
  currentProductsPage = normalizedPage;
  productGrid.innerHTML = "<p>Cargando productos…</p>";

  const requestParams = {
    page: currentProductsPage,
    pageSize: productsPageSize,
    search: filters.search,
    category: filters.category,
    brand: filters.brand,
    model: filters.model,
    stock: filters.stock,
    price_max: filters.priceActive ? filters.price : "",
    sort: mapSortForBackend(filters.sort),
  };
  console.info("[shop-products] load", {
    page: currentProductsPage,
    pageSize: productsPageSize,
    search: filters.search,
    sort: requestParams.sort || "",
  });
  shopLog("loadProducts:start", { requestId, requestParams });
  if (productsAbortController) {
    productsAbortController.abort();
  }
  productsAbortController = new AbortController();
  let response;
  try {
    response = await fetchProductsPage(requestParams, {
      signal: productsAbortController.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      shopLog("request:aborted", { requestId });
      console.info("[shop-products] request aborted");
      return;
    }
    throw error;
  }

  shopLog("response", {
    requestId,
    status: "ok",
    totalItems: response?.totalItems,
    items: Array.isArray(response?.items) ? response.items.length : 0,
    usingFallback: Boolean(response?.usingFallback),
    source: response?.source || "unknown",
  });
  if (requestId !== latestRequestId) {
    shopLog("response:ignored-stale", { requestId, latestRequestId });
    return;
  }
  if (response?.usingFallback && isProductionStorefront()) {
    publicProductsHasNextPage = false;
    publicProductsHasPrevPage = currentProductsPage > 1;
    publicProductsTotalItems = null;
    publicProductsTotalPages = null;
    renderPublicProductsPagination();
    updateResultSummary({ displayedCount: 0, totalCount: 0, hasKnownTotal: false });
    productGrid.innerHTML =
      "<p>Error: catálogo no disponible temporalmente. Intentá nuevamente en unos minutos.</p>";
    throw new Error("Respuesta con usingFallback=true bloqueada en producción");
  }
  if (!response?.usingFallback) {
    hasRealCatalogResponse = true;
  } else if (hasRealCatalogResponse) {
    shopLog("response:ignored-fallback-after-real", { requestId });
    return;
  }
  if (response?.source !== "sqlite") {
    console.warn("[shop-products] backend did not use sqlite", response?.source);
  }

  const normalizedItems = (response.items || [])
    .map(normalizeStorefrontProduct)
    .map(sanitizePublicProduct)
    .filter(Boolean);
  const filteredItems = normalizedItems.filter((product) => matchesStockFilter(product, filters.stock));

  if (!filtersInitialized) {
    populateFilters(normalizedItems);
    updateModelOptions(brandFilter?.value || "");
    configurePriceSlider(normalizedItems);
    applyInitialFilters();
    filtersInitialized = true;
  }

  allProducts = filteredItems;
  currentProductsPage = Number(response.page || currentProductsPage || 1);
  publicProductsHasNextPage = Boolean(response.hasNextPage);
  publicProductsHasPrevPage = Boolean(response.hasPrevPage || currentProductsPage > 1);
  publicProductsTotalItems =
    response.totalItems !== null && response.totalItems !== undefined && Number.isFinite(Number(response.totalItems))
      ? Number(response.totalItems)
      : null;
  publicProductsTotalPages =
    response.totalPages !== null && response.totalPages !== undefined && Number.isFinite(Number(response.totalPages))
      ? Number(response.totalPages)
      : null;

  totalFilteredItems = publicProductsTotalItems ?? allProducts.length;
  if (filters.stock) {
    totalFilteredItems = allProducts.length;
    publicProductsTotalItems = null;
    publicProductsTotalPages = null;
    publicProductsHasNextPage = false;
    publicProductsHasPrevPage = currentProductsPage > 1;
  }
  productGrid.innerHTML = "";
  console.info("[shop-products] render start");
  if (!allProducts.length) {
    productGrid.innerHTML = "<p>No encontramos productos para esos filtros.</p>";
  } else {
    allProducts.forEach((product) => productGrid.appendChild(createProductCard(product)));
  }
  console.info("[shop-products] render done");
  renderPublicProductsPagination();
  shopLog("renderProducts", {
    requestId,
    count: allProducts.length,
    totalFilteredItems,
    source: response?.source || "api/products",
    page: currentProductsPage,
    hasNextPage: publicProductsHasNextPage,
    hasPrevPage: publicProductsHasPrevPage,
  });

  updateResultSummary({
    displayedCount: allProducts.length,
    totalCount: totalFilteredItems,
    hasKnownTotal: publicProductsTotalItems !== null,
  });
  console.info("[shop-products] loaded", {
    page: currentProductsPage,
    items: allProducts.length,
    totalItems: publicProductsTotalItems,
    totalPages: publicProductsTotalPages,
    source: response?.source || null,
  });
  updateActiveFilters(filters);
  syncQueryParams(filters);
  if (scrollToTop) scrollToCatalogTop();
}

function safelyRenderProducts(options) {
  void renderProducts(options).catch((error) => {
    if (error?.name === "AbortError") return;
    console.error("[shop] renderProducts failed", error);
    if (productGrid) {
      productGrid.innerHTML = `<p>Error al cargar productos: ${error.message || "Error desconocido"}</p>`;
    }
  });
}

function applyInitialFilters() {
  const params = new URLSearchParams(window.location.search);
  if (searchInput && params.get("q")) searchInput.value = params.get("q");
  if (brandFilter && params.get("brand")) brandFilter.value = params.get("brand");
  updateModelOptions(brandFilter?.value || "");
  if (modelFilter && params.get("model")) modelFilter.value = params.get("model");
  if (categoryFilter && params.get("category")) categoryFilter.value = params.get("category");
  if (stockFilter) {
    const stockParam = params.get("stock");
    if (["in-stock", "physical", "remote"].includes(stockParam)) {
      stockFilter.value = stockParam;
    }
  }
  if (sortSelect && params.get("sort")) sortSelect.value = params.get("sort");
  if (priceRange && params.get("price_max")) {
    const value = Number(params.get("price_max"));
    if (Number.isFinite(value)) {
      priceRange.value = String(Math.min(value, Number(priceRange.max)));
      priceFilterTouched = true;
      priceRange.dataset.userSet = "true";
      updatePriceRangeDisplay();
    }
  }
}

function setupFiltersUi() {
  if (!filtersToggle || !shopFilters) return;
  const closeDrawer = () => {
    shopFilters.dataset.open = "false";
    if (filtersBackdrop) filtersBackdrop.hidden = true;
  };

  filtersToggle.addEventListener("click", () => {
    if (mobileLayoutQuery.matches) {
      const opening = shopFilters.dataset.open !== "true";
      shopFilters.dataset.open = opening ? "true" : "false";
      if (filtersBackdrop) filtersBackdrop.hidden = !opening;
      return;
    }
    shopFilters.dataset.collapsed = shopFilters.dataset.collapsed === "true" ? "false" : "true";
  });

  if (filtersBackdrop) filtersBackdrop.addEventListener("click", closeDrawer);
  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener("click", () => {
      currentProductsPage = 1;
      safelyRenderProducts({ page: 1 });
      closeDrawer();
    });
  }
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", () => {
      resetAllFilters();
      currentProductsPage = 1;
      safelyRenderProducts({ page: 1 });
      closeDrawer();
    });
  }
}

async function initShop() {
  try {
    shopLog("initShop:start");
    await disableCatalogClientCaches();
    setupFiltersUi();
    applyInitialFilters();
    if (sortSelect?.parentElement && !document.getElementById("shopPageSize")) {
      sortSelect.parentElement.appendChild(pageSizeSelect);
    }

    searchInput?.addEventListener("input", () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = window.setTimeout(() => {
        currentProductsPage = 1;
        safelyRenderProducts({ page: 1 });
      }, SEARCH_DEBOUNCE_MS);
    });
    searchClear?.addEventListener("click", () => {
      searchInput.value = "";
      currentProductsPage = 1;
      safelyRenderProducts({ page: 1 });
    });
    brandFilter?.addEventListener("change", () => {
      updateModelOptions(brandFilter.value);
      currentProductsPage = 1;
      safelyRenderProducts({ page: 1 });
    });
    modelFilter?.addEventListener("change", () => {
      currentProductsPage = 1;
      safelyRenderProducts({ page: 1 });
    });
    categoryFilter?.addEventListener("change", () => {
      currentProductsPage = 1;
      safelyRenderProducts({ page: 1 });
    });
    stockFilter?.addEventListener("change", () => {
      currentProductsPage = 1;
      safelyRenderProducts({ page: 1 });
    });
    sortSelect?.addEventListener("change", () => {
      currentProductsPage = 1;
      safelyRenderProducts({ page: 1 });
    });
    pageSizeSelect?.addEventListener("change", () => {
      productsPageSize = Number(pageSizeSelect.value) || 24;
      currentProductsPage = 1;
      safelyRenderProducts({ page: 1 });
    });
    priceRange?.addEventListener("input", () => {
      priceFilterTouched = true;
      updatePriceRangeDisplay();
      if (!mobileLayoutQuery.matches) {
        clearTimeout(priceDebounceTimer);
        priceDebounceTimer = window.setTimeout(() => {
          currentProductsPage = 1;
          safelyRenderProducts({ page: 1 });
        }, FILTER_DEBOUNCE_MS);
      }
    });

    safelyRenderProducts({ page: 1 });
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }
    console.error(error);
    if (productGrid) {
      productGrid.innerHTML = `<p>Error al cargar productos: ${error.message}</p>`;
    }
  }
}

document.addEventListener("DOMContentLoaded", initShop);

// preserve role access in case other scripts depend on it
window.addEventListener("storage", (event) => {
  if (event.key === "nerinUserRole") {
    getUserRole();
  }
});
