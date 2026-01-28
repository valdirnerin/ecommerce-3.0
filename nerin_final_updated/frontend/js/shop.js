import { fetchProducts, isWholesale, getUserRole } from "./api.js";

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function formatCurrency(value) {
  const amount = Number(value);
  if (Number.isNaN(amount)) return "$0";
  return currencyFormatter.format(amount);
}

function cleanLabel(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  const cleaned = cleanLabel(value);
  if (!cleaned) return "";
  const normalized =
    typeof cleaned.normalize === "function" ? cleaned.normalize("NFD") : cleaned;
  return normalized
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getCatalogBrand(product) {
  if (!product) return "";
  const manual = cleanLabel(product.catalog_brand);
  if (manual) return manual;
  const brand = cleanLabel(product.brand);
  if (brand) return brand;
  if (typeof product.manufacturer === "string") {
    const manufacturer = cleanLabel(product.manufacturer);
    if (manufacturer) return manufacturer;
  }
  return "";
}

function getCatalogModel(product) {
  if (!product) return "";
  const manual = cleanLabel(product.catalog_model);
  if (manual) return manual;
  const model = cleanLabel(product.model);
  if (model) return model;
  const subcategory = cleanLabel(product.subcategory);
  if (subcategory) return subcategory;
  return "";
}

function getPublicBaseUrl() {
  const cfg = window.NERIN_CONFIG;
  if (cfg && typeof cfg.publicUrl === "string") {
    const raw = cfg.publicUrl.trim();
    if (raw) {
      try {
        const normalized = new URL(raw).toString();
        return normalized.replace(/\/+$/, "");
      } catch (err) {
        console.warn("URL pública inválida en configuración", err);
      }
    }
  }
  if (typeof window !== "undefined" && window.location) {
    return window.location.origin;
  }
  return "";
}

function resolveAbsoluteUrl(value, baseUrl) {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const base = baseUrl || getPublicBaseUrl();
  try {
    return new URL(value, base || window.location.href).toString();
  } catch (err) {
    return value;
  }
}

function updateShopBreadcrumbs(trail) {
  const script = document.getElementById("shop-breadcrumbs");
  if (!script) return;
  const baseUrl = getPublicBaseUrl();
  const segments = Array.isArray(trail)
    ? trail.filter((value) => typeof value === "string" && value.trim())
    : typeof trail === "string"
    ? [trail].filter((value) => value.trim())
    : [];
  const elements = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Inicio",
      item: resolveAbsoluteUrl("/", baseUrl),
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Productos",
      item: resolveAbsoluteUrl("/shop.html", baseUrl),
    },
  ];
  segments.forEach((label, index) => {
    elements.push({
      "@type": "ListItem",
      position: elements.length + 1,
      name: label,
      item: index === segments.length - 1 ? window.location.href : undefined,
    });
  });
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: elements,
  };
  const json = JSON.stringify(breadcrumbs, null, 2);
  script.textContent = json;
  script.dataset.seoJsonldTemplate = json;
}

function updateCollectionSchema(tree) {
  const script = document.getElementById("shop-schema");
  if (!script) return;
  const baseUrl = getPublicBaseUrl();
  const hasPart = [];
  Object.values(tree).forEach((brandData) => {
    const brandLabel = brandData.label || "Otros";
    Object.values(brandData.models).forEach((modelData) => {
      const modelLabel = modelData.label || "Genérico";
      const partCatalog = Object.values(modelData.parts).map(
        ({ label: partName, count }) => ({
          "@type": "OfferCatalog",
          name: `${partName} para ${modelLabel}`,
          numberOfItems: count,
        }),
      );
      hasPart.push({
        "@type": "ProductCollection",
        name: `${brandLabel} ${modelLabel}`,
        numberOfItems: modelData.count,
        url: `${resolveAbsoluteUrl("/shop.html", baseUrl)}?brand=${encodeURIComponent(
          brandLabel,
        )}&model=${encodeURIComponent(modelLabel)}`,
        hasOfferCatalog: partCatalog,
      });
    });
  });
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Catálogo profesional de repuestos NERIN",
    description:
      "Catálogo actualizado de repuestos para celulares clasificados por marca, modelo y tipo de pieza.",
    url: resolveAbsoluteUrl("/shop.html", baseUrl),
  };
  if (hasPart.length) {
    schema.hasPart = hasPart;
  }
  const json = JSON.stringify(schema, null, 2);
  script.textContent = json;
  script.dataset.seoJsonldTemplate = json;
}

function buildProductUrl(product) {
  if (product && typeof product.slug === "string") {
    const slug = product.slug.trim();
    if (slug) return `/p/${encodeURIComponent(slug)}`;
  }
  const id = product?.id != null ? String(product.id) : "";
  return `/product.html?id=${encodeURIComponent(id)}`;
}

function getPrimaryImage(product) {
  if (Array.isArray(product.images) && product.images.length) {
    return product.images[0];
  }
  return product.image;
}

function getProductDescription(product) {
  if (!product) return "";
  const candidates = [
    product.description,
    product.meta_description,
    product.short_description,
  ];
  for (const value of candidates) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return "";
}

function createDescriptionPreview(description, maxLength = 200) {
  if (typeof description !== "string") return "";
  const normalized = description.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  const slice = normalized.slice(0, maxLength);
  const cutoff = slice.lastIndexOf(" ");
  const safeText = cutoff > maxLength * 0.6 ? slice.slice(0, cutoff) : slice;
  return `${safeText.trim()}…`;
}

