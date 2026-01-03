import { fetchProducts, isWholesale, getUserRole } from "./api.js";

const CONFIG_CACHE_KEY = "nerin:config-cache";

function primeConfigFromCache() {
  if (typeof window === "undefined" || window.NERIN_CONFIG) return;
  try {
    const raw = localStorage.getItem(CONFIG_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      window.NERIN_CONFIG = parsed;
    }
  } catch (err) {
    console.warn("home-cache-read", err);
  }
}

primeConfigFromCache();

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0";
  return currencyFormatter.format(amount);
}

const PLACEHOLDER_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const DEFAULT_HOME_CONTENT = {
  hero: {
    eyebrow: "Operamos para laboratorios y cadenas",
    title: "Pantallas y repuestos originales listos para instalar",
    description:
      "Nacimos atendiendo la demanda de pantallas Samsung Service Pack y hoy ampliamos el catálogo con líneas Apple, Motorola y soluciones corporativas. Todo con control técnico propio y despacho en horas, no en días.",
    bullets: [
      "Stock auditado en CABA con envíos al país",
      "Laboratorio interno para validar cada lote",
      "Plan de expansión a nuevas marcas premium",
    ],
    primaryCta: { label: "Ver catálogo", href: "/shop.html" },
    secondaryCta: { label: "Hablar con un asesor", href: "/contact.html" },
    media: {
      desktop: "/assets/hero.png",
      mobile: "/assets/hero.png",
      alt: "Equipo técnico de NERIN validando módulos Service Pack",
    },
  },
  highlights: [
    {
      icon: "📦",
      title: "Stock auditado cada mañana",
      description:
        "Inventario real de Service Pack y módulos OEM con controles de lote y trazabilidad.",
    },
    {
      icon: "🛠️",
      title: "Garantía laboratorio",
      description:
        "Probamos módulos y flex antes de despachar para reducir DOA en los talleres que atendemos.",
    },
    {
      icon: "🚚",
      title: "Logística en 24/48 hs",
      description:
        "Despachos en el día para CABA y GBA y operadores nacionales para llegar a cada provincia.",
    },
  ],
  about: {
    title: "De Mercado Libre a un laboratorio integral",
    lead:
      "Arrancamos en 2021 vendiendo repuestos a través de Mercado Libre. Las restricciones a las importaciones frenaron el proyecto, pero volvimos en 2025 mejor preparados.",
    body:
      "El relanzamiento de NERIN combina procesos de control renovados, acuerdos logísticos ágiles y un sistema pensado para técnicos y cadenas. Apostamos a calidad sostenible, servicio responsable y un ecosistema que pueda escalar sin perder cercanía.",
    image: "/assets/product1.png",
    imageAlt: "Equipo de NERIN calibrando repuestos para el relanzamiento",
    milestones: [
      {
        title: "2021",
        description: "Comercializamos repuestos originales a través de Mercado Libre.",
      },
      {
        title: "2023",
        description:
          "Las restricciones de importación nos obligan a pausar operaciones y replantear el modelo.",
      },
      {
        title: "2025",
        description: "Relanzamos con procesos, servicio y catálogo ampliado para talleres y cadenas.",
      },
    ],
  },
  why: {
    title: "Por qué elegir NERIN",
    description:
      "Diseñamos una experiencia alineada con la operación técnica: datos reales, logística predecible y soporte especializado.",
    cards: [
      {
        title: "Kits listos para instalar",
        description:
          "Pantalla y adhesivos calibrados para que sólo tengas que montar y entregar.",
        image: "",
      },
      {
        title: "Control de lote en tiempo real",
        description:
          "Actualizamos stock y números de serie para que sepas exactamente qué estás recibiendo.",
        image: "",
      },
      {
        title: "Equipo en formación constante",
        description:
          "Nos nutrimos de la experiencia de los talleres para aprender y acompañarte en cada implementación.",
        image: "",
      },
    ],
  },
  featured: {
    title: "Productos destacados",
    description:
      "Seleccionamos los módulos con mejor rendimiento y disponibilidad inmediata.",
    productIds: [],
  },
  contact: {
    eyebrow: "Cotizá en segundos",
    title: "Contanos qué necesitás y coordinamos la entrega",
    description:
      "Respondemos con precio, stock y opciones de retiro o envío en horario comercial.",
    note: "Si lo necesitás urgente marcá la opción correspondiente y priorizamos tu caso.",
    bulletPoints: [
      "Asistencia personalizada por WhatsApp o llamada",
      "Opciones mayorista y minorista",
      "Seguimiento de cada pedido hasta la entrega",
    ],
  },
  popup: {
    enabled: false,
    image: "",
    alt: "",
    link: "",
    frequencyHours: 24,
  },
};

