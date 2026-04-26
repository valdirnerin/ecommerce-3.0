import { fetchProductsPage, getUserRole, isWholesale } from "./api.js";
import { createPriceLegalBlock } from "./components/PriceLegalBlock.js";
import { calculateNetNoNationalTaxes } from "./utils/pricing.js";

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
let currentPage = 1;
let currentPageSize = 24;
let totalFilteredItems = 0;
let hasNextPage = false;
let hasRealCatalogResponse = false;
let latestRequestId = 0;
let filtersInitialized = false;

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
const loadMoreBtn = document.createElement("button");
loadMoreBtn.type = "button";
loadMoreBtn.className = "button secondary";
loadMoreBtn.id = "shopLoadMoreBtn";
loadMoreBtn.textContent = "Cargar más";
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
  return "Entrega estimada: 4 a 10 días (incluye preparación del proveedor).";
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
  const retail = Number(product.price_minorista);
  const wholesale = Number(product.price_mayorista ?? product.price_wholesale);
  const canUseWholesale =
    isWholesale() && Number.isFinite(wholesale) && wholesale >= 0;
  const safeRetail = Number.isFinite(retail) && retail >= 0 ? retail : 0;
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
  valueEl.textContent = formatCurrency(value);
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
  if (typeof product.stock === "number" && product.stock <= 0) {
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
    cart.push({
      id: product.id,
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
  if (status === "out") availability.textContent = "Sin stock";
  else if (status === "low") availability.textContent = `Pocas unidades (${product.stock})`;
  else availability.textContent = `Stock: ${resolveStockQuantity(product) || 0} unidades`;
  card.appendChild(availability);

  if (fulfillmentMode === "remote") {
    const fulfillmentNote = document.createElement("p");
    fulfillmentNote.className = "product-fulfillment-note";
    fulfillmentNote.textContent = `Stock remoto • ${getRemoteLeadTimeCopy(product)} Sujeto a disponibilidad. Puede cancelarse con reembolso total.`;
    card.appendChild(fulfillmentNote);
  }

  const priceBlock = document.createElement("div");
  priceBlock.className = "price-block";
  const display = resolveDisplayPrice(product);
  if (display.mode === "wholesale") {
    priceBlock.classList.add("price-block--wholesale");
  }
  const priceFinal = display.active;
  const legalPrice = createPriceLegalBlock({
    priceFinal,
    priceNetNoNationalTaxes: calculateNetNoNationalTaxes(priceFinal),
    compact: true,
  });
  priceBlock.appendChild(legalPrice);
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

function computeRelevance(product, searchTerm) {
  if (!searchTerm) return 0;
  const term = searchTerm.toLowerCase();
  const fields = [
    product.name,
    product.sku,
    getCatalogBrand(product),
    getCatalogModel(product),
    getPartLabel(product),
  ];
  return fields.reduce((score, field) => {
    if (typeof field !== "string") return score;
    const normalized = field.toLowerCase();
    if (normalized === term) return score + 8;
    if (normalized.startsWith(term)) return score + 4;
    if (normalized.includes(term)) return score + 2;
    return score;
  }, 0);
}

function sortProducts(products, sortMode, searchTerm) {
  const copy = [...products];
  const getPrice = (product) => resolveDisplayPrice(product).active;
  const getStock = (product) => Number(product.stock) || 0;
  switch (sortMode) {
    case "price-asc":
      return copy.sort((a, b) => getPrice(a) - getPrice(b));
    case "price-desc":
      return copy.sort((a, b) => getPrice(b) - getPrice(a));
    case "stock-desc":
      return copy.sort((a, b) => getStock(b) - getStock(a));
    default:
      return copy.sort((a, b) => computeRelevance(b, searchTerm) - computeRelevance(a, searchTerm));
  }
}

function updateResultSummary(count) {
  if (resultCountEl) resultCountEl.textContent = String(count);
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

async function renderProducts({ append = false } = {}) {
  if (!productGrid) return;
  const filters = getCurrentFilters();
  const requestId = ++latestRequestId;
  if (!append) {
    currentPage = 1;
    allProducts = [];
    productGrid.innerHTML = "<p>Cargando productos…</p>";
  }
  const requestedPage = append ? currentPage + 1 : 1;
  const requestParams = {
    page: requestedPage,
    pageSize: currentPageSize,
    search: filters.search,
    category: filters.category,
    brand: filters.brand,
    model: filters.model,
    stock: filters.stock,
    price_max: filters.priceActive ? filters.price : "",
    sort: filters.sort,
  };
  shopLog("loadProducts:start", { append, requestId, requestParams });
  const response = await fetchProductsPage(requestParams);
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
    hasNextPage = false;
    loadMoreBtn.style.display = "none";
    updateResultSummary(0);
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
  const normalizedItems = (response.items || [])
    .map(normalizeStorefrontProduct)
    .map(sanitizePublicProduct)
    .filter(Boolean);

  if (!filtersInitialized && !append) {
    populateFilters(normalizedItems);
    updateModelOptions(brandFilter?.value || "");
    configurePriceSlider(normalizedItems);
    applyInitialFilters();
    filtersInitialized = true;
  }

  allProducts = append ? allProducts.concat(normalizedItems) : normalizedItems;
  currentPage = Number(response.page || requestedPage || 1);
  hasNextPage = Boolean(response.hasNextPage);
  totalFilteredItems = Number(response.totalItems || allProducts.length);
  productGrid.innerHTML = "";
  if (!allProducts.length) {
    productGrid.innerHTML = "<p>No encontramos productos para esos filtros.</p>";
  } else {
    allProducts.forEach((product) => productGrid.appendChild(createProductCard(product)));
  }
  shopLog("renderProducts", {
    requestId,
    count: allProducts.length,
    totalFilteredItems,
    source: response?.source || "api/products",
  });
  loadMoreBtn.style.display = hasNextPage ? "inline-flex" : "none";
  if (!loadMoreBtn.parentElement && productGrid.parentElement) {
    productGrid.parentElement.appendChild(loadMoreBtn);
  }
  updateResultSummary(totalFilteredItems);
  updateActiveFilters(filters);
  syncQueryParams(filters);
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
      renderProducts();
      closeDrawer();
    });
  }
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", () => {
      resetAllFilters();
      renderProducts();
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

    searchInput?.addEventListener("input", () => renderProducts());
    searchClear?.addEventListener("click", () => {
      searchInput.value = "";
      renderProducts();
    });
    brandFilter?.addEventListener("change", () => {
      updateModelOptions(brandFilter.value);
      renderProducts();
    });
    modelFilter?.addEventListener("change", () => renderProducts());
    categoryFilter?.addEventListener("change", () => renderProducts());
    stockFilter?.addEventListener("change", () => renderProducts());
    sortSelect?.addEventListener("change", () => renderProducts());
    pageSizeSelect?.addEventListener("change", () => {
      currentPageSize = Number(pageSizeSelect.value) || 24;
      renderProducts();
    });
    loadMoreBtn.addEventListener("click", () => renderProducts({ append: true }));
    priceRange?.addEventListener("input", () => {
      priceFilterTouched = true;
      updatePriceRangeDisplay();
      if (!mobileLayoutQuery.matches) renderProducts();
    });

    await renderProducts();
  } catch (error) {
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