function getPartKey(product) {
  if (!product) return "";
  if (typeof product.catalog_piece === "string") {
    const manual = cleanLabel(product.catalog_piece);
    if (manual) return manual;
  }
  const candidates = [
    product.part,
    product.component,
    product.subcategory,
    product.part_type,
    product.category,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = cleanLabel(candidate);
      if (trimmed) return trimmed;
    }
  }
  if (Array.isArray(product.tags)) {
    for (const tag of product.tags) {
      if (typeof tag === "string" && tag.includes(":")) {
        const [, value] = tag
          .split(":")
          .map((token) => cleanLabel(token));
        if (value) return value;
      }
    }
    const fallback = product.tags.find(
      (tag) => typeof tag === "string" && cleanLabel(tag),
    );
    if (fallback) return cleanLabel(fallback);
  }
  return "";
}

function getStockStatus(product) {
  if (!product || typeof product.stock !== "number") return "unknown";
  if (product.stock <= 0) return "out";
  if (typeof product.min_stock === "number" && product.stock <= product.min_stock) {
    return "low";
  }
  return "in";
}

function createAvailabilityBadge(label, status) {
  const badge = document.createElement("span");
  badge.className = "availability-badge";
  if (status) {
    badge.dataset.status = status;
  }
  badge.textContent = label;
  return badge;
}

const PLACEHOLDER_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const productGrid = document.getElementById("productGrid");
const searchInput = document.getElementById("searchInput");
const searchClear = document.getElementById("searchClear");
const brandFilter = document.getElementById("brandFilter");
const modelFilter = document.getElementById("modelFilter");
const categoryFilter = document.getElementById("categoryFilter");
const partFilter = document.getElementById("partFilter");
const stockFilter = document.getElementById("stockFilter");
const priceRange = document.getElementById("priceRange");
const priceRangeValue = document.getElementById("priceRangeValue");
let priceFilterTouched = false;
const sortSelect = document.getElementById("sortSelect");
const activeFiltersContainer = document.getElementById("activeFilters");
const resultCountEl = document.getElementById("resultCount");
const modelExplorerContainer = document.getElementById("modelExplorer");
const roleHighlight = document.querySelector("[data-role-highlight]");
const heroDetails = document.querySelector("[data-hero-details]");
const heroToggle = document.querySelector("[data-hero-toggle]");
const roleCollapsible = document.querySelector("[data-role-collapsible]");
const roleToggleButton = document.querySelector("[data-role-toggle]");
const mobileLayoutQuery = window.matchMedia
  ? window.matchMedia("(max-width: 900px)")
  : null;

function resolveRoleState() {
  const role = getUserRole();
  if (!role) return "guest";
  if (role === "mayorista" || role === "admin" || role === "vip") {
    return "wholesale";
  }
  return "retail";
}

function applyRoleState() {
  const state = resolveRoleState();
  if (document.body) {
    document.body.dataset.roleState = state;
  }
  if (roleHighlight) {
    roleHighlight.dataset.roleState = state;
    const targetVariant = state === "wholesale" ? "wholesale" : "retail";
    const cards = roleHighlight.querySelectorAll(".role-card");
    cards.forEach((card) => {
      card.dataset.active = card.dataset.roleVariant === targetVariant ? "true" : "false";
    });
  }
}

applyRoleState();

function updateToggleLabel(toggle, expanded) {
  if (!toggle) return;
  const expandedLabel = toggle.dataset?.expandedLabel;
  const collapsedLabel = toggle.dataset?.collapsedLabel;
  const nextLabel = expanded
    ? expandedLabel || toggle.textContent
    : collapsedLabel || toggle.textContent;
  if (typeof nextLabel === "string" && nextLabel.trim()) {
    toggle.textContent = nextLabel.trim();
  }
}

function setCollapsibleState(target, toggle, expanded) {
  if (!target) return;
  target.dataset.expanded = expanded ? "true" : "false";
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(expanded));
    updateToggleLabel(toggle, expanded);
  }
}

function applyCollapsibleViewportState() {
  const isMobile = mobileLayoutQuery ? mobileLayoutQuery.matches : false;
  if (heroDetails) {
    if (!isMobile) {
      setCollapsibleState(heroDetails, heroToggle, true);
      if (heroToggle) {
        heroToggle.hidden = true;
      }
    } else {
      if (heroToggle) {
        heroToggle.hidden = false;
      }
      const expanded = heroDetails.dataset.expanded === "true";
      setCollapsibleState(heroDetails, heroToggle, expanded);
    }
  }
  if (roleCollapsible) {
    if (!isMobile) {
      setCollapsibleState(roleCollapsible, roleToggleButton, true);
      if (roleToggleButton) {
        roleToggleButton.hidden = true;
      }
    } else {
      if (roleToggleButton) {
        roleToggleButton.hidden = false;
      }
      const expanded = roleCollapsible.dataset.expanded === "true";
      setCollapsibleState(roleCollapsible, roleToggleButton, expanded);
    }
  }
}

function setupResponsiveCollapsibles() {
  applyCollapsibleViewportState();
  if (mobileLayoutQuery) {
    const listener = () => applyCollapsibleViewportState();
    if (typeof mobileLayoutQuery.addEventListener === "function") {
      mobileLayoutQuery.addEventListener("change", listener);
    } else if (typeof mobileLayoutQuery.addListener === "function") {
      mobileLayoutQuery.addListener(listener);
    }
  }
  if (heroToggle && heroDetails) {
    heroToggle.addEventListener("click", () => {
      const expanded = heroDetails.dataset.expanded === "true";
      setCollapsibleState(heroDetails, heroToggle, !expanded);
    });
  }
  if (roleToggleButton && roleCollapsible) {
    roleToggleButton.addEventListener("click", () => {
      const expanded = roleCollapsible.dataset.expanded === "true";
      setCollapsibleState(roleCollapsible, roleToggleButton, !expanded);
    });
  }
}