let currentHomeContent = getResolvedHomeConfig(
  typeof window !== "undefined" ? window.NERIN_CONFIG : {},
);

function deepClone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep(base, override) {
  if (!isPlainObject(base)) {
    return override !== undefined ? deepClone(override) : deepClone(base);
  }
  const result = {};
  const overrideKeys = override && typeof override === "object" ? Object.keys(override) : [];
  const keys = new Set([...Object.keys(base), ...overrideKeys]);
  keys.forEach((key) => {
    const baseValue = base[key];
    const hasOverride = overrideKeys.includes(key);
    if (hasOverride) {
      const overrideValue = override[key];
      if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
        if (Array.isArray(overrideValue)) {
          result[key] = overrideValue.map((item, index) => {
            const baseItem = Array.isArray(baseValue) ? baseValue[index] : undefined;
            return isPlainObject(item) ? mergeDeep(baseItem || {}, item) : item;
          });
        } else {
          result[key] = deepClone(Array.isArray(baseValue) ? baseValue : []);
        }
      } else if (isPlainObject(baseValue) || isPlainObject(overrideValue)) {
        result[key] = mergeDeep(baseValue || {}, overrideValue || {});
      } else {
        result[key] = overrideValue;
      }
    } else {
      if (Array.isArray(baseValue)) {
        result[key] = baseValue.map((item) =>
          isPlainObject(item) ? mergeDeep(item, {}) : item,
        );
      } else if (isPlainObject(baseValue)) {
        result[key] = mergeDeep(baseValue, {});
      } else {
        result[key] = baseValue;
      }
    }
  });
  return result;
}

function getResolvedHomeConfig(source) {
  let raw = null;
  if (source && typeof source === "object") {
    raw = source.homePage && typeof source.homePage === "object" ? source.homePage : source;
  } else if (window.NERIN_CONFIG && typeof window.NERIN_CONFIG.homePage === "object") {
    raw = window.NERIN_CONFIG.homePage;
  }
  if (!raw) return deepClone(DEFAULT_HOME_CONTENT);
  return mergeDeep(DEFAULT_HOME_CONTENT, raw);
}

function updateText(path, value) {
  const nodes = document.querySelectorAll(`[data-home-text="${path}"]`);
  if (!nodes.length) return;
  nodes.forEach((node) => {
    if (typeof value === "string") {
      node.textContent = value;
    }
  });
}

function updateList(path, items) {
  const container = document.querySelector(`[data-home-list="${path}"]`);
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(items) || !items.length) return;
  items.forEach((item) => {
    if (typeof item !== "string") return;
    const li = document.createElement("li");
    li.textContent = item;
    container.appendChild(li);
  });
}

function updateCta(path, data) {
  document.querySelectorAll(`[data-home-cta="${path}"]`).forEach((node) => {
    if (!(node instanceof HTMLAnchorElement)) return;
    if (data && typeof data.href === "string") {
      node.href = data.href;
    }
    if (data && typeof data.label === "string") {
      node.textContent = data.label;
    }
  });
}

function updateHeroMedia(media) {
  if (!media) return;
  const picture = document.querySelector('[data-home-picture="hero.media"]');
  if (picture) {
    const desktop = picture.querySelector('[data-home-image="desktop"]');
    const mobile = picture.querySelector('[data-home-image="mobile"]');
    if (desktop && media.desktop) {
      desktop.srcset = media.desktop;
    }
    if (mobile) {
      if (media.mobile) {
        mobile.src = media.mobile;
      }
      if (media.alt) {
        mobile.alt = media.alt;
      }
    }
  }
}

function updateAboutImage(image, alt) {
  const img = document.querySelector('[data-home-image="about.image"]');
  const mediaWrapper = img?.closest(".home-about__media");
  if (!img) return;
  if (typeof image === "string" && image.trim()) {
    img.src = image;
    if (typeof alt === "string" && alt.trim()) {
      img.alt = alt;
    }
    if (mediaWrapper) mediaWrapper.hidden = false;
  } else if (mediaWrapper) {
    mediaWrapper.hidden = true;
  }
}

