import { fetchProducts, getUserRole } from "./api.js";
import { createPriceLegalBlock } from "./components/PriceLegalBlock.js";
import { calculateNetNoNationalTaxes } from "./utils/pricing.js";

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

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

function getStockStatus(product) {
  const stock = Number(product.stock);
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
  delete sanitized.price_mayorista;
  delete sanitized.price_wholesale;
  return sanitized;
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
    const category = cleanLabel(product.category);
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
    const price = Number(product.price_minorista);
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
    cart.push({
      id: product.id,
      name: product.name,
      price: Number(product.price_minorista) || 0,
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
  if (status === "out") availability.textContent = "Sin stock";
  else if (status === "low") availability.textContent = `Pocas unidades (${product.stock})`;
  else availability.textContent = `Stock: ${Number(product.stock) || 0} unidades`;
  card.appendChild(availability);

  const priceBlock = document.createElement("div");
  priceBlock.className = "price-block";
  const priceFinal = Number(product.price_minorista) || 0;
  const legalPrice = createPriceLegalBlock({
    priceFinal,
    priceNetNoNationalTaxes: calculateNetNoNationalTaxes(priceFinal),
    compact: true,
  });
  priceBlock.appendChild(legalPrice);
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
  const getPrice = (product) => Number(product.price_minorista) || 0;
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
    ["Stock", filters.stock === "in-stock" ? "Solo con stock" : ""],
    ["Precio ≤", filters.priceActive ? formatCurrency(filters.price) : ""],
  ];
  descriptors.filter(([, value]) => value).forEach(([label, value]) => {
    const chip = document.createElement("span");
    chip.className = "filter-chip";
    chip.textContent = `${label}: ${value}`;
    activeFiltersContainer.appendChild(chip);
  });
}

function renderProducts() {
  if (!productGrid) return;
  const search = searchInput?.value?.trim() || "";
  const brand = brandFilter?.value || "";
  const model = modelFilter?.value || "";
  const category = categoryFilter?.value || "";
  const stock = stockFilter?.value || "";
  const sort = sortSelect?.value || "relevance";
  const price = Number(priceRange?.value) || 0;
  const priceMax = Number(priceRange?.max) || 0;
  const priceActive = priceFilterTouched && priceMax > 0 && price < priceMax;

  const filtered = allProducts.filter((product) => {
    const haystack = [
      product.name,
      product.sku,
      getCatalogBrand(product),
      getCatalogModel(product),
      cleanLabel(product.category),
      getPartLabel(product),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (brand && normalizeKey(getCatalogBrand(product)) !== normalizeKey(brand)) return false;
    if (model && normalizeKey(getCatalogModel(product)) !== normalizeKey(model)) return false;
    if (category && normalizeKey(product.category) !== normalizeKey(category)) return false;
    const status = getStockStatus(product);
    if (stock === "in-stock" && status !== "in" && status !== "low") return false;
    if (priceActive && (Number(product.price_minorista) || 0) > price) return false;
    return true;
  });

  const sorted = sortProducts(filtered, sort, search);
  productGrid.innerHTML = "";
  if (!sorted.length) {
    productGrid.innerHTML = "<p>No encontramos productos para esos filtros.</p>";
  } else {
    sorted.forEach((product) => productGrid.appendChild(createProductCard(product)));
  }

  const filters = { search, brand, model, category, stock, sort, price, priceActive };
  updateResultSummary(sorted.length);
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
  if (stockFilter && params.get("stock") === "in-stock") stockFilter.value = "in-stock";
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
    const rawProducts = await fetchProducts();
    allProducts = rawProducts.map(sanitizePublicProduct).filter(Boolean);
    populateFilters(allProducts);
    updateModelOptions("");
    configurePriceSlider(allProducts);
    applyInitialFilters();
    setupFiltersUi();

    searchInput?.addEventListener("input", renderProducts);
    searchClear?.addEventListener("click", () => {
      searchInput.value = "";
      renderProducts();
    });
    brandFilter?.addEventListener("change", () => {
      updateModelOptions(brandFilter.value);
      renderProducts();
    });
    modelFilter?.addEventListener("change", renderProducts);
    categoryFilter?.addEventListener("change", renderProducts);
    stockFilter?.addEventListener("change", renderProducts);
    sortSelect?.addEventListener("change", renderProducts);
    priceRange?.addEventListener("input", () => {
      priceFilterTouched = true;
      updatePriceRangeDisplay();
      if (!mobileLayoutQuery.matches) renderProducts();
    });

    renderProducts();
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