setupResponsiveCollapsibles();

let allProducts = [];
let productTree = {};

function sanitizeProducts(products) {
  if (!Array.isArray(products)) return [];
  return products.map((product) => {
    if (!product || typeof product !== "object") return product;
    const sanitized = { ...product };
    if (typeof sanitized.brand === "string") {
      sanitized.brand = cleanLabel(sanitized.brand);
    }
    if (typeof sanitized.model === "string") {
      sanitized.model = cleanLabel(sanitized.model);
    }
    if (typeof sanitized.catalog_brand === "string") {
      sanitized.catalog_brand = cleanLabel(sanitized.catalog_brand);
    }
    if (typeof sanitized.catalog_model === "string") {
      sanitized.catalog_model = cleanLabel(sanitized.catalog_model);
    }
    if (typeof sanitized.catalog_piece === "string") {
      sanitized.catalog_piece = cleanLabel(sanitized.catalog_piece);
    }
    if (typeof sanitized.category === "string") {
      sanitized.category = cleanLabel(sanitized.category);
    }
    if (typeof sanitized.subcategory === "string") {
      sanitized.subcategory = cleanLabel(sanitized.subcategory);
    }
    if (typeof sanitized.part === "string") {
      sanitized.part = cleanLabel(sanitized.part);
    }
    if (typeof sanitized.component === "string") {
      sanitized.component = cleanLabel(sanitized.component);
    }
    return sanitized;
  });
}

function populateSelect(select, values) {
  if (!select) return;
  const current = select.value;
  while (select.options.length > 1) {
    select.remove(1);
  }
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  if (values.includes(current)) {
    select.value = current;
  } else {
    select.value = "";
  }
}

function populateFilters(products) {
  const brandMap = new Map();
  const categoryMap = new Map();
  const partMap = new Map();
  products.forEach((product) => {
    const brandLabel = getCatalogBrand(product) || "Otros";
    if (brandLabel) {
      const brandKey = normalizeKey(brandLabel) || brandLabel.toLowerCase();
      if (!brandMap.has(brandKey)) {
        brandMap.set(brandKey, brandLabel);
      }
    }
    const categoryLabel = cleanLabel(product.category);
    if (categoryLabel) {
      const categoryKey = normalizeKey(categoryLabel) || categoryLabel.toLowerCase();
      if (!categoryMap.has(categoryKey)) {
        categoryMap.set(categoryKey, categoryLabel);
      }
    }
    const partLabel = cleanLabel(getPartKey(product));
    if (partLabel) {
      const partKey = normalizeKey(partLabel) || partLabel.toLowerCase();
      if (!partMap.has(partKey)) {
        partMap.set(partKey, partLabel);
      }
    }
  });
  const localeCompare = (a, b) => a.localeCompare(b, "es", { sensitivity: "base" });
  populateSelect(brandFilter, Array.from(brandMap.values()).sort(localeCompare));
  populateSelect(
    categoryFilter,
    Array.from(categoryMap.values()).sort(localeCompare),
  );
  populateSelect(partFilter, Array.from(partMap.values()).sort(localeCompare));
}

function updateModelOptions(selectedBrand) {
  if (!modelFilter) return;
  const localeCompare = (a, b) => a.localeCompare(b, "es", { sensitivity: "base" });
  const models = new Map();
  const selectedBrandKey = normalizeKey(selectedBrand);
  allProducts.forEach((product) => {
    const productBrand = getCatalogBrand(product);
    if (
      selectedBrand &&
      normalizeKey(productBrand) !== selectedBrandKey
    ) {
      return;
    }
    const modelLabel = getCatalogModel(product) || "Genérico";
    const modelKey = normalizeKey(modelLabel) || modelLabel.toLowerCase();
    if (!models.has(modelKey)) {
      models.set(modelKey, modelLabel);
    }
  });
  const current = modelFilter.value;
  while (modelFilter.options.length > 1) {
    modelFilter.remove(1);
  }
  Array.from(models.values())
    .sort(localeCompare)
    .forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      modelFilter.appendChild(option);
    });
  const hasCurrent = Array.from(modelFilter.options).some((opt) => opt.value === current);
  if (hasCurrent) {
    modelFilter.value = current;
  } else {
    modelFilter.value = "";
  }
  modelFilter.disabled = selectedBrand && !models.size;
}

function configurePriceSlider(products) {
  if (!priceRange || !priceRangeValue) return;
  const maxPrice = products.reduce((max, product) => {
    const price = Number(product.price_minorista);
    return Number.isFinite(price) && price > max ? price : max;
  }, 0);
  const normalizedMax = Math.max(1000, Math.ceil(maxPrice / 500) * 500);
  priceRange.min = 0;
  priceRange.max = normalizedMax;
  priceRange.step = Math.max(100, Math.round(normalizedMax / 40));
  priceRange.value = normalizedMax;
  priceFilterTouched = false;
  priceRange.dataset.userSet = "false";
  updatePriceRangeDisplay();
}