function renderHighlights(highlights) {
  const container = document.getElementById("homeHighlights");
  const section = container?.closest(".home-highlights");
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(highlights) || !highlights.length) {
    if (section) section.hidden = true;
    return;
  }
  if (section) section.hidden = false;
  highlights.forEach((highlight) => {
    if (!highlight || typeof highlight !== "object") return;
    const article = document.createElement("article");
    article.className = "home-highlight";
    if (highlight.icon) {
      const icon = document.createElement("span");
      icon.className = "home-highlight__icon";
      icon.textContent = highlight.icon;
      article.appendChild(icon);
    }
    if (highlight.title) {
      const title = document.createElement("h3");
      title.textContent = highlight.title;
      article.appendChild(title);
    }
    if (highlight.description) {
      const desc = document.createElement("p");
      desc.textContent = highlight.description;
      article.appendChild(desc);
    }
    container.appendChild(article);
  });
}

function renderMilestones(milestones) {
  const list = document.getElementById("homeMilestones");
  if (!list) return;
  list.innerHTML = "";
  if (!Array.isArray(milestones) || !milestones.length) {
    list.hidden = true;
    return;
  }
  list.hidden = false;
  milestones.forEach((milestone) => {
    if (!milestone || typeof milestone !== "object") return;
    const li = document.createElement("li");
    const year = document.createElement("span");
    year.className = "home-milestones__year";
    year.textContent = milestone.title || milestone.year || "";
    li.appendChild(year);
    if (milestone.description) {
      const desc = document.createElement("p");
      desc.textContent = milestone.description;
      li.appendChild(desc);
    }
    list.appendChild(li);
  });
}

function renderWhyCards(cards) {
  const grid = document.getElementById("homeWhyCards");
  const section = grid?.closest(".home-why");
  if (!grid) return;
  grid.innerHTML = "";
  if (!Array.isArray(cards) || !cards.length) {
    if (section) section.hidden = true;
    return;
  }
  if (section) section.hidden = false;
  cards.forEach((card) => {
    if (!card || typeof card !== "object") return;
    const article = document.createElement("article");
    article.className = "home-why__card";
    if (card.image) {
      const img = document.createElement("img");
      img.src = card.image;
      img.alt = card.title || "Por qué elegir NERIN";
      article.appendChild(img);
    }
    if (card.title) {
      const title = document.createElement("h3");
      title.textContent = card.title;
      article.appendChild(title);
    }
    if (card.description) {
      const desc = document.createElement("p");
      desc.textContent = card.description;
      article.appendChild(desc);
    }
    grid.appendChild(article);
  });
}