function applyInitialFilters() {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const initial = {};
  const brand = params.get("brand");
  if (brand && brandFilter) {
    const brandKey = normalizeKey(brand);
    const match = Array.from(brandFilter.options).find(
      (opt) => normalizeKey(opt.value) === brandKey,
    );
    if (match) {
      brandFilter.value = match.value;
      initial.brand = match.value;
    }
  }
  updateModelOptions(brandFilter?.value || "");
  const model = params.get("model");
  if (model && modelFilter) {
    const modelKey = normalizeKey(model);
    const match = Array.from(modelFilter.options).find(
      (opt) => normalizeKey(opt.value) === modelKey,
    );
    if (match) {
      modelFilter.value = match.value;
      initial.model = match.value;
    }
  }
  const category = params.get("category");
  if (category && categoryFilter) {
    const categoryKey = normalizeKey(category);
    const match = Array.from(categoryFilter.options).find(
      (opt) => normalizeKey(opt.value) === categoryKey,
    );
    if (match) {
      categoryFilter.value = match.value;
      initial.category = match.value;
    }
  }
  const part = params.get("part");
  if (part && partFilter) {
    const partKey = normalizeKey(part);
    const match = Array.from(partFilter.options).find(
      (opt) => normalizeKey(opt.value) === partKey,
    );
    if (match) {
      partFilter.value = match.value;
      initial.part = match.value;
    }
  }
  const stock = params.get("stock");
  if (stock && stockFilter) {
    const allowed = ["in-stock", "low-stock"];
    if (allowed.includes(stock)) {
      stockFilter.value = stock;
      initial.stock = stock;
    }
  }
  const sort = params.get("sort");
  if (sort && sortSelect) {
    const exists = Array.from(sortSelect.options).some((opt) => opt.value === sort);
    if (exists) {
      sortSelect.value = sort;
      initial.sort = sort;
    }
  }
  const query = params.get("q");
  if (query && searchInput) {
    searchInput.value = query;
    initial.search = query;
  }
  const priceMax = params.get("price_max");
  if (priceMax && priceRange) {
    const value = Number(priceMax);
    if (!Number.isNaN(value)) {
      const max = Number(priceRange.max) || value;
      const min = Number(priceRange.min) || 0;
      const clamped = Math.min(Math.max(value, min), max);
      priceRange.value = clamped;
      priceFilterTouched = true;
      priceRange.dataset.userSet = "true";
      initial.price = clamped;
      updatePriceRangeDisplay();
    }
  }
  return initial;
}

function calculateDiscountedPrice(basePrice, quantity) {
  let discount = 0;
  if (quantity >= 20) {
    discount = 0.15;
  } else if (quantity >= 10) {
    discount = 0.1;
  } else if (quantity >= 5) {
    discount = 0.05;
  }
  return Math.round(basePrice * (1 - discount));
}

function createPriceTier(label, value, note, modifier, options = {}) {
  const locked = Boolean(options.locked);
  const placeholder =
    typeof options.placeholder === "string"
      ? options.placeholder
      : "Iniciá sesión";
  if (!locked && (typeof value !== "number" || Number.isNaN(value))) return null;
  const tier = document.createElement("div");
  tier.className = `price-tier ${modifier || ""}`.trim();
  if (locked) {
    tier.dataset.locked = "true";
  }
  const labelEl = document.createElement("span");
  labelEl.className = "price-tier__label";
  labelEl.textContent = label;
  tier.appendChild(labelEl);
  const valueEl = document.createElement("span");
  valueEl.className = "price-tier__value";
  if (!locked) {
    valueEl.textContent = formatCurrency(value);
  } else {
    valueEl.textContent = placeholder;
  }
  tier.appendChild(valueEl);
  if (note) {
    const noteEl = document.createElement("span");
    noteEl.className = "price-tier__note";
    noteEl.textContent = note;
    tier.appendChild(noteEl);
  }
  return { tier, valueEl };
}

function createProductCard(product) {
  const card = document.createElement("div");
  card.className = "product-card";
  card.setAttribute("role", "listitem");

  const cover = getPrimaryImage(product);
  const retailPrice = Number(product.price_minorista);
  const wholesalePrice = Number(product.price_mayorista);
  const wholesaleUser = isWholesale();
  const roleState = resolveRoleState();
  const img = document.createElement("img");
  img.src = cover || PLACEHOLDER_IMAGE;
  img.alt = product.name || product.model || "Producto";
  card.appendChild(img);

  const meta = document.createElement("div");
  meta.className = "product-meta";
  if (product.sku) {
    const sku = document.createElement("span");
    sku.className = "sku";
    sku.textContent = product.sku;
    meta.appendChild(sku);
  }
  const displayBrand = getCatalogBrand(product);
  const displayModel = getCatalogModel(product);
  if (displayBrand || displayModel) {
    const modelChip = document.createElement("span");
    modelChip.className = "chip";
    modelChip.textContent = [displayBrand, displayModel]
      .filter(Boolean)
      .join(" · ");
    meta.appendChild(modelChip);
  }
  const partLabel = getPartKey(product);
  if (partLabel) {
    const partChip = document.createElement("span");
    partChip.className = "chip";
    partChip.textContent = partLabel;
    meta.appendChild(partChip);
  }
  card.appendChild(meta);

  const title = document.createElement("h3");
  title.textContent = product.name;
  card.appendChild(title);

  const desc = document.createElement("p");
  desc.className = "description";
  const descriptionText =
    getProductDescription(product) || "Descripción no disponible.";
  desc.textContent = createDescriptionPreview(descriptionText);
  desc.title = descriptionText;
  card.appendChild(desc);

  const availability = document.createElement("div");
  availability.className = "availability-badges";
  const status = getStockStatus(product);
  if (status === "out") {
    availability.appendChild(createAvailabilityBadge("Sin stock", "out"));
  } else if (status === "low") {
    availability.appendChild(createAvailabilityBadge("Poco stock", "low"));
  } else if (status === "in") {
    availability.appendChild(
      createAvailabilityBadge(`Stock: ${product.stock} u.`, ""),
    );
  }
  if (product.vip_only) {
    availability.appendChild(
      createAvailabilityBadge("Exclusivo VIP", "vip"),
    );
  }
  if (
    product.warehouseStock &&
    typeof product.warehouseStock === "object" &&
    Object.keys(product.warehouseStock).length
  ) {
    const warehouses = Object.entries(product.warehouseStock)
      .map(([warehouse, qty]) => `${warehouse}: ${qty}`)
      .join(" · ");
    availability.appendChild(createAvailabilityBadge(warehouses));
  }
  if (availability.childElementCount > 0) {
    card.appendChild(availability);
  }

  const priceBlock = document.createElement("div");
  priceBlock.className = "price-block";
  const retailTier = createPriceTier(
    "Minorista",
    retailPrice,
    roleState === "wholesale"
      ? "Precio normal/minorista"
      : "Precio final sugerido",
    "price-tier--retail",
  );
  const wholesaleTier = createPriceTier(
    "Mayorista",
    wholesalePrice,
    wholesaleUser
      ? "Descuentos automáticos por volumen"
      : "Exclusivo para cuentas mayoristas verificadas",
    "price-tier--wholesale",
    {
      locked: !wholesaleUser,
      placeholder: "Ingresá para ver",
    },
  );
  if (retailTier) {
    if (!wholesaleUser) retailTier.tier.dataset.active = "true";
    priceBlock.appendChild(retailTier.tier);
  }
  if (wholesaleTier) {
    if (wholesaleUser) wholesaleTier.tier.dataset.active = "true";
    priceBlock.appendChild(wholesaleTier.tier);
  }
  if (priceBlock.childElementCount > 0) {
    card.appendChild(priceBlock);
  }

  const cartDiv = document.createElement("div");
  cartDiv.className = "add-to-cart";
  const wholesaleValueEl = wholesaleUser ? wholesaleTier?.valueEl : null;
  if (wholesaleUser) {
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = 1;
    qtyInput.value = 1;
    if (typeof product.stock === "number") {
      qtyInput.max = product.stock;
    }
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "Agregar";
      qtyInput.addEventListener("input", () => {
        let qty = parseInt(qtyInput.value, 10);
        if (!Number.isFinite(qty) || qty < 1) qty = 1;
        if (typeof product.stock === "number" && qty > product.stock) {
          qty = product.stock;
        }
        qtyInput.value = qty;
        if (wholesaleValueEl) {
          const discounted = calculateDiscountedPrice(
            wholesalePrice,
            qty,
          );
          wholesaleValueEl.textContent = formatCurrency(discounted);
        }
      });
    addBtn.addEventListener("click", () => {
      const qty = parseInt(qtyInput.value, 10) || 1;
      const available =
        typeof product.stock === "number" ? product.stock : Infinity;
      if (qty > available) {
        alert(`No hay stock suficiente. Disponibles: ${available}`);
        qtyInput.value = available;
        return;
      }
      const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
      const existing = cart.find((item) => item.id === product.id);
      if (existing) {
        const newQty = existing.quantity + qty;
        if (newQty > available) {
          alert(
            `Ya tienes ${existing.quantity} unidades en el carrito. Disponibles: ${available}`,
          );
          return;
        }
        existing.quantity = newQty;
      } else {
        cart.push({
          id: product.id,
          name: product.name,
          price: wholesalePrice,
          quantity: qty,
          image: cover || PLACEHOLDER_IMAGE,
        });
      }
      localStorage.setItem("nerinCart", JSON.stringify(cart));
      addBtn.textContent = "Añadido";
      setTimeout(() => {
        addBtn.textContent = "Agregar";
      }, 2000);
      if (window.updateNav) window.updateNav();
      if (window.showCartIndicator) {
        window.showCartIndicator({
          productId: product.id,
          productName: product.name,
          productSku: product.sku || product.id,
          source: "shop",
        });
      } else if (window.showToast) {
        window.showToast("✅ Producto agregado al carrito");
      }
    });
    cartDiv.appendChild(qtyInput);
    cartDiv.appendChild(addBtn);
  } else {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "Agregar";
    addBtn.addEventListener("click", () => {
      if (typeof product.stock === "number" && product.stock <= 0) {
        alert("Sin stock disponible");
        return;
      }
      const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
      const existing = cart.find((item) => item.id === product.id);
      const available =
        typeof product.stock === "number" ? product.stock : Infinity;
      if (existing) {
        if (existing.quantity + 1 > available) {
          alert(
            `Ya tienes ${existing.quantity} unidades en el carrito. Disponibles: ${available}`,
          );
          return;
        }
        existing.quantity += 1;
      } else {
        cart.push({
          id: product.id,
          name: product.name,
          price: retailPrice,
          quantity: 1,
          image: cover || PLACEHOLDER_IMAGE,
        });
      }
      localStorage.setItem("nerinCart", JSON.stringify(cart));
      addBtn.textContent = "Añadido";
      setTimeout(() => {
        addBtn.textContent = "Agregar";
      }, 2000);
      if (window.updateNav) window.updateNav();
      if (window.showCartIndicator) {
        window.showCartIndicator({
          productId: product.id,
          productName: product.name,
          productSku: product.sku || product.id,
          source: "shop",
        });
      } else if (window.showToast) {
        window.showToast("✅ Producto agregado al carrito");
      }
    });
    cartDiv.appendChild(addBtn);
  }

  const actionsDiv = document.createElement("div");
  actionsDiv.className = "product-actions";
  if (cartDiv.childElementCount > 0) {
    actionsDiv.appendChild(cartDiv);
  }
  const infoBtn = document.createElement("button");
  infoBtn.className = "button secondary info-btn";
  infoBtn.type = "button";
  infoBtn.textContent = "Ver detalle";
  infoBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    window.location.href = buildProductUrl(product);
  });
  actionsDiv.appendChild(infoBtn);
  card.appendChild(actionsDiv);

  card.addEventListener("click", (evt) => {
    if (evt.target.tagName === "BUTTON" || evt.target.tagName === "INPUT") {
      return;
    }
    window.location.href = buildProductUrl(product);
  });

  return card;
}