function renderContactBullets(bullets) {
  const list = document.getElementById("homeContactBullets");
  if (!list) return;
  list.innerHTML = "";
  if (!Array.isArray(bullets) || !bullets.length) {
    list.hidden = true;
    return;
  }
  list.hidden = false;
  bullets.forEach((item) => {
    if (typeof item !== "string") return;
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
}

function applyHomeContent(source) {
  currentHomeContent = getResolvedHomeConfig(source);
  const { hero, highlights, about, why, contact } = currentHomeContent;
  updateText("hero.eyebrow", hero.eyebrow);
  updateText("hero.title", hero.title);
  updateText("hero.description", hero.description);
  updateList("hero.bullets", hero.bullets);
  updateCta("hero.primary", hero.primaryCta);
  updateCta("hero.secondary", hero.secondaryCta);
  updateHeroMedia(hero.media);
  renderHighlights(highlights);
  updateText("about.title", about.title);
  updateText("about.lead", about.lead);
  updateText("about.body", about.body);
  renderMilestones(about.milestones);
  updateAboutImage(about.image, about.imageAlt);
  updateText("why.title", why.title);
  updateText("why.description", why.description);
  renderWhyCards(why.cards);
  updateText("featured.title", currentHomeContent.featured?.title);
  updateText(
    "featured.description",
    currentHomeContent.featured?.description,
  );
  updateText("contact.eyebrow", contact.eyebrow);
  updateText("contact.title", contact.title);
  updateText("contact.description", contact.description);
  updateText("contact.note", contact.note);
  renderContactBullets(contact.bulletPoints);
}

function cleanLabel(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function getCatalogBrand(product) {
  if (!product) return "";
  const manual = cleanLabel(product.catalog_brand);
  if (manual) return manual;
  const brand = cleanLabel(product.brand);
  if (brand) return brand;
  const manufacturer = cleanLabel(product.manufacturer);
  if (manufacturer) return manufacturer;
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
    const label = cleanLabel(candidate);
    if (label) return label;
  }
  if (Array.isArray(product.tags)) {
    for (const tag of product.tags) {
      if (typeof tag !== "string") continue;
      if (tag.includes(":")) {
        const [, value] = tag.split(":").map((token) => cleanLabel(token));
        if (value) return value;
      } else {
        const fallback = cleanLabel(tag);
        if (fallback) return fallback;
      }
    }
  }
  return "";
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
  return "Descripción no disponible.";
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

function resolveRoleState() {
  const role = getUserRole();
  if (!role) return "guest";
  if (role === "mayorista" || role === "admin" || role === "vip") {
    return "wholesale";
  }
  return "retail";
}

function addToCart(product, quantity = 1) {
  const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
  const existing = cart.find((item) => item.id === product.id);
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const available =
    typeof product.stock === "number" && product.stock >= 0
      ? product.stock
      : Infinity;
  if (existing) {
    if (existing.quantity + qty > available) {
      existing.quantity = available;
    } else {
      existing.quantity += qty;
    }
  } else {
    const price = isWholesale()
      ? product.price_mayorista
      : product.price_minorista;
    cart.push({
      id: product.id,
      name: product.name,
      price,
      quantity: Math.min(qty, available),
      image: getPrimaryImage(product) || PLACEHOLDER_IMAGE,
    });
  }
  localStorage.setItem("nerinCart", JSON.stringify(cart));
  if (window.updateNav) window.updateNav();
  if (window.showCartIndicator) {
    window.showCartIndicator();
  } else if (window.showToast) {
    window.showToast("✅ Producto agregado al carrito");
  }
}

function getPrimaryImage(product) {
  if (Array.isArray(product?.images) && product.images.length) {
    return product.images[0];
  }
  return product?.image;
}

function createPriceTier(label, value, note, modifier, options = {}) {
  const tier = document.createElement("div");
  tier.className = `price-tier ${modifier || ""}`.trim();
  if (options.locked) {
    tier.dataset.locked = "true";
  }
  const labelEl = document.createElement("span");
  labelEl.className = "price-tier__label";
  labelEl.textContent = label;
  tier.appendChild(labelEl);
  const valueEl = document.createElement("span");
  valueEl.className = "price-tier__value";
  valueEl.textContent = options.locked
    ? options.placeholder || "Ingresá para ver"
    : formatCurrency(value);
  tier.appendChild(valueEl);
  if (note) {
    const noteEl = document.createElement("span");
    noteEl.className = "price-tier__note";
    noteEl.textContent = note;
    tier.appendChild(noteEl);
  }
  return { tier, valueEl };
}

function buildProductUrl(product) {
  if (product && typeof product.slug === "string") {
    const slug = product.slug.trim();
    if (slug) return `/p/${encodeURIComponent(slug)}`;
  }
  const id = product?.id != null ? String(product.id) : "";
  return `/product.html?id=${encodeURIComponent(id)}`;
}

function createFeaturedCard(product) {
  const card = document.createElement("article");
  card.className = "product-card";
  card.setAttribute("role", "listitem");
  const cover = getPrimaryImage(product);
  const img = document.createElement("img");
  img.src = cover || PLACEHOLDER_IMAGE;
  img.alt = product.name || getCatalogModel(product) || "Producto";
  card.appendChild(img);

  const meta = document.createElement("div");
  meta.className = "product-meta";
  if (product.sku) {
    const sku = document.createElement("span");
    sku.className = "sku";
    sku.textContent = product.sku;
    meta.appendChild(sku);
  }
  const brand = getCatalogBrand(product);
  const model = getCatalogModel(product);
  if (brand || model) {
    const modelChip = document.createElement("span");
    modelChip.className = "chip";
    modelChip.textContent = [brand, model].filter(Boolean).join(" · ");
    meta.appendChild(modelChip);
  }
  const part = getPartKey(product);
  if (part) {
    const partChip = document.createElement("span");
    partChip.className = "chip";
    partChip.textContent = part;
    meta.appendChild(partChip);
  }
  if (meta.childElementCount > 0) {
    card.appendChild(meta);
  }

  const title = document.createElement("h3");
  title.textContent = product.name || `${brand} ${model}`.trim();
  card.appendChild(title);

  const desc = document.createElement("p");
  desc.className = "description";
  const descriptionText = getProductDescription(product);
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
  } else if (status === "in" && typeof product.stock === "number") {
    availability.appendChild(
      createAvailabilityBadge(`Stock: ${product.stock} u.`, "in"),
    );
  }
  if (product.vip_only) {
    availability.appendChild(createAvailabilityBadge("Exclusivo VIP", "vip"));
  }
  if (availability.childElementCount > 0) {
    card.appendChild(availability);
  }

  const priceBlock = document.createElement("div");
  priceBlock.className = "price-block";
  const wholesaleUser = isWholesale();
  const roleState = resolveRoleState();
  const retailTier = createPriceTier(
    "Minorista",
    product.price_minorista,
    roleState === "wholesale"
      ? "Referencia minorista para tu cliente final"
      : "Precio final sugerido",
    "price-tier--retail",
  );
  const wholesaleTier = createPriceTier(
    "Mayorista",
    product.price_mayorista,
    wholesaleUser
      ? "Descuentos automáticos por volumen"
      : "Exclusivo para cuentas verificadas",
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

  const actions = document.createElement("div");
  actions.className = "product-actions";
  const more = document.createElement("a");
  more.href = buildProductUrl(product);
  more.className = "button secondary";
  more.textContent = "Ver detalle";
  actions.appendChild(more);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "button primary";
  addBtn.textContent = "Agregar";
  addBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    addToCart(product, 1);
    addBtn.textContent = "Añadido";
    setTimeout(() => {
      addBtn.textContent = "Agregar";
    }, 1600);
  });
  actions.appendChild(addBtn);
  card.appendChild(actions);

  card.addEventListener("click", (event) => {
    if (
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLAnchorElement
    ) {
      return;
    }
    window.location.href = buildProductUrl(product);
  });

  return card;
}

function resolveFeaturedProducts(products, ids) {
  if (!Array.isArray(products) || !products.length) return [];
  const byId = new Map();
  const uniqueProducts = [];
  products.forEach((product) => {
    if (!product || product.id == null) return;
    const key = String(product.id);
    if (byId.has(key)) return;
    byId.set(key, product);
    uniqueProducts.push(product);
  });

  if (Array.isArray(ids) && ids.length) {
    const seen = new Set();
    const selected = [];
    ids.forEach((id) => {
      const key = String(id);
      if (seen.has(key)) return;
      const product = byId.get(key);
      if (!product) return;
      seen.add(key);
      selected.push(product);
    });
    if (selected.length) {
      return selected.slice(0, 6);
    }
  }

  return uniqueProducts.slice(0, 4);
}

let featuredLoadVersion = 0;

async function loadFeatured() {
  const container = document.getElementById("featuredGrid");
  if (!container) return;
  const requestVersion = ++featuredLoadVersion;
  container.innerHTML = "";
  try {
    const products = await fetchProducts();
    if (requestVersion !== featuredLoadVersion) return;
    const selection = resolveFeaturedProducts(
      products,
      currentHomeContent.featured?.productIds,
    );
    if (!selection.length) {
      if (requestVersion !== featuredLoadVersion) return;
      container.innerHTML = "<p>Sin productos destacados por el momento.</p>";
      return;
    }
    if (requestVersion !== featuredLoadVersion) return;
    selection.forEach((product) => {
      container.appendChild(createFeaturedCard(product));
    });
  } catch (error) {
    console.error("featured-load", error);
    if (requestVersion !== featuredLoadVersion) return;
    container.textContent = "No se pudieron cargar los productos.";
  }
}

function resolveWhatsAppNumber() {
  const cfg = window.NERIN_CONFIG || {};
  if (cfg.whatsappNumberSanitized) {
    return cfg.whatsappNumberSanitized;
  }
  if (typeof cfg.whatsappNumber === "string") {
    const sanitized = cfg.whatsappNumber.replace(/[^0-9]/g, "");
    if (sanitized) return sanitized;
  }
  return "541112345678";
}

function setupContactForm() {
  const form = document.getElementById("contactForm");
  if (!form) return;
  const nameField = document.getElementById("contactName");
  const modelField = document.getElementById("contactModel");
  const quantityField = document.getElementById("contactQuantity");
  const urgencyField = document.getElementById("contactUrgency");
  const messageField = document.getElementById("contactMessage");
  const feedback = document.getElementById("contactFeedback");

  const setFeedback = (text, state) => {
    if (!feedback) return;
    feedback.textContent = text;
    if (state) {
      feedback.dataset.state = state;
    } else {
      feedback.removeAttribute("data-state");
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    setFeedback("", null);
    if (!form.reportValidity()) {
      return;
    }
    const nameValue = nameField.value.trim();
    const modelValue = modelField.value.trim();
    if (!modelValue) {
      setFeedback("Indicanos el modelo exacto (ej.: SM-A546).", "error");
      modelField.focus();
      return;
    }
    const roleInput = form.querySelector('input[name="contactRole"]:checked');
    const roleLabel =
      roleInput?.nextElementSibling?.textContent?.trim() || "Técnico";
    const quantityValue = parseInt(quantityField.value, 10) || 1;
    const urgencyText =
      urgencyField.options[urgencyField.selectedIndex]?.text?.trim() ||
      urgencyField.value;
    const extraMessage = messageField.value.trim();

    const parts = [
      `Hola. Soy ${nameValue}.`,
      `Perfil: ${roleLabel}.`,
      `Modelo: ${modelValue}.`,
      `Cantidad: ${quantityValue}.`,
      `Urgencia: ${urgencyText}.`,
    ];
    if (extraMessage) {
      parts.push(`Detalle: ${extraMessage}.`);
    }
    const message = encodeURIComponent(parts.join(" "));
    const url = `https://api.whatsapp.com/send?phone=${resolveWhatsAppNumber()}&text=${message}`;
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    if (popup) {
      popup.opener = null;
    }
    form.reset();
    quantityField.value = "1";
    const defaultRole = form.querySelector('input[name="contactRole"][value="tecnico"]');
    if (defaultRole) defaultRole.checked = true;
    setFeedback("Listo. Te respondemos por WhatsApp hoy mismo.", "success");
  });
}

const POPUP_STORAGE_KEY = "nerinHomePopupDismissed";

function readPopupState() {
  try {
    const raw = localStorage.getItem(POPUP_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn("popup-storage-read", err);
    return null;
  }
}

function writePopupState(state) {
  try {
    localStorage.setItem(POPUP_STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("popup-storage-write", err);
  }
}

function hidePopup() {
  const overlay = document.getElementById("homePopup");
  if (!overlay) return;
  overlay.hidden = true;
  if (overlay.dataset.popupVersion) {
    writePopupState({
      version: overlay.dataset.popupVersion,
      timestamp: Date.now(),
    });
  }
}

function showPopupIfNeeded() {
  const overlay = document.getElementById("homePopup");
  const img = document.getElementById("homePopupImage");
  const link = document.getElementById("homePopupLink");
  if (!overlay || !img || !link) return;
  const popup = currentHomeContent.popup;
  if (!popup || !popup.enabled || !popup.image) {
    overlay.hidden = true;
    return;
  }
  const versionKey = `${popup.image}|${popup.link || ""}`;
  const stored = readPopupState();
  const frequencyHours = Number(popup.frequencyHours) || 24;
  if (
    stored &&
    stored.version === versionKey &&
    Date.now() - stored.timestamp < frequencyHours * 60 * 60 * 1000
  ) {
    overlay.hidden = true;
    return;
  }
  img.src = popup.image;
  img.alt = popup.alt || "Novedades NERIN";
  if (popup.link) {
    link.href = popup.link;
    link.target = "_blank";
    link.rel = "noopener";
    link.tabIndex = 0;
    link.style.pointerEvents = "auto";
  } else {
    link.removeAttribute("href");
    link.removeAttribute("target");
    link.removeAttribute("rel");
    link.tabIndex = -1;
    link.style.pointerEvents = "none";
  }
  overlay.dataset.popupVersion = versionKey;
  overlay.hidden = false;
}

function initPopupListeners() {
  const overlay = document.getElementById("homePopup");
  if (!overlay) return;
  const closeBtn = overlay.querySelector("[data-home-popup-close]");
  if (closeBtn) {
    closeBtn.addEventListener("click", hidePopup);
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      hidePopup();
    }
  });
}

document.addEventListener("nerin:config-loaded", (event) => {
  applyHomeContent(event.detail);
  loadFeatured();
  showPopupIfNeeded();
});

document.addEventListener("DOMContentLoaded", () => {
  applyHomeContent();
  setupContactForm();
  initPopupListeners();
  loadFeatured();
  showPopupIfNeeded();
});