function computeRelevance(product, searchTerm) {
  if (!searchTerm) return 0;
  const term = searchTerm.toLowerCase();
  let score = 0;
  const addScore = (value, weight) => {
    if (typeof value !== "string") return;
    const normalized = value.toLowerCase();
    if (!normalized) return;
    if (normalized === term) {
      score += weight * 4;
    } else if (normalized.startsWith(term)) {
      score += weight * 2;
    } else if (normalized.includes(term)) {
      score += weight;
    }
  };
  addScore(product.name, 6);
  addScore(product.model, 5);
  addScore(product.sku, 7);
  addScore(product.brand, 3);
  addScore(getPartKey(product), 4);
  addScore(getProductDescription(product), 2);
  if (Array.isArray(product.tags)) {
    product.tags.forEach((tag) => addScore(tag, 1));
  }
  return score;
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
      return copy.sort((a, b) => {
        const diff = computeRelevance(b, searchTerm) - computeRelevance(a, searchTerm);
        if (diff !== 0) return diff;
        return (a.name || "").localeCompare(b.name || "", "es", {
          sensitivity: "base",
        });
      });
  }
}

function updateResultSummary(count) {
  if (resultCountEl) {
    resultCountEl.textContent = String(count);
  }
  const summaryParagraph = document.querySelector(".results-summary p");
  if (summaryParagraph) {
    summaryParagraph.textContent =
      count === 1 ? "1 resultado disponible." : `${count} coincidencias encontradas.`;
  }
}

function updatePriceRangeDisplay() {
  if (!priceRange || !priceRangeValue) return;
  const max = Number(priceRange.max) || 0;
  const value = Number(priceRange.value) || 0;
  const userSet = priceFilterTouched || priceRange.dataset.userSet === "true";
  if (!userSet || !max || value >= max) {
    priceRangeValue.textContent = "Sin tope";
  } else {
    priceRangeValue.textContent = formatCurrency(value);
  }
}

function syncQueryParams(filters) {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.brand) params.set("brand", filters.brand);
  if (filters.model) params.set("model", filters.model);
  if (filters.category) params.set("category", filters.category);
  if (filters.part) params.set("part", filters.part);
  if (filters.stock) params.set("stock", filters.stock);
  if (filters.priceActive && filters.price) params.set("price_max", filters.price);
  if (filters.sort && filters.sort !== "relevance") params.set("sort", filters.sort);
  const query = params.toString();
  const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState({}, "", newUrl);
}

function updateActiveFilters(filters) {
  if (!activeFiltersContainer) return;
  activeFiltersContainer.innerHTML = "";
  const descriptors = [
    {
      key: "search",
      label: "Búsqueda",
      value: filters.search,
      clear: () => {
        if (searchInput) searchInput.value = "";
      },
    },
    {
      key: "brand",
      label: "Marca",
      value: filters.brand,
      clear: () => {
        if (brandFilter) brandFilter.value = "";
        updateModelOptions("");
        if (modelFilter) modelFilter.value = "";
        if (partFilter) partFilter.value = "";
      },
    },
    {
      key: "model",
      label: "Modelo",
      value: filters.model,
      clear: () => {
        if (modelFilter) modelFilter.value = "";
      },
    },
    {
      key: "category",
      label: "Tipo",
      value: filters.category,
      clear: () => {
        if (categoryFilter) categoryFilter.value = "";
      },
    },
    {
      key: "part",
      label: "Pieza",
      value: filters.part,
      clear: () => {
        if (partFilter) partFilter.value = "";
      },
    },
    {
      key: "stock",
      label: "Stock",
      value:
        filters.stock === "in-stock"
          ? "Solo con stock"
          : filters.stock === "low-stock"
          ? "Stock crítico"
          : "",
      clear: () => {
        if (stockFilter) stockFilter.value = "";
      },
    },
    {
      key: "price",
      label: "Precio ≤",
      value: filters.priceActive ? formatCurrency(filters.price) : "",
      clear: () => {
        if (priceRange) {
          priceRange.value = priceRange.max;
          priceFilterTouched = false;
          priceRange.dataset.userSet = "false";
          updatePriceRangeDisplay();
        }
      },
    },
  ];
  descriptors
    .filter((descriptor) => descriptor.value)
    .forEach((descriptor) => {
      const chip = document.createElement("span");
      chip.className = "filter-chip";
      const label = document.createElement("span");
      label.textContent = `${descriptor.label}: ${descriptor.value}`;
      chip.appendChild(label);
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `Quitar filtro ${descriptor.label}`);
      button.textContent = "×";
      button.addEventListener("click", () => {
        descriptor.clear();
        renderProducts();
      });
      chip.appendChild(button);
      activeFiltersContainer.appendChild(chip);
    });
}

function buildProductTree(products) {
  const tree = {};
  products.forEach((product) => {
    const brandLabel = getCatalogBrand(product) || "Otros";
    const brandKey = normalizeKey(brandLabel) || "otros";
    if (!tree[brandKey]) {
      tree[brandKey] = { key: brandKey, label: brandLabel, count: 0, models: {} };
    } else if (!tree[brandKey].label) {
      tree[brandKey].label = brandLabel;
    }
    const brandData = tree[brandKey];
    const modelLabel = getCatalogModel(product) || "Genérico";
    const modelKeyRaw = normalizeKey(modelLabel);
    const modelKey = modelKeyRaw || `model-${brandData.count}`;
    if (!brandData.models[modelKey]) {
      brandData.models[modelKey] = {
        key: modelKey,
        label: modelLabel,
        count: 0,
        parts: {},
      };
    } else if (!brandData.models[modelKey].label) {
      brandData.models[modelKey].label = modelLabel;
    }
    const modelData = brandData.models[modelKey];
    brandData.count += 1;
    modelData.count += 1;
    const rawPart = getPartKey(product);
    const partLabel = cleanLabel(rawPart) || "Pieza genérica";
    const partKey = normalizeKey(partLabel) || partLabel.toLowerCase();
    if (!modelData.parts[partKey]) {
      modelData.parts[partKey] = { label: partLabel, count: 0 };
    }
    modelData.parts[partKey].count += 1;
  });
  return tree;
}

function renderModelExplorer(tree) {
  if (!modelExplorerContainer) return;
  modelExplorerContainer.innerHTML = "";
  const localeCompare = (a, b) => a.localeCompare(b, "es", { sensitivity: "base" });
  Object.values(tree)
    .sort((brandA, brandB) =>
      localeCompare(brandA.label || "", brandB.label || ""),
    )
    .forEach((brandData) => {
      const brandLabel = brandData.label || "Otros";
      const panel = document.createElement("details");
      panel.className = "explorer-panel";
      panel.dataset.brand = brandLabel;
      panel.dataset.brandKey = brandData.key;
      const summary = document.createElement("summary");
      const label = document.createElement("span");
      label.textContent = brandLabel;
      const count = document.createElement("span");
      count.className = "explorer-count";
      count.textContent = `${brandData.count} piezas`;
      summary.appendChild(label);
      summary.appendChild(count);
      panel.appendChild(summary);

      const modelsWrapper = document.createElement("div");
      modelsWrapper.className = "explorer-models";
      Object.values(brandData.models)
        .sort((modelA, modelB) =>
          localeCompare(modelA.label || "", modelB.label || ""),
        )
        .forEach((modelData) => {
          const modelLabel = modelData.label || "Genérico";
          const modelCard = document.createElement("article");
          modelCard.className = "explorer-model";
          modelCard.dataset.model = modelLabel;
          modelCard.dataset.modelKey = modelData.key;
          const header = document.createElement("div");
          header.className = "explorer-model__header";
          const name = document.createElement("span");
          name.textContent = modelLabel;
          const modelCount = document.createElement("span");
          modelCount.className = "explorer-count";
          modelCount.textContent = `${modelData.count} variantes`;
          header.appendChild(name);
          header.appendChild(modelCount);
          modelCard.appendChild(header);

          const pieces = document.createElement("div");
          pieces.className = "explorer-model__pieces";
          Object.values(modelData.parts)
            .sort((a, b) => b.count - a.count)
            .forEach(({ label: partLabel, count: countValue }) => {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "piece-button";
              button.textContent = `${partLabel} (${countValue})`;
              button.dataset.brand = brandLabel;
              button.dataset.brandKey = brandData.key;
              button.dataset.model = modelLabel;
              button.dataset.modelKey = modelData.key;
              button.dataset.part = partLabel;
              button.setAttribute("aria-pressed", "false");
              button.addEventListener("click", () => {
                if (brandFilter) brandFilter.value = brandLabel;
                updateModelOptions(brandLabel);
                if (modelFilter) modelFilter.value = modelLabel;
                if (partFilter) partFilter.value = partLabel;
                renderProducts();
                if (productGrid) {
                  window.scrollTo({
                    top: Math.max(productGrid.offsetTop - 120, 0),
                    behavior: "smooth",
                  });
                }
              });
              pieces.appendChild(button);
            });
          modelCard.appendChild(pieces);
          modelsWrapper.appendChild(modelCard);
        });
      panel.appendChild(modelsWrapper);
      modelExplorerContainer.appendChild(panel);
    });
}

function highlightExplorerSelection(filters) {
  if (!modelExplorerContainer) return;
  const panels = Array.from(
    modelExplorerContainer.querySelectorAll(".explorer-panel"),
  );
  if (!panels.length) return;
  const selectedBrandKey = normalizeKey(filters.brand);
  if (!filters.brand) {
    const preferred =
      panels.find(
        (panel) => panel.dataset.brand?.toLowerCase() === "apple",
      ) || panels[0];
    panels.forEach((panel) => {
      panel.open = panel === preferred;
    });
  } else {
    panels.forEach((panel) => {
      panel.open =
        normalizeKey(panel.dataset.brand) === selectedBrandKey ||
        panel.dataset.brandKey === selectedBrandKey;
    });
  }
  const buttons = modelExplorerContainer.querySelectorAll(".piece-button");
  const hasGranularFilter = Boolean(filters.part || filters.model);
  const selectedModelKey = normalizeKey(filters.model);
  const selectedPartKey = normalizeKey(filters.part);
  buttons.forEach((button) => {
    const matchesBrand =
      !filters.brand || normalizeKey(button.dataset.brand) === selectedBrandKey;
    const matchesModel =
      !filters.model || normalizeKey(button.dataset.model) === selectedModelKey;
    const matchesPart =
      !filters.part || normalizeKey(button.dataset.part) === selectedPartKey;
    const active =
      filters.brand && hasGranularFilter && matchesBrand && matchesModel && matchesPart;
    button.dataset.active = active ? "true" : "false";
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function renderProducts() {
  if (!productGrid) return;
  applyRoleState();
  const searchTermRaw = searchInput?.value?.trim() || "";
  const searchTerm = searchTermRaw.toLowerCase();
  const brandVal = brandFilter?.value || "";
  const modelVal = modelFilter?.value || "";
  const categoryVal = categoryFilter?.value || "";
  const partVal = partFilter?.value || "";
  const stockVal = stockFilter?.value || "";
  const sortVal = sortSelect?.value || "relevance";
  const brandKey = normalizeKey(brandVal);
  const modelKey = normalizeKey(modelVal);
  const categoryKey = normalizeKey(categoryVal);
  const partKeyFilter = normalizeKey(partVal);
  const priceValue = priceRange ? Number(priceRange.value) || 0 : 0;
  const priceMax = priceRange ? Number(priceRange.max) || 0 : 0;
  const priceFilterUsed = Boolean(priceRange) && priceRange.dataset.userSet === "true";
  const priceActive = Boolean(priceFilterUsed) && priceMax > 0 && priceValue > 0;
  const filters = {
    search: searchTermRaw,
    brand: brandVal,
    model: modelVal,
    category: categoryVal,
    part: partVal,
    stock: stockVal,
    price: priceValue,
    priceActive,
    sort: sortVal,
  };

  const role = getUserRole();
  const filtered = allProducts.filter((product) => {
    if (product.vip_only && role !== "vip" && role !== "admin") return false;
    const fields = [
      product.name,
      product.sku,
      product.brand,
      product.model,
      product.catalog_brand,
      product.catalog_model,
      product.catalog_piece,
      getCatalogBrand(product),
      getCatalogModel(product),
      product.category,
      product.subcategory,
      getPartKey(product),
      getProductDescription(product),
    ];
    if (Array.isArray(product.tags)) fields.push(...product.tags);
    const matchesSearch =
      !searchTerm ||
      fields.some(
        (field) =>
          typeof field === "string" && field.toLowerCase().includes(searchTerm),
      );
    if (!matchesSearch) return false;
    const catalogBrand = getCatalogBrand(product);
    const matchesBrand = !brandVal || normalizeKey(catalogBrand) === brandKey;
    if (!matchesBrand) return false;
    const catalogModel = getCatalogModel(product);
    const matchesModel = !modelVal || normalizeKey(catalogModel) === modelKey;
    if (!matchesModel) return false;
    const matchesCategory =
      !categoryVal || normalizeKey(product.category) === categoryKey;
    if (!matchesCategory) return false;
    const partKey = getPartKey(product);
    const matchesPart =
      !partVal || normalizeKey(partKey) === partKeyFilter;
    if (!matchesPart) return false;
    const status = getStockStatus(product);
    const matchesStock =
      !stockVal ||
      (stockVal === "in-stock" && status === "in") ||
      (stockVal === "low-stock" && status === "low");
    if (!matchesStock) return false;
    const price = Number(product.price_minorista) || 0;
    const matchesPrice = !priceActive || price <= priceValue;
    return matchesPrice;
  });

  const sorted = sortProducts(filtered, sortVal, searchTerm);
  productGrid.innerHTML = "";
  if (sorted.length === 0) {
    const msg = document.createElement("p");
    msg.textContent =
      "No encontramos coincidencias con los filtros seleccionados. Ajustá la búsqueda o elegí otra pieza.";
    productGrid.appendChild(msg);
  } else {
    sorted.forEach((product) => {
      const card = createProductCard(product);
      productGrid.appendChild(card);
    });
  }
  updateResultSummary(sorted.length);
  updateActiveFilters(filters);
  highlightExplorerSelection(filters);
  updateShopBreadcrumbs([
    filters.brand,
    filters.model,
    filters.part || filters.category,
  ]);
  syncQueryParams(filters);
}

async function initShop() {
  try {
    allProducts = sanitizeProducts(await fetchProducts());
    productTree = buildProductTree(allProducts);
    populateFilters(allProducts);
    updateModelOptions("");
    configurePriceSlider(allProducts);
    applyInitialFilters();
    renderModelExplorer(productTree);
    updateCollectionSchema(productTree);
    renderProducts();
    if (searchInput) {
      searchInput.addEventListener("input", () => renderProducts());
      searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          searchInput.value = "";
          renderProducts();
        }
      });
    }
    if (searchClear) {
      searchClear.addEventListener("click", () => {
        searchInput.value = "";
        searchInput.focus();
        renderProducts();
      });
    }
    if (brandFilter) {
      brandFilter.addEventListener("change", () => {
        updateModelOptions(brandFilter.value);
        renderProducts();
      });
    }
    if (modelFilter) {
      modelFilter.addEventListener("change", () => renderProducts());
    }
    if (categoryFilter) {
      categoryFilter.addEventListener("change", () => renderProducts());
    }
    if (partFilter) {
      partFilter.addEventListener("change", () => renderProducts());
    }
    if (stockFilter) {
      stockFilter.addEventListener("change", () => renderProducts());
    }
    if (priceRange) {
      priceRange.addEventListener("input", () => {
        priceFilterTouched = true;
        priceRange.dataset.userSet = "true";
        updatePriceRangeDisplay();
        renderProducts();
      });
    }
    if (sortSelect) {
      sortSelect.addEventListener("change", () => renderProducts());
    }
  } catch (err) {
    console.error(err);
    if (productGrid) {
      productGrid.innerHTML = `<p>Error al cargar productos: ${err.message}</p>`;
    }
    updateShopBreadcrumbs([]);
  }
}

window.addEventListener("storage", (event) => {
  if (event.key === "nerinUserRole") {
    applyRoleState();
  }
});

window.addEventListener("focus", applyRoleState);

document.addEventListener("DOMContentLoaded", initShop);
