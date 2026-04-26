/*
 * Lógica del panel de administración de NERIN.
 *
 * Este módulo gestiona la navegación entre secciones (productos, pedidos,
 * clientes y métricas), solicita datos al backend y permite
 * crear/editar/eliminar productos y actualizar estados de pedidos.
 */

import { apiFetch, getUserRole, logout } from "./api.js";
import { renderAnalyticsDashboard } from "./analytics.js";
import { applySeoDefaults, buildSeoForProduct } from "./seo-helpers.js";

const ADMIN_BUILD_FALLBACK =
  (typeof window !== "undefined" && window.__NERIN_ADMIN_BUILD__) || "dev";

if (typeof window !== "undefined" && !window.__NERIN_ADMIN_BUILD__) {
  window.__NERIN_ADMIN_BUILD__ = ADMIN_BUILD_FALLBACK;
}

async function logAdminBuildVersion() {
  let buildId = ADMIN_BUILD_FALLBACK;
  try {
    const res = await apiFetch("/api/version", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && data.build) {
        buildId = data.build;
        if (typeof window !== "undefined") {
          window.__NERIN_ADMIN_BUILD__ = data.build;
        }
      }
    }
  } catch (err) {
    console.warn("admin-version-fetch-failed", err);
  }
  if (typeof window !== "undefined") {
    window.__NERIN_ADMIN_BUILD__ = buildId;
  }
  if (typeof document !== "undefined") {
    const banner = document.getElementById("admin-build-banner");
    if (banner) {
      banner.textContent = `Build: ${buildId || "dev"} • Multi-images: ON`;
    }
  }
  console.info("admin-js-version", buildId);
  console.log("[admin-build]", buildId, { multiImages: true });
}

logAdminBuildVersion();

// Verificar rol de administrador o vendedor
const currentRole = getUserRole();
if (currentRole !== "admin" && currentRole !== "vendedor") {
  // Si no es ninguno de los roles permitidos, redirigir al login
  window.location.href = "/login.html";
}

// Ocultar secciones no permitidas para vendedores
if (currentRole === "vendedor") {
  // Los vendedores no pueden ver clientes, métricas, devoluciones ni configuración
  const buttonsToHide = [
    "clientsSection",
    "wholesaleSection",
    "metricsSection",
    "returnsSection",
    "homeSection",
    "configSection",
    "paymentSettingsSection",
    "suppliersSection",
    "purchaseOrdersSection",
    "shippingSection",
    "analyticsSection",
  ];
  buttonsToHide.forEach((sectionId) => {
    const btn = document.querySelector(
      `.admin-nav button[data-target="${sectionId}"]`,
    );
    const sectionEl = document.getElementById(sectionId);
    if (btn) btn.style.display = "none";
    if (sectionEl) sectionEl.style.display = "none";
  });
  // Ajustar título descriptivo para el vendedor
  const title = document.querySelector(".admin-container h2");
  if (title) title.textContent = "Panel de vendedor";
}

// Navegación entre secciones
const navButtons = document.querySelectorAll(".admin-nav button");
const sections = document.querySelectorAll(".admin-section");
const analyticsSection = document.getElementById("analyticsSection");
const ANALYTICS_REFRESH_INTERVAL_MS = 30 * 1000;
let analyticsRefreshTimer = null;
let analyticsAutoRefreshMs = null;
let analyticsLoading = false;

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    // Cambiar botón activo
    navButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    // Mostrar sección correspondiente
    const target = btn.getAttribute("data-target");
    sections.forEach((sec) => {
      sec.style.display = sec.id === target ? "block" : "none";
    });
    if (target === "analyticsSection") {
      startAnalyticsAutoRefresh();
    } else {
      stopAnalyticsAutoRefresh();
    }
    // Cargar datos según sección
    if (target === "productsSection") {
      loadProducts();
    } else if (target === "ordersSection") {
      OrdersUI.init();
    } else if (target === "clientsSection") {
      loadClients();
    } else if (target === "wholesaleSection") {
      loadWholesaleRequests();
    } else if (target === "metricsSection") {
      loadMetrics();
    } else if (target === "returnsSection") {
      loadReturns();
    } else if (target === "homeSection") {
      loadHomeForm();
    } else if (target === "configSection") {
      loadConfigForm();
    } else if (target === "paymentSettingsSection") {
      if (!shippingMethods.length) {
        loadShippingTable().finally(loadPaymentSettingsAdmin);
      } else {
        loadPaymentSettingsAdmin();
      }
    } else if (target === "suppliersSection") {
      loadSuppliers();
    } else if (target === "purchaseOrdersSection") {
      loadPurchaseOrders();
    } else if (target === "shippingSection") {
      loadShippingTable();
    } else if (target === "partnersSection") {
      loadPartnersAdmin();
    } else if (target === "referralsSection") {
      loadReferralsAdmin();
    } else if (target === "reviewsSection") {
      loadReviewsAdmin();
    } else if (target === "auditSection") {
      loadAuditAdmin();
    }
  });
});

function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compactText(value, maxLength = 72) {
  if (value == null) return "";
  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(8, maxLength - 1)).trimEnd()}…`;
}

function getAdminHeaders(extra = {}) {
  return { ...extra };
}

function cleanLabel(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function resolveCatalogBrand(product = {}) {
  const manual = cleanLabel(product.catalog_brand);
  if (manual) return manual;
  return cleanLabel(product.brand);
}

function resolveCatalogModel(product = {}) {
  const manual = cleanLabel(product.catalog_model);
  if (manual) return manual;
  const model = cleanLabel(product.model);
  if (model) return model;
  return cleanLabel(product.subcategory);
}

function resolveCatalogPiece(product = {}) {
  const manual = cleanLabel(product.catalog_piece);
  if (manual) return manual;
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
      const [, value] = tag.split(":");
      const fallback = value || tag;
      const label = cleanLabel(fallback);
      if (label) return label;
    }
  }
  return "";
}

function formatDateTimeDisplay(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatDateDisplay(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-AR", { dateStyle: "medium" });
}

function renderNullable(value) {
  return value ? escapeHtml(value) : "—";
}

function renderLink(value) {
  if (!value) return "—";
  const trimmed = String(value).trim();
  if (!trimmed) return "—";
  let href = trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    href = `https://${trimmed}`;
  }
  try {
    const safeUrl = new URL(href);
    return `<a href="${safeUrl.toString()}" target="_blank" rel="noopener">${escapeHtml(trimmed)}</a>`;
  } catch (err) {
    return escapeHtml(trimmed);
  }
}

// ------------ Home content editor ------------
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

function getValueByPath(obj, path) {
  if (!path) return undefined;
  return path.split(".").reduce((acc, segment) => {
    if (acc == null) return undefined;
    const key = /^\d+$/.test(segment) ? Number(segment) : segment;
    return acc[key];
  }, obj);
}

function setValueByPath(obj, path, value) {
  if (!path) return;
  const parts = path.split(".");
  let target = obj;
  parts.forEach((segment, index) => {
    const isLast = index === parts.length - 1;
    const key = /^\d+$/.test(segment) ? Number(segment) : segment;
    if (isLast) {
      target[key] = value;
      return;
    }
    if (target[key] == null || typeof target[key] !== "object") {
      const nextKey = parts[index + 1];
      target[key] = /^\d+$/.test(nextKey) ? [] : {};
    }
    target = target[key];
  });
}

function moveArrayItem(array, fromIndex, toIndex) {
  if (!Array.isArray(array)) return;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= array.length || toIndex >= array.length) {
    return;
  }
  const [item] = array.splice(fromIndex, 1);
  array.splice(toIndex, 0, item);
}

const HOME_DEFAULTS = {
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
        description: "Las restricciones de importación nos obligan a pausar operaciones y replantear el modelo.",
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

const HIGHLIGHTS_LIMIT = 4;
const MILESTONES_LIMIT = 6;
const WHY_LIMIT = 6;
const CONTACT_BULLETS_LIMIT = 6;
const FEATURED_LIMIT = 6;

let homeContent = deepClone(HOME_DEFAULTS);
let homeProducts = [];
let homeProductsLoaded = false;

const homeForm = document.getElementById("homeContentForm");
const homeHighlightsContainer = document.getElementById("homeHighlightsAdmin");
const homeAddHighlightBtn = document.getElementById("homeAddHighlight");
const homeMilestonesContainer = document.getElementById("homeMilestonesAdmin");
const homeAddMilestoneBtn = document.getElementById("homeAddMilestone");
const homeWhyContainer = document.getElementById("homeWhyAdmin");
const homeAddWhyBtn = document.getElementById("homeAddWhy");
const homeContactBulletsContainer = document.getElementById("homeContactBulletsAdmin");
const homeAddContactBulletBtn = document.getElementById("homeAddContactBullet");
const homeFeaturedList = document.getElementById("homeFeaturedList");
const homeFeaturedSearch = document.getElementById("homeFeaturedSearch");

function ensureHomeStructures(target = homeContent) {
  const content = target || {};
  content.hero = content.hero || {};
  if (!Array.isArray(content.hero.bullets)) content.hero.bullets = [];
  if (!Array.isArray(content.highlights)) content.highlights = [];
  content.about = content.about || {};
  if (!Array.isArray(content.about.milestones)) content.about.milestones = [];
  content.why = content.why || {};
  if (!Array.isArray(content.why.cards)) content.why.cards = [];
  content.contact = content.contact || {};
  if (!Array.isArray(content.contact.bulletPoints)) content.contact.bulletPoints = [];
  content.featured = content.featured || {};
  if (!Array.isArray(content.featured.productIds)) {
    content.featured.productIds = [];
  } else {
    content.featured.productIds = content.featured.productIds.map((id) => String(id));
  }
  content.popup = content.popup || {};
  if (target === homeContent) {
    homeContent = content;
  }
  return content;
}

function refreshHomePreviews() {
  if (!homeForm) return;
  homeForm.querySelectorAll("[data-home-preview]").forEach((img) => {
    const path = img.dataset.homePreview;
    const value = getValueByPath(homeContent, path);
    if (typeof value === "string" && value.trim()) {
      img.src = value;
      img.style.display = "block";
    } else {
      img.removeAttribute("src");
      img.style.display = "none";
    }
  });
}

function createMoveButton(direction, index, length) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "home-repeat-move";
  btn.dataset.action = direction === "up" ? "move-up" : "move-down";
  btn.textContent = direction === "up" ? "↑" : "↓";
  if ((direction === "up" && index === 0) || (direction === "down" && index === length - 1)) {
    btn.disabled = true;
  }
  return btn;
}

function createRemoveButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "home-repeat-remove";
  btn.dataset.action = "remove";
  btn.textContent = "Eliminar";
  return btn;
}

function renderHighlightsEditor() {
  if (!homeHighlightsContainer) return;
  ensureHomeStructures();
  const items = Array.isArray(homeContent.highlights) ? homeContent.highlights : [];
  homeHighlightsContainer.innerHTML = "";
  items.forEach((item, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "home-repeat-item";
    wrapper.dataset.index = String(index);
    const header = document.createElement("div");
    header.className = "home-repeat-item__header";
    const label = document.createElement("strong");
    label.textContent = `Bloque ${index + 1}`;
    header.appendChild(label);
    const actions = document.createElement("div");
    actions.className = "home-repeat-item__actions";
    actions.appendChild(createMoveButton("up", index, items.length));
    actions.appendChild(createMoveButton("down", index, items.length));
    actions.appendChild(createRemoveButton());
    header.appendChild(actions);
    wrapper.appendChild(header);

    const iconLabel = document.createElement("label");
    iconLabel.textContent = "Icono (emoji)";
    const iconInput = document.createElement("input");
    iconInput.type = "text";
    iconInput.name = "icon";
    iconInput.maxLength = 4;
    iconInput.value = item.icon || "";
    iconLabel.appendChild(iconInput);
    wrapper.appendChild(iconLabel);

    const titleLabel = document.createElement("label");
    titleLabel.textContent = "Título";
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.name = "title";
    titleInput.value = item.title || "";
    titleLabel.appendChild(titleInput);
    wrapper.appendChild(titleLabel);

    const descLabel = document.createElement("label");
    descLabel.textContent = "Descripción";
    const descInput = document.createElement("textarea");
    descInput.name = "description";
    descInput.rows = 2;
    descInput.value = item.description || "";
    descLabel.appendChild(descInput);
    wrapper.appendChild(descLabel);

    homeHighlightsContainer.appendChild(wrapper);
  });
  if (homeAddHighlightBtn) {
    homeAddHighlightBtn.disabled = items.length >= HIGHLIGHTS_LIMIT;
  }
}

function renderMilestonesEditor() {
  if (!homeMilestonesContainer) return;
  ensureHomeStructures();
  const items = Array.isArray(homeContent.about.milestones)
    ? homeContent.about.milestones
    : [];
  homeMilestonesContainer.innerHTML = "";
  items.forEach((item, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "home-repeat-item";
    wrapper.dataset.index = String(index);
    const header = document.createElement("div");
    header.className = "home-repeat-item__header";
    const label = document.createElement("strong");
    label.textContent = `Hito ${index + 1}`;
    header.appendChild(label);
    const actions = document.createElement("div");
    actions.className = "home-repeat-item__actions";
    actions.appendChild(createMoveButton("up", index, items.length));
    actions.appendChild(createMoveButton("down", index, items.length));
    actions.appendChild(createRemoveButton());
    header.appendChild(actions);
    wrapper.appendChild(header);

    const yearLabel = document.createElement("label");
    yearLabel.textContent = "Título";
    const yearInput = document.createElement("input");
    yearInput.type = "text";
    yearInput.name = "title";
    yearInput.value = item.title || "";
    yearLabel.appendChild(yearInput);
    wrapper.appendChild(yearLabel);

    const descLabel = document.createElement("label");
    descLabel.textContent = "Descripción";
    const descInput = document.createElement("textarea");
    descInput.name = "description";
    descInput.rows = 2;
    descInput.value = item.description || "";
    descLabel.appendChild(descInput);
    wrapper.appendChild(descLabel);

    homeMilestonesContainer.appendChild(wrapper);
  });
  if (homeAddMilestoneBtn) {
    homeAddMilestoneBtn.disabled = items.length >= MILESTONES_LIMIT;
  }
}

function renderWhyEditor() {
  if (!homeWhyContainer) return;
  ensureHomeStructures();
  const items = Array.isArray(homeContent.why.cards) ? homeContent.why.cards : [];
  homeWhyContainer.innerHTML = "";
  items.forEach((item, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "home-repeat-item";
    wrapper.dataset.index = String(index);
    const header = document.createElement("div");
    header.className = "home-repeat-item__header";
    const label = document.createElement("strong");
    label.textContent = `Tarjeta ${index + 1}`;
    header.appendChild(label);
    const actions = document.createElement("div");
    actions.className = "home-repeat-item__actions";
    actions.appendChild(createMoveButton("up", index, items.length));
    actions.appendChild(createMoveButton("down", index, items.length));
    actions.appendChild(createRemoveButton());
    header.appendChild(actions);
    wrapper.appendChild(header);

    const titleLabel = document.createElement("label");
    titleLabel.textContent = "Título";
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.name = "title";
    titleInput.value = item.title || "";
    titleLabel.appendChild(titleInput);
    wrapper.appendChild(titleLabel);

    const descLabel = document.createElement("label");
    descLabel.textContent = "Descripción";
    const descInput = document.createElement("textarea");
    descInput.name = "description";
    descInput.rows = 2;
    descInput.value = item.description || "";
    descLabel.appendChild(descInput);
    wrapper.appendChild(descLabel);

    const imageLabel = document.createElement("label");
    imageLabel.textContent = "Imagen (URL)";
    const imageInput = document.createElement("input");
    imageInput.type = "text";
    imageInput.name = "image";
    imageInput.dataset.homePath = `why.cards.${index}.image`;
    imageInput.value = item.image || "";
    imageLabel.appendChild(imageInput);
    wrapper.appendChild(imageLabel);

    const uploadLabel = document.createElement("label");
    uploadLabel.className = "home-admin-upload-control";
    uploadLabel.textContent = "Subir imagen";
    const uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.accept = "image/*";
    uploadInput.dataset.homeUpload = `why.cards.${index}.image`;
    uploadLabel.appendChild(uploadInput);
    wrapper.appendChild(uploadLabel);

    const preview = document.createElement("img");
    preview.dataset.homePreview = `why.cards.${index}.image`;
    preview.alt = `Vista previa tarjeta ${index + 1}`;
    wrapper.appendChild(preview);

    homeWhyContainer.appendChild(wrapper);
  });
  if (homeAddWhyBtn) {
    homeAddWhyBtn.disabled = items.length >= WHY_LIMIT;
  }
  refreshHomePreviews();
}

function renderContactBulletsEditor() {
  if (!homeContactBulletsContainer) return;
  ensureHomeStructures();
  const items = Array.isArray(homeContent.contact.bulletPoints)
    ? homeContent.contact.bulletPoints
    : [];
  homeContactBulletsContainer.innerHTML = "";
  items.forEach((item, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "home-repeat-item";
    wrapper.dataset.index = String(index);
    const header = document.createElement("div");
    header.className = "home-repeat-item__header";
    const label = document.createElement("strong");
    label.textContent = `Beneficio ${index + 1}`;
    header.appendChild(label);
    const actions = document.createElement("div");
    actions.className = "home-repeat-item__actions";
    actions.appendChild(createMoveButton("up", index, items.length));
    actions.appendChild(createMoveButton("down", index, items.length));
    actions.appendChild(createRemoveButton());
    header.appendChild(actions);
    wrapper.appendChild(header);

    const textLabel = document.createElement("label");
    textLabel.textContent = "Texto";
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.name = "value";
    textInput.value = item || "";
    textLabel.appendChild(textInput);
    wrapper.appendChild(textLabel);

    homeContactBulletsContainer.appendChild(wrapper);
  });
  if (homeAddContactBulletBtn) {
    homeAddContactBulletBtn.disabled = items.length >= CONTACT_BULLETS_LIMIT;
  }
}

function renderFeaturedProducts() {
  if (!homeFeaturedList) return;
  const filter = homeFeaturedSearch?.value?.trim().toLowerCase() || "";
  ensureHomeStructures();
  const selectedIds = Array.isArray(homeContent.featured.productIds)
    ? homeContent.featured.productIds
    : [];
  const productList = Array.isArray(homeProducts) ? homeProducts : [];
  homeFeaturedList.innerHTML = "";
  if (!productList.length) {
    homeFeaturedList.innerHTML =
      '<p class="home-admin-empty">No hay productos cargados.</p>';
    return;
  }
  const filtered = productList
    .filter((product) => {
      if (!filter) return true;
      const haystack = [
        product.sku,
        product.name,
        product.brand,
        product.model,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(filter);
    })
    .sort((a, b) => {
      const aIndex = selectedIds.indexOf(String(a.id));
      const bIndex = selectedIds.indexOf(String(b.id));
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });

  if (!filtered.length) {
    homeFeaturedList.innerHTML =
      '<p class="home-admin-empty">No se encontraron productos.</p>';
    return;
  }

  filtered.forEach((product) => {
    const id = String(product.id);
    const isSelected = selectedIds.includes(id);
    const row = document.createElement("div");
    row.className = `home-admin-product-row ${isSelected ? "is-selected" : ""}`.trim();
    row.dataset.productId = id;

    const label = document.createElement("label");
    label.className = "home-admin-product-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.productId = id;
    checkbox.checked = isSelected;
    label.appendChild(checkbox);
    const text = document.createElement("span");
    const parts = [];
    if (product.sku) parts.push(`<strong>${product.sku}</strong>`);
    if (product.brand) parts.push(`<span>${product.brand}</span>`);
    parts.push(product.name || "");
    text.innerHTML = parts.join(" · ").trim();
    label.appendChild(text);
    row.appendChild(label);

    if (isSelected) {
      const order = document.createElement("span");
      order.className = "home-admin-product-order";
      order.textContent = `#${selectedIds.indexOf(id) + 1}`;
      row.appendChild(order);
      const actions = document.createElement("div");
      actions.className = "home-admin-product-actions";
      const upBtn = createMoveButton("up", selectedIds.indexOf(id), selectedIds.length);
      upBtn.dataset.action = "move-up";
      upBtn.dataset.productId = id;
      const downBtn = createMoveButton("down", selectedIds.indexOf(id), selectedIds.length);
      downBtn.dataset.action = "move-down";
      downBtn.dataset.productId = id;
      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      row.appendChild(actions);
    }

    homeFeaturedList.appendChild(row);
  });
}

function sanitizeHomePayload(raw) {
  const payload = ensureHomeStructures(deepClone(raw));
  const trimNode = (node) => {
    if (Array.isArray(node)) {
      return node
        .map((item) => trimNode(item))
        .filter((item) => item !== "" && item != null);
    }
    if (isPlainObject(node)) {
      const output = {};
      Object.entries(node).forEach(([key, value]) => {
        const cleaned = trimNode(value);
        if (cleaned !== undefined) {
          output[key] = cleaned;
        }
      });
      return output;
    }
    if (typeof node === "string") {
      return node.trim();
    }
    return node;
  };
  const cleaned = trimNode(payload);
  cleaned.popup.frequencyHours = Number(cleaned.popup.frequencyHours) || 24;
  cleaned.featured.productIds = Array.isArray(cleaned.featured.productIds)
    ? cleaned.featured.productIds.map((id) => String(id))
    : [];
  if (!Array.isArray(cleaned.hero.bullets)) cleaned.hero.bullets = [];
  if (!Array.isArray(cleaned.highlights)) cleaned.highlights = [];
  if (!Array.isArray(cleaned.about.milestones)) cleaned.about.milestones = [];
  if (!Array.isArray(cleaned.why.cards)) cleaned.why.cards = [];
  if (!Array.isArray(cleaned.contact.bulletPoints)) cleaned.contact.bulletPoints = [];
  return cleaned;
}

async function ensureHomeProducts(force = false) {
  if (homeProductsLoaded && !force) return;
  try {
    const res = await apiFetch("/api/products");
    if (!res.ok) throw new Error("No se pudieron obtener los productos");
    const data = await res.json();
    homeProducts = Array.isArray(data.products) ? data.products : [];
  } catch (err) {
    console.error("home-products", err);
    homeProducts = [];
  } finally {
    homeProductsLoaded = true;
  }
}

async function loadHomeForm() {
  if (!homeForm) return;
  try {
    const res = await apiFetch("/api/config");
    if (!res.ok) throw new Error("No se pudo obtener la configuración");
    const cfg = await res.json();
    homeContent = mergeDeep(HOME_DEFAULTS, cfg.homePage || {});
    ensureHomeStructures();
    populateHomeForm();
    await ensureHomeProducts(true);
    renderFeaturedProducts();
  } catch (err) {
    console.error("home-config", err);
    alert("No se pudo cargar el contenido del inicio");
  }
}

function populateHomeForm() {
  if (!homeForm) return;
  ensureHomeStructures();
  homeForm.querySelectorAll("[data-home-field]").forEach((field) => {
    const path = field.dataset.homeField;
    const format = field.dataset.homeFormat;
    const typeHint = field.dataset.homeType || field.type;
    const value = getValueByPath(homeContent, path);
    if (typeHint === "checkbox") {
      field.checked = Boolean(value);
    } else if (format === "lines") {
      field.value = Array.isArray(value) ? value.join("\n") : value || "";
    } else if (typeHint === "number") {
      field.value = value ?? "";
    } else {
      field.value = value ?? "";
    }
  });
  renderHighlightsEditor();
  renderMilestonesEditor();
  renderWhyEditor();
  renderContactBulletsEditor();
  renderFeaturedProducts();
  refreshHomePreviews();
}

function handleHomeFieldInput(event) {
  const field = event.target;
  if (!field || !field.dataset.homeField) return;
  const path = field.dataset.homeField;
  const format = field.dataset.homeFormat;
  const typeHint = field.dataset.homeType || field.type;
  if (typeHint === "checkbox") {
    setValueByPath(homeContent, path, field.checked);
  } else if (format === "lines") {
    const lines = field.value
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    setValueByPath(homeContent, path, lines);
  } else if (typeHint === "number") {
    const raw = field.value.trim();
    setValueByPath(homeContent, path, raw === "" ? "" : Number(raw));
  } else {
    setValueByPath(homeContent, path, field.value);
  }
  refreshHomePreviews();
}

async function handleHomeUploadChange(event) {
  const input = event.target;
  if (!input || !input.dataset.homeUpload || !input.files?.length) return;
  const path = input.dataset.homeUpload;
  const file = input.files[0];
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await apiFetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.filename) {
      throw new Error(data.error || "No se pudo subir el archivo");
    }
    const url = `/uploads/${encodeURIComponent(data.filename)}`;
    setValueByPath(homeContent, path, url);
    const urlInput = homeForm.querySelector(`[data-home-field="${path}"]`);
    if (urlInput) {
      urlInput.value = url;
    }
    refreshHomePreviews();
    renderWhyEditor();
  } catch (err) {
    console.error("home-upload", err);
    alert(err.message || "Error al subir el archivo");
  } finally {
    input.value = "";
  }
}

function handleHighlightInput(event) {
  const target = event.target;
  if (!target || !homeHighlightsContainer) return;
  const item = target.closest(".home-repeat-item");
  if (!item) return;
  const index = Number(item.dataset.index);
  if (!Number.isInteger(index) || !homeContent.highlights[index]) return;
  homeContent.highlights[index][target.name] = target.value;
}

function handleHighlightClick(event) {
  const action = event.target?.dataset?.action;
  if (!action) return;
  const item = event.target.closest(".home-repeat-item");
  if (!item) return;
  const index = Number(item.dataset.index);
  if (!Number.isInteger(index)) return;
  if (action === "remove") {
    homeContent.highlights.splice(index, 1);
    renderHighlightsEditor();
    return;
  }
  if (action === "move-up") {
    moveArrayItem(homeContent.highlights, index, index - 1);
    renderHighlightsEditor();
    return;
  }
  if (action === "move-down") {
    moveArrayItem(homeContent.highlights, index, index + 1);
    renderHighlightsEditor();
  }
}

function handleMilestoneInput(event) {
  const target = event.target;
  const item = target?.closest(".home-repeat-item");
  if (!item) return;
  const index = Number(item.dataset.index);
  if (!Number.isInteger(index) || !homeContent.about.milestones[index]) return;
  homeContent.about.milestones[index][target.name] = target.value;
}

function handleMilestoneClick(event) {
  const action = event.target?.dataset?.action;
  if (!action) return;
  const item = event.target.closest(".home-repeat-item");
  if (!item) return;
  const index = Number(item.dataset.index);
  if (!Number.isInteger(index)) return;
  if (action === "remove") {
    homeContent.about.milestones.splice(index, 1);
    renderMilestonesEditor();
    return;
  }
  if (action === "move-up") {
    moveArrayItem(homeContent.about.milestones, index, index - 1);
    renderMilestonesEditor();
    return;
  }
  if (action === "move-down") {
    moveArrayItem(homeContent.about.milestones, index, index + 1);
    renderMilestonesEditor();
  }
}

function handleWhyInput(event) {
  const target = event.target;
  const item = target?.closest(".home-repeat-item");
  if (!item) return;
  const index = Number(item.dataset.index);
  if (!Number.isInteger(index) || !homeContent.why.cards[index]) return;
  if (target.dataset.homePath) {
    setValueByPath(homeContent, target.dataset.homePath, target.value);
    refreshHomePreviews();
  } else {
    homeContent.why.cards[index][target.name] = target.value;
  }
}

function handleWhyClick(event) {
  const action = event.target?.dataset?.action;
  if (!action) return;
  const item = event.target.closest(".home-repeat-item");
  if (!item) return;
  const index = Number(item.dataset.index);
  if (!Number.isInteger(index)) return;
  if (action === "remove") {
    homeContent.why.cards.splice(index, 1);
    renderWhyEditor();
    return;
  }
  if (action === "move-up") {
    moveArrayItem(homeContent.why.cards, index, index - 1);
    renderWhyEditor();
    return;
  }
  if (action === "move-down") {
    moveArrayItem(homeContent.why.cards, index, index + 1);
    renderWhyEditor();
  }
}

function handleContactBulletInput(event) {
  const target = event.target;
  const item = target?.closest(".home-repeat-item");
  if (!item) return;
  const index = Number(item.dataset.index);
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= homeContent.contact.bulletPoints.length
  ) {
    return;
  }
  homeContent.contact.bulletPoints[index] = target.value;
}

function handleContactBulletClick(event) {
  const action = event.target?.dataset?.action;
  if (!action) return;
  const item = event.target.closest(".home-repeat-item");
  if (!item) return;
  const index = Number(item.dataset.index);
  if (!Number.isInteger(index)) return;
  if (action === "remove") {
    homeContent.contact.bulletPoints.splice(index, 1);
    renderContactBulletsEditor();
    return;
  }
  if (action === "move-up") {
    moveArrayItem(homeContent.contact.bulletPoints, index, index - 1);
    renderContactBulletsEditor();
    return;
  }
  if (action === "move-down") {
    moveArrayItem(homeContent.contact.bulletPoints, index, index + 1);
    renderContactBulletsEditor();
  }
}

function handleFeaturedChange(event) {
  const checkbox = event.target;
  if (!checkbox || checkbox.type !== "checkbox" || !checkbox.dataset.productId) return;
  ensureHomeStructures();
  const id = checkbox.dataset.productId;
  const list = homeContent.featured.productIds;
  if (checkbox.checked) {
    if (list.includes(id)) return;
    if (list.length >= FEATURED_LIMIT) {
      checkbox.checked = false;
      alert(`Podés elegir hasta ${FEATURED_LIMIT} productos.`);
      return;
    }
    list.push(id);
  } else {
    homeContent.featured.productIds = list.filter((value) => value !== id);
  }
  renderFeaturedProducts();
}

function handleFeaturedClick(event) {
  const action = event.target?.dataset?.action;
  if (!action || !event.target.dataset.productId) return;
  const id = event.target.dataset.productId;
  const list = homeContent.featured.productIds;
  const index = list.indexOf(id);
  if (index === -1) return;
  if (action === "move-up" && index > 0) {
    moveArrayItem(list, index, index - 1);
    renderFeaturedProducts();
  } else if (action === "move-down" && index < list.length - 1) {
    moveArrayItem(list, index, index + 1);
    renderFeaturedProducts();
  }
}

async function handleHomeSubmit(event) {
  event.preventDefault();
  if (!homeForm) return;
  try {
    const payload = sanitizeHomePayload(homeContent);
    const res = await apiFetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ homePage: payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "No se pudo guardar el inicio");
    }
    homeContent = mergeDeep(HOME_DEFAULTS, data.homePage || {});
    ensureHomeStructures();
    populateHomeForm();
    alert("Inicio actualizado correctamente");
  } catch (err) {
    console.error("home-save", err);
    alert(err.message || "Error al guardar el inicio");
  }
}

if (homeForm) {
  homeForm.addEventListener("input", handleHomeFieldInput);
  homeForm.addEventListener("change", handleHomeUploadChange);
  homeForm.addEventListener("submit", handleHomeSubmit);
}

if (homeHighlightsContainer) {
  homeHighlightsContainer.addEventListener("input", handleHighlightInput);
  homeHighlightsContainer.addEventListener("click", handleHighlightClick);
}

if (homeAddHighlightBtn) {
  homeAddHighlightBtn.addEventListener("click", () => {
    ensureHomeStructures();
    if (homeContent.highlights.length >= HIGHLIGHTS_LIMIT) {
      alert(`Podés cargar hasta ${HIGHLIGHTS_LIMIT} bloques.`);
      return;
    }
    homeContent.highlights.push({ icon: "", title: "", description: "" });
    renderHighlightsEditor();
  });
}

if (homeMilestonesContainer) {
  homeMilestonesContainer.addEventListener("input", handleMilestoneInput);
  homeMilestonesContainer.addEventListener("click", handleMilestoneClick);
}

if (homeAddMilestoneBtn) {
  homeAddMilestoneBtn.addEventListener("click", () => {
    ensureHomeStructures();
    if (homeContent.about.milestones.length >= MILESTONES_LIMIT) {
      alert(`Podés registrar hasta ${MILESTONES_LIMIT} hitos.`);
      return;
    }
    homeContent.about.milestones.push({ title: "", description: "" });
    renderMilestonesEditor();
  });
}

if (homeWhyContainer) {
  homeWhyContainer.addEventListener("input", handleWhyInput);
  homeWhyContainer.addEventListener("click", handleWhyClick);
}

if (homeAddWhyBtn) {
  homeAddWhyBtn.addEventListener("click", () => {
    ensureHomeStructures();
    if (homeContent.why.cards.length >= WHY_LIMIT) {
      alert(`Podés sumar hasta ${WHY_LIMIT} tarjetas.`);
      return;
    }
    homeContent.why.cards.push({ title: "", description: "", image: "" });
    renderWhyEditor();
  });
}

if (homeContactBulletsContainer) {
  homeContactBulletsContainer.addEventListener("input", handleContactBulletInput);
  homeContactBulletsContainer.addEventListener("click", handleContactBulletClick);
}

if (homeAddContactBulletBtn) {
  homeAddContactBulletBtn.addEventListener("click", () => {
    ensureHomeStructures();
    if (homeContent.contact.bulletPoints.length >= CONTACT_BULLETS_LIMIT) {
      alert(`Podés listar hasta ${CONTACT_BULLETS_LIMIT} beneficios.`);
      return;
    }
    homeContent.contact.bulletPoints.push("");
    renderContactBulletsEditor();
  });
}

if (homeFeaturedList) {
  homeFeaturedList.addEventListener("change", handleFeaturedChange);
  homeFeaturedList.addEventListener("click", handleFeaturedClick);
}

if (homeFeaturedSearch) {
  homeFeaturedSearch.addEventListener("input", () => {
    renderFeaturedProducts();
  });
}

function formatMultiline(value) {
  if (!value) return "—";
  return escapeHtml(String(value)).replace(/\n/g, "<br />");
}

function formatList(items = []) {
  const filtered = items.filter(Boolean);
  if (filtered.length === 0) return "";
  if (filtered.length === 1) return filtered[0];
  if (filtered.length === 2) return `${filtered[0]} y ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(", ")} y ${filtered[filtered.length - 1]}`;
}

const currentAdminActor = {
  name: (typeof localStorage !== "undefined" && localStorage.getItem("nerinUserName")) || "Administrador",
  email: (typeof localStorage !== "undefined" && localStorage.getItem("nerinUserEmail")) || "",
};

const ACCOUNT_DOCUMENT_KEYS = ["afip", "iva", "bank", "agreement"];
const ACCOUNT_DOCUMENT_LABELS = {
  afip: {
    title: "Constancia AFIP",
    description: "Última constancia de inscripción del contribuyente.",
  },
  iva: {
    title: "Padrón IVA",
    description: "Certificado necesario para facturación exenta o M.",
  },
  bank: {
    title: "Datos bancarios",
    description: "CBU/CVU para devoluciones y notas de crédito.",
  },
  agreement: {
    title: "Contrato de revendedor",
    description: "Contrato firmado digitalmente por el responsable.",
  },
};

const ACCOUNT_DOCUMENT_STATUS_OPTIONS = [
  { value: "pending", label: "Pendiente" },
  { value: "submitted", label: "En revisión" },
  { value: "approved", label: "Aprobado" },
  { value: "rejected", label: "Rechazado" },
];

const ACCOUNT_DOCUMENT_STATUS_META = {
  pending: { tone: "muted" },
  submitted: { tone: "info" },
  approved: { tone: "success" },
  rejected: { tone: "danger" },
};

const clientDocumentsModal = document.getElementById("clientDocumentsModal");
const clientDocumentsTitle = document.getElementById("clientDocumentsTitle");
const clientDocumentsSubtitle = document.getElementById("clientDocumentsSubtitle");
const clientDocumentsBody = document.getElementById("clientDocumentsBody");
const clientDocumentsRefreshBtn = document.getElementById("refreshClientDocumentsBtn");
const clientDocumentsCloseBtn = document.getElementById("closeClientDocumentsBtn");

const clientDocumentsState = {
  email: null,
  name: null,
  record: null,
  loading: false,
};

function getCurrentActor() {
  const actor = { ...currentAdminActor };
  if (!actor.name) actor.name = "Administrador";
  if (!actor.email) delete actor.email;
  return actor;
}

function closeClientDocumentsModal() {
  if (!clientDocumentsModal) return;
  clientDocumentsModal.classList.add("hidden");
  clientDocumentsModal.dataset.email = "";
  clientDocumentsState.email = null;
  clientDocumentsState.name = null;
  clientDocumentsState.record = null;
}

function getDocumentStatusLabel(value) {
  const option = ACCOUNT_DOCUMENT_STATUS_OPTIONS.find((item) => item.value === value);
  return option ? option.label : value || "Pendiente";
}

function renderClientDocuments() {
  if (!clientDocumentsBody) return;
  const record = clientDocumentsState.record;
  if (!record) {
    clientDocumentsBody.innerHTML = '<p class="modal-empty">Sin documentos registrados.</p>';
    return;
  }
  const documents = record.documents || {};
  const grid = document.createElement("div");
  grid.className = "client-documents-grid";

  ACCOUNT_DOCUMENT_KEYS.forEach((docKey) => {
    const meta = ACCOUNT_DOCUMENT_LABELS[docKey] || { title: docKey, description: "" };
    const entry = documents[docKey] || {};
    const status = (entry.status || "pending").toLowerCase();
    const statusMeta = ACCOUNT_DOCUMENT_STATUS_META[status] || ACCOUNT_DOCUMENT_STATUS_META.pending;
    const files = Array.isArray(entry.files) ? entry.files : [];

    const card = document.createElement("article");
    card.className = "client-doc-card";
    card.dataset.docKey = docKey;

    const filesMarkup = files
      .map((file) => {
        const uploadedAt = formatDateTimeDisplay(file.uploadedAt || file.uploaded_at || null);
        const id = escapeHtml(file.id || "");
        const url = escapeHtml(file.url || "#");
        const name = escapeHtml(file.originalName || file.name || "Archivo adjunto");
        return `
          <li>
            <a href="${url}" target="_blank" rel="noopener">${name}</a>
            <span class="doc-file-meta">${uploadedAt || "Sin fecha"}</span>
            <button type="button" class="link-button link-button--danger" data-doc-remove="${id}">
              Eliminar
            </button>
          </li>
        `;
      })
      .join("");

    card.innerHTML = `
      <div class="client-doc-card__header">
        <div>
          <h5>${escapeHtml(meta.title)}</h5>
          <p>${escapeHtml(meta.description || "")}</p>
        </div>
        <span class="doc-badge doc-badge--${statusMeta.tone}">${escapeHtml(getDocumentStatusLabel(status))}</span>
      </div>
      <div class="client-doc-card__controls">
        <label>
          <span>Estado</span>
          <select data-doc-status>
            ${ACCOUNT_DOCUMENT_STATUS_OPTIONS.map(
              (option) => `
                <option value="${option.value}" ${option.value === status ? "selected" : ""}>
                  ${escapeHtml(option.label)}
                </option>
              `,
            ).join("")}
          </select>
        </label>
        <label>
          <span>Notas para el cliente</span>
          <textarea data-doc-notes rows="2" maxlength="400">${escapeHtml(entry.notes || "")}</textarea>
        </label>
      </div>
      <div class="client-doc-card__files">
        <h6>Archivos cargados</h6>
        <ul>${filesMarkup || '<li class="empty">Sin archivos adjuntos.</li>'}</ul>
      </div>
      <div class="client-doc-card__actions">
        <button type="button" class="button primary small" data-doc-save>Guardar</button>
      </div>
    `;

    const statusSelect = card.querySelector("[data-doc-status]");
    const notesInput = card.querySelector("[data-doc-notes]");
    const saveButton = card.querySelector("[data-doc-save]");
    const fileButtons = card.querySelectorAll("[data-doc-remove]");

    if (statusSelect) {
      statusSelect.addEventListener("change", () => {
        const badge = card.querySelector(".doc-badge");
        const newStatus = statusSelect.value;
        const metaStatus = ACCOUNT_DOCUMENT_STATUS_META[newStatus] || ACCOUNT_DOCUMENT_STATUS_META.pending;
        if (badge) {
          badge.textContent = getDocumentStatusLabel(newStatus);
          badge.className = `doc-badge doc-badge--${metaStatus.tone}`;
        }
      });
    }

    if (saveButton) {
      saveButton.addEventListener("click", async () => {
        if (clientDocumentsState.loading) return;
        saveButton.disabled = true;
        const original = saveButton.textContent;
        saveButton.textContent = "Guardando...";
        try {
          await updateClientDocument(docKey, {
            status: statusSelect ? statusSelect.value : status,
            notes: notesInput ? notesInput.value : entry.notes || "",
          }).catch(() => {});
        } finally {
          saveButton.disabled = false;
          saveButton.textContent = original;
        }
      });
    }

    fileButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        const fileId = button.getAttribute("data-doc-remove");
        if (!fileId) return;
        button.disabled = true;
        const original = button.textContent;
        button.textContent = "Eliminando...";
        try {
          await removeClientDocumentFile(docKey, fileId).catch(() => {});
        } finally {
          button.disabled = false;
          button.textContent = original;
        }
      });
    });

    grid.appendChild(card);
  });

  clientDocumentsBody.innerHTML = "";
  clientDocumentsBody.appendChild(grid);
}

async function updateClientDocument(docKey, payload) {
  if (!clientDocumentsState.email) return;
  try {
    const res = await apiFetch(
      `/api/account/documents/${encodeURIComponent(clientDocumentsState.email)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: getCurrentActor(),
          documents: {
            [docKey]: {
              status: payload.status,
              notes: payload.notes,
            },
          },
        }),
      },
    );
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "No se pudo actualizar el documento");
    }
    const data = await res.json();
    clientDocumentsState.record = data?.record || clientDocumentsState.record;
    renderClientDocuments();
    if (window.showToast) window.showToast("Documento actualizado correctamente.");
  } catch (err) {
    console.error("client-documents-update", err);
    if (window.showToast) {
      window.showToast(err?.message || "No se pudo actualizar el documento.");
    }
    throw err;
  }
}

async function removeClientDocumentFile(docKey, fileId) {
  if (!clientDocumentsState.email || !fileId) return;
  try {
    const res = await apiFetch(
      `/api/account/documents/${encodeURIComponent(clientDocumentsState.email)}/${encodeURIComponent(docKey)}/${encodeURIComponent(fileId)}`,
      {
        method: "DELETE",
      },
    );
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "No se pudo eliminar el archivo");
    }
    const data = await res.json();
    clientDocumentsState.record = data?.record || clientDocumentsState.record;
    renderClientDocuments();
    if (window.showToast) window.showToast("Archivo eliminado.");
  } catch (err) {
    console.error("client-documents-delete", err);
    if (window.showToast) {
      window.showToast(err?.message || "No se pudo eliminar el archivo.");
    }
    throw err;
  }
}

async function loadClientDocuments(email, options = {}) {
  if (!clientDocumentsBody || !email) return;
  clientDocumentsState.loading = true;
  if (!options.silent) {
    clientDocumentsBody.innerHTML = '<p class="modal-loading">Cargando documentación…</p>';
  }
  if (clientDocumentsRefreshBtn) clientDocumentsRefreshBtn.disabled = true;
  try {
    const res = await apiFetch(`/api/account/documents?email=${encodeURIComponent(email)}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    clientDocumentsState.record = data?.record || null;
    renderClientDocuments();
  } catch (err) {
    console.error("client-documents-fetch", err);
    clientDocumentsBody.innerHTML = '<p class="modal-error">No se pudieron cargar los documentos.</p>';
  } finally {
    clientDocumentsState.loading = false;
    if (clientDocumentsRefreshBtn) clientDocumentsRefreshBtn.disabled = false;
  }
}

function openClientDocumentsModal(client) {
  if (!clientDocumentsModal || !client) return;
  clientDocumentsState.email = client.email;
  clientDocumentsState.name = client.name || "";
  clientDocumentsModal.dataset.email = client.email || "";
  clientDocumentsModal.classList.remove("hidden");
  if (clientDocumentsTitle) clientDocumentsTitle.textContent = "Documentación fiscal";
  if (clientDocumentsSubtitle) {
    const pieces = [];
    if (client.name) pieces.push(client.name);
    if (client.email) pieces.push(client.email);
    clientDocumentsSubtitle.textContent = pieces.join(" · ");
  }
  loadClientDocuments(client.email);
}

if (clientDocumentsCloseBtn) {
  clientDocumentsCloseBtn.addEventListener("click", closeClientDocumentsModal);
}

if (clientDocumentsRefreshBtn) {
  clientDocumentsRefreshBtn.addEventListener("click", () => {
    if (clientDocumentsState.email) {
      loadClientDocuments(clientDocumentsState.email, { silent: false });
    }
  });
}

if (clientDocumentsModal) {
  clientDocumentsModal.addEventListener("click", (event) => {
    if (event.target === clientDocumentsModal) {
      closeClientDocumentsModal();
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && clientDocumentsModal && !clientDocumentsModal.classList.contains("hidden")) {
    closeClientDocumentsModal();
  }
});

const WHOLESALE_STATUS_META = {
  code_sent: { label: "Verificación enviada", tone: "info" },
  pending_review: { label: "Pendiente", tone: "pending" },
  waiting_documents: { label: "Requiere documentos", tone: "warning" },
  approved: { label: "Aprobada", tone: "success" },
  rejected: { label: "Rechazada", tone: "danger" },
  archived: { label: "Archivada", tone: "muted" },
};

const WHOLESALE_HISTORY_LABELS = {
  code_sent: "Código enviado",
  application_submitted: "Solicitud enviada",
  status_changed: "Estado actualizado",
  document_added: "Documento adjunto",
  document_removed: "Documento eliminado",
  notification_sent: "Notificación enviada",
  account_created: "Cuenta creada",
  timeline_call: "Seguimiento telefónico",
  timeline_email: "Seguimiento por email",
  timeline_visit: "Visita registrada",
  timeline_note: "Nota interna",
};

const WHOLESALE_TIMELINE_TYPES = [
  { value: "note", label: "Nota interna" },
  { value: "call", label: "Llamada" },
  { value: "email", label: "Email" },
  { value: "visit", label: "Visita" },
];

const wholesaleSectionEl = document.getElementById("wholesaleSection");
const wholesaleTableBody = document.querySelector("#wholesaleTable tbody");
const wholesaleStatusFilter = document.getElementById("wholesaleStatusFilter");
const wholesaleSearchInput = document.getElementById("wholesaleSearchInput");
const wholesaleDetailContainer = document.getElementById("wholesaleDetail");
const wholesaleRefreshBtn = document.getElementById("wholesaleRefreshBtn");

const wholesaleState = {
  requests: [],
  selectedId: null,
  detail: null,
  loading: false,
};

const wholesaleSearchHandler =
  wholesaleSearchInput && typeof debounce === "function"
    ? debounce(() => renderWholesaleTable(), 250)
    : null;

if (wholesaleStatusFilter) {
  wholesaleStatusFilter.addEventListener("change", () => renderWholesaleTable());
}
if (wholesaleSearchInput && wholesaleSearchHandler) {
  wholesaleSearchInput.addEventListener("input", wholesaleSearchHandler);
}
if (wholesaleRefreshBtn) {
  wholesaleRefreshBtn.addEventListener("click", () =>
    loadWholesaleRequests({ force: true }),
  );
}

// ------------ Productos ------------
// (contenido reemplazado más abajo)

const productsTableBody = document.querySelector("#productsTable tbody");
const productsSummaryEl = document.getElementById("productsSummary");
const productSearchInput = document.getElementById("productSearch");
const productFilterCategory = document.getElementById("productFilterCategory");
const productFilterVisibility = document.getElementById("productFilterVisibility");
const productFilterStock = document.getElementById("productFilterStock");
const productSortSelect = document.getElementById("productSort");
const productCategorySelect = document.getElementById("productCategory");
const productSubcategorySelect = document.getElementById("productSubcategory");
const productCatalogBrandInput = document.getElementById("productCatalogBrand");
const productCatalogModelInput = document.getElementById("productCatalogModel");
const productCatalogPieceInput = document.getElementById("productCatalogPiece");
const openModalBtn = document.getElementById("openProductModal");
const productModal = document.getElementById("productModal");
const productForm = document.getElementById("productForm");
const modalTitle = document.getElementById("modalTitle");
const deleteProductBtn = document.getElementById("deleteProductBtn");
const duplicateProductBtn = document.getElementById("duplicateProductBtn");
const closeModalBtn = document.getElementById("closeModalBtn");
const productImageInput = document.getElementById("productImages");
const imagePreview = document.getElementById("imagePreview");
const tagsInput = document.getElementById("productTags");
const tagsPreview = document.getElementById("tagsPreview");
const autoSeoToggle = document.getElementById("autoSeoToggle");
const autoTagsToggle = document.getElementById("autoTagsToggle");
const seoAssistStatus = document.getElementById("seoAssistStatus");
const showSeoAdvancedBtn = document.getElementById("showSeoAdvancedBtn");
const seoAdvancedFields = document.getElementById("seoAdvancedFields");
const autoTagsStatus = document.getElementById("autoTagsStatus");
const autoTagSuggestions = document.getElementById("autoTagSuggestions");
const descriptionAssistStatus = document.getElementById("descriptionAssistStatus");
const bulkSelect = document.getElementById("bulkActionSelect");
const bulkValueInput = document.getElementById("bulkValue");
const applyBulkBtn = document.getElementById("applyBulkBtn");
const importCatalogCsvBtn = document.getElementById("importCatalogCsvBtn");
const catalogCsvFileInput = document.getElementById("catalogCsvFile");
const catalogCsvIncludeOutOfStock = document.getElementById("catalogCsvIncludeOutOfStock");
const catalogCsvArchiveMissing = document.getElementById("catalogCsvArchiveMissing");
const catalogCsvImportStatus = document.getElementById("catalogCsvImportStatus");
const importStockXlsxBtn = document.getElementById("importStockXlsxBtn");
const stockXlsxFileInput = document.getElementById("stockXlsxFile");
const stockXlsxZeroMissingProducts = document.getElementById("stockXlsxZeroMissingProducts");
const stockXlsxImportStatus = document.getElementById("stockXlsxImportStatus");
const catalogCsvImportProgress = document.getElementById("catalogCsvImportProgress");
const stockXlsxImportProgress = document.getElementById("stockXlsxImportProgress");
const stockXlsxZeroMissingProductsWrap = stockXlsxZeroMissingProducts?.closest("label");
const adminProductsRange = document.getElementById("adminProductsRange");
const adminProductsPageInfo = document.getElementById("adminProductsPageInfo");
const adminProductsPageSize = document.getElementById("adminProductsPageSize");
const adminProductsPrevPage = document.getElementById("adminProductsPrevPage");
const adminProductsNextPage = document.getElementById("adminProductsNextPage");
const selectAllCheckbox = document.getElementById("selectAllProducts");
const productPreviewCard = document.getElementById("productPreview");
const productPreviewMedia = document.getElementById("productPreviewMedia");
const productPreviewImage = document.getElementById("productPreviewImage");
const productPreviewPlaceholder = document.getElementById("productPreviewPlaceholder");
const productPreviewName = document.getElementById("productPreviewName");
const productPreviewSku = document.getElementById("productPreviewSku");
const productPreviewPrice = document.getElementById("productPreviewPrice");
const productPreviewStock = document.getElementById("productPreviewStock");
const productPreviewMeta = document.getElementById("productPreviewMeta");
const suggestFulfillmentBtn = document.getElementById("suggestFulfillmentBtn");

const currencyFormatter = typeof Intl !== "undefined"
  ? new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  : null;

const API_BASE = "/api/products";
let originalProduct = null;
let productsCache = [];
let suppliersCache = [];
let productImagesState = [];
let dragImageIndex = null;
let productFilters = {
  query: "",
  category: "",
  brand: "",
  visibility: "",
  stock: "",
  sort: "recent",
};
let productsPage = 1;
let productsPageSize = Number(adminProductsPageSize?.value || 100);
let productsTotalItems = 0;
let productsTotalPages = 1;
let productsLoadErrorMessage = "";

let isApplyingAutoSeo = false;
let isApplyingAutoTags = false;
const autoAssistFieldNames = new Set([
  "sku",
  "name",
  "brand",
  "model",
  "catalog_brand",
  "catalog_model",
  "catalog_piece",
  "category",
  "subcategory",
  "price_minorista",
  "price_mayorista",
  "stock",
  "min_stock",
]);

const PRODUCT_SORTERS = {
  recent: (a, b) => getProductTimestamp(b) - getProductTimestamp(a),
  name: (a, b) => (a.name || "").localeCompare(b.name || "", "es", {
    sensitivity: "base",
  }),
  stock: (a, b) => (b.stock ?? 0) - (a.stock ?? 0),
  price_desc: (a, b) => (b.price_minorista ?? 0) - (a.price_minorista ?? 0),
  price_asc: (a, b) => (a.price_minorista ?? 0) - (b.price_minorista ?? 0),
};

function getProductTimestamp(product = {}) {
  const sources = [
    product.updated_at,
    product.updatedAt,
    product.created_at,
    product.createdAt,
  ];
  for (const value of sources) {
    if (!value) continue;
    const ts = new Date(value).getTime();
    if (!Number.isNaN(ts)) {
      return ts;
    }
  }
  const idValue = Number(product.id);
  return Number.isFinite(idValue) ? idValue : 0;
}

function normalizeSearchText(value) {
  const base = (value ?? "").toString().toLowerCase();
  if (typeof base.normalize === "function") {
    return base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  return base;
}

function isLowStock(product = {}) {
  const stock = Number(product.stock);
  const min = Number(product.min_stock);
  if (!Number.isFinite(stock) || !Number.isFinite(min) || min <= 0) {
    return false;
  }
  if (stock <= 0) return false;
  return stock < min;
}

function isOutOfStock(product = {}) {
  const stock = Number(product.stock);
  if (!Number.isFinite(stock)) return false;
  return stock <= 0;
}

function setSelectOptions(selectEl, values, placeholder) {
  if (!selectEl) return;
  const unique = Array.from(
    new Set(
      (values || [])
        .map((val) => (val == null ? "" : String(val).trim()))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  if (selectEl.tagName === "SELECT") {
    const current = selectEl.value;
    const options = [
      `<option value="">${escapeHtml(placeholder)}</option>`,
      ...unique.map(
        (val) =>
          `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`,
      ),
    ];
    selectEl.innerHTML = options.join("");
    if (current && unique.includes(current)) {
      selectEl.value = current;
    }
    return;
  }
  if (placeholder && "placeholder" in selectEl) {
    selectEl.placeholder = placeholder;
  }
  const listId = selectEl.getAttribute("list");
  if (!listId) return;
  const datalist = document.getElementById(listId);
  if (!datalist) return;
  datalist.innerHTML = unique
    .map((val) => `<option value="${escapeHtml(val)}"></option>`)
    .join("");
}

function syncProductTaxonomies(products) {
  const categories = products.map((p) => p.category).filter(Boolean);
  const subcategories = products.map((p) => p.subcategory).filter(Boolean);
  setSelectOptions(productCategorySelect, categories, "Categoría");
  setSelectOptions(productSubcategorySelect, subcategories, "Subcategoría");
  const explorerBrands = products
    .flatMap((p) => [resolveCatalogBrand(p), cleanLabel(p.brand)])
    .filter(Boolean);
  setSelectOptions(
    productCatalogBrandInput,
    explorerBrands,
    "Marca en el explorador",
  );
  const explorerModels = products
    .flatMap((p) => [resolveCatalogModel(p), cleanLabel(p.model), cleanLabel(p.subcategory)])
    .filter(Boolean);
  setSelectOptions(
    productCatalogModelInput,
    explorerModels,
    "Modelo agrupador",
  );
  const explorerPieces = products
    .map((p) => resolveCatalogPiece(p))
    .filter(Boolean);
  setSelectOptions(
    productCatalogPieceInput,
    explorerPieces,
    "Pieza / parte",
  );
  if (productFilterCategory) {
    const previous = productFilterCategory.value;
    productFilterCategory.innerHTML =
      '<option value="">Todas</option>' +
      Array.from(
        new Set(
          categories
            .map((val) => (val == null ? "" : String(val).trim()))
            .filter(Boolean),
        ),
      )
        .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
        .map(
          (val) =>
            `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`,
        )
        .join("");
    if (previous && productFilterCategory.querySelector(`option[value="${previous}"]`)) {
      productFilterCategory.value = previous;
    } else if (previous) {
      productFilterCategory.value = "";
      productFilters.category = "";
    }
  }
}

function describeActiveFilters() {
  const active = [];
  if (productFilters.query) {
    active.push(`Búsqueda: “${escapeHtml(productFilters.query)}”`);
  }
  if (productFilters.category) {
    active.push(`Categoría: ${escapeHtml(productFilters.category)}`);
  }
  if (productFilters.visibility) {
    const label =
      productFilters.visibility === "public"
        ? "Públicos"
        : productFilters.visibility === "private"
        ? "Privados"
        : "Borradores";
    active.push(`Visibilidad: ${label}`);
  }
  if (productFilters.stock === "low") {
    active.push("Solo stock bajo");
  } else if (productFilters.stock === "out") {
    active.push("Solo sin stock");
  }
  return active.length ? active.join(" • ") : "Sin filtros activos";
}

function updateProductSummary(filtered) {
  if (!productsSummaryEl) return;
  if (productsLoadErrorMessage) {
    productsSummaryEl.innerHTML = `
      <div class="product-summary__badge">⚠️</div>
      <div class="product-summary__details">
        <p class="product-summary__title">Error al cargar el catálogo</p>
        <div class="product-summary__indicators">
          <span>${escapeHtml(productsLoadErrorMessage)}</span>
        </div>
      </div>`;
    return;
  }
  if (!productsCache.length) {
    productsSummaryEl.innerHTML = `
      <div class="product-summary__badge">0</div>
      <div class="product-summary__details">
        <p class="product-summary__title">Sin productos en catálogo</p>
        <div class="product-summary__indicators">
          <span>Comenzá agregando tu primer producto.</span>
        </div>
      </div>`;
    return;
  }
  const total = Number(productsTotalItems || productsCache.length);
  const visible = filtered.length;
  const filteredLow = filtered.filter((p) => isLowStock(p)).length;
  const filteredOut = filtered.filter((p) => isOutOfStock(p)).length;
  const filteredPublic = filtered.filter(
    (p) => (p.visibility || "public") === "public",
  ).length;
  const totalLow = productsCache.filter((p) => isLowStock(p)).length;
  const totalOut = productsCache.filter((p) => isOutOfStock(p)).length;
  const totalPublic = productsCache.filter(
    (p) => (p.visibility || "public") === "public",
  ).length;
  const title =
    visible === total
      ? `${visible} ${visible === 1 ? "producto" : "productos"} en esta página`
      : `${visible} ${visible === 1 ? "producto" : "productos"} de ${total}`;
  const meta = describeActiveFilters();
  const formatIndicator = (current, totalCount) => {
    if (visible === total || !totalCount) {
      return String(current);
    }
    return `${current} / ${totalCount}`;
  };
  productsSummaryEl.innerHTML = `
    <div class="product-summary__badge">${visible}</div>
    <div class="product-summary__details">
      <p class="product-summary__title">${title}</p>
      <p class="product-summary__meta">${meta}</p>
      <div class="product-summary__indicators">
        <span class="product-summary__indicator product-summary__indicator--low">Bajo stock: ${formatIndicator(
          filteredLow,
          totalLow,
        )}</span>
        <span class="product-summary__indicator product-summary__indicator--out">Sin stock: ${formatIndicator(
          filteredOut,
          totalOut,
        )}</span>
        <span class="product-summary__indicator">Publicados: ${formatIndicator(
          filteredPublic,
          totalPublic,
        )}</span>
      </div>
    </div>`;
}

function buildProductRow(product) {
  const tr = document.createElement("tr");
  const productId = product && product.id != null ? String(product.id) : "";
  const safeIdAttr = escapeHtml(productId);
  tr.dataset.id = productId;
  tr.dataset.productId = productId;
  let stockBadge = "";
  if (isOutOfStock(product)) {
    stockBadge = '<span class="badge">Sin stock</span>';
  } else if (isLowStock(product)) {
    stockBadge = '<span class="badge">Bajo</span>';
  }

  const tagsArray = Array.isArray(product.tags)
    ? product.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : String(product.tags || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
  const tagsPreview =
    tagsArray.length > 4 ? `${tagsArray.slice(0, 4).join(", ")} +${tagsArray.length - 4}` : tagsArray.join(", ");

  const safeSku = escapeHtml(product.sku ?? "");
  const fullName = String(product.name ?? "");
  const safeName = escapeHtml(compactText(fullName, 84));
  const safeBrand = escapeHtml(compactText(product.brand || "", 42));
  const safeModel = escapeHtml(compactText(product.model || "", 42));
  const safeCategory = escapeHtml(compactText(product.category || "", 30));
  const safeSubcategory = escapeHtml(compactText(product.subcategory || "", 42));
  const safeVisibility = escapeHtml(product.visibility || "");
  const explorerParts = [
    resolveCatalogBrand(product),
    resolveCatalogModel(product),
    resolveCatalogPiece(product),
  ].filter(Boolean);
  const hasManualExplorer = Boolean(
    cleanLabel(product.catalog_brand) ||
      cleanLabel(product.catalog_model) ||
      cleanLabel(product.catalog_piece),
  );
  const explorerText = explorerParts.length ? explorerParts.join(" › ") : "Automático";
  const explorerCellAttr = hasManualExplorer ? "" : ' data-mode="auto"';
  const safeExplorer = escapeHtml(compactText(explorerText, 64));
  const safeTags = escapeHtml(compactText(tagsPreview, 72));

  tr.innerHTML = `
    <td><input type="checkbox" class="select-product" /></td>
    <td class="product-cell product-cell--mono" title="${safeSku}">${safeSku}</td>
    <td class="product-cell product-cell--main" title="${escapeHtml(fullName)}">${safeName}</td>
    <td class="product-cell" title="${escapeHtml(product.brand || "")}">${safeBrand}</td>
    <td class="product-cell" title="${escapeHtml(product.model || "")}">${safeModel}</td>
    <td class="product-cell" title="${escapeHtml(product.category || "")}">${safeCategory}</td>
    <td class="product-cell" title="${escapeHtml(product.subcategory || "")}">${safeSubcategory}</td>
    <td class="product-cell"${explorerCellAttr} title="${escapeHtml(explorerText)}">${safeExplorer}</td>
    <td class="product-cell" title="${escapeHtml(tagsArray.join(", "))}">${safeTags}</td>
    <td><input type="number" class="inline-edit inline-edit--compact" data-field="stock" min="0" value="${product.stock ?? 0}" />${stockBadge}</td>
    <td>${product.min_stock ?? ""}</td>
    <td><input type="number" class="inline-edit inline-edit--compact" data-field="price_minorista" min="0" value="${product.price_minorista ?? 0}" /></td>
    <td><input type="number" class="inline-edit inline-edit--compact" data-field="price_mayorista" min="0" value="${product.price_mayorista ?? 0}" /></td>
    <td>${safeVisibility}</td>
    <td><button class="edit-btn" data-id="${safeIdAttr}">Editar</button> <button class="delete-btn" data-id="${safeIdAttr}">Eliminar</button></td>`;
  const editBtn = tr.querySelector(".edit-btn");
  if (editBtn) {
    editBtn.addEventListener("click", () => openProductModal(editBtn.dataset.id));
  }
  const delBtn = tr.querySelector(".delete-btn");
  if (delBtn) {
    delBtn.addEventListener("click", () => deleteProduct(delBtn.dataset.id));
  }
  return tr;
}


function renderProductsTable() {
  if (!productsTableBody) return;
  const rows = Array.isArray(productsCache) ? productsCache : [];
  if (!rows.length) {
    const message = productsCache.length
      ? "No hay productos que coincidan con los filtros actuales."
      : "No hay productos";
    productsTableBody.innerHTML = `<tr><td colspan="15">${message}</td></tr>`;
  } else {
    const fragment = document.createDocumentFragment();
    rows.forEach((product) => {
      fragment.appendChild(buildProductRow(product));
    });
    productsTableBody.innerHTML = "";
    productsTableBody.appendChild(fragment);
  }
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = false;
  }
  updateProductSummary(rows);
}

function highlightProductRow(targetId) {
  if (!productsTableBody) return false;
  const id = targetId != null ? String(targetId) : "";
  if (!id) return false;
  const rows = Array.from(productsTableBody.querySelectorAll("tr"));
  const match = rows.find((tr) => tr.dataset?.productId === id || tr.dataset?.id === id);
  if (!match) {
    if (
      window.showToast &&
      (productFilters.query ||
        productFilters.category ||
        productFilters.visibility ||
        productFilters.stock)
    ) {
      showToast("Producto guardado. Ajustá los filtros para verlo en la lista.");
    }
    return false;
  }
  const schedule =
    typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (fn) => setTimeout(fn, 16);
  const delay =
    typeof window !== "undefined" && typeof window.setTimeout === "function"
      ? window.setTimeout.bind(window)
      : setTimeout;
  schedule(() => {
    match.classList.add("is-highlighted");
    if (typeof match.scrollIntoView === "function") {
      match.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    delay(() => {
      match.classList.remove("is-highlighted");
    }, 2400);
  });
  return true;
}

function updateProductFilters(patch) {
  productFilters = {
    ...productFilters,
    ...patch,
  };
  productsPage = 1;
  loadProducts();
}

if (productSearchInput) {
  const handleSearch = debounce(() => {
    updateProductFilters({ query: productSearchInput.value.trim() });
  }, 250);
  productSearchInput.addEventListener("input", handleSearch);
}
if (productFilterCategory) {
  productFilterCategory.addEventListener("change", () => {
    updateProductFilters({ category: productFilterCategory.value });
  });
}
if (productFilterVisibility) {
  productFilterVisibility.addEventListener("change", () => {
    updateProductFilters({ visibility: productFilterVisibility.value });
  });
}
if (productFilterStock) {
  productFilterStock.addEventListener("change", () => {
    updateProductFilters({ stock: productFilterStock.value });
  });
}
if (productSortSelect) {
  productSortSelect.addEventListener("change", () => {
    updateProductFilters({ sort: productSortSelect.value || "recent" });
  });
}
if (adminProductsPageSize) {
  adminProductsPageSize.addEventListener("change", () => {
    productsPageSize = Number(adminProductsPageSize.value || 100);
    productsPage = 1;
    loadProducts();
  });
}
if (adminProductsPrevPage) {
  adminProductsPrevPage.addEventListener("click", () => {
    if (productsPage <= 1) return;
    productsPage -= 1;
    loadProducts();
  });
}
if (adminProductsNextPage) {
  adminProductsNextPage.addEventListener("click", () => {
    if (productsPage >= productsTotalPages) return;
    productsPage += 1;
    loadProducts();
  });
}

function normalizeImageState() {
  productImagesState = productImagesState.filter((img) => img && img.url);
}

function renderImageManager() {
  if (!imagePreview) return;
  normalizeImageState();
  imagePreview.innerHTML = "";
  imagePreview.classList.toggle("has-images", productImagesState.length > 0);
  if (productImagesState.length === 0) {
    const empty = document.createElement("div");
    empty.className = "image-dropzone";
    empty.innerHTML =
      '<p>Arrastrá imágenes aquí o hacé clic en "Seleccionar" para subirlas.</p>';
    imagePreview.appendChild(empty);
    renderProductFormPreview();
    return;
  }
  const list = document.createElement("div");
  list.className = "image-list";
  productImagesState.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "image-item";
    if (index === 0) row.classList.add("is-primary");
    row.draggable = true;
    row.dataset.index = String(index);

    const thumb = new Image();
    thumb.src = item.url;
    thumb.alt = item.alt || "Vista previa";
    thumb.loading = "lazy";
    row.appendChild(thumb);

    const body = document.createElement("div");
    body.className = "image-item__body";

    const primaryLabel = document.createElement("label");
    primaryLabel.className = "image-item__primary";
    const primaryRadio = document.createElement("input");
    primaryRadio.type = "radio";
    primaryRadio.name = "primaryImage";
    primaryRadio.checked = index === 0;
    primaryRadio.addEventListener("change", () => {
      const [selected] = productImagesState.splice(index, 1);
      productImagesState.unshift(selected);
      renderImageManager();
    });
    primaryLabel.append(primaryRadio, document.createTextNode(" Principal"));
    body.appendChild(primaryLabel);

    const altInput = document.createElement("input");
    altInput.type = "text";
    altInput.placeholder = "Texto alternativo";
    altInput.value = item.alt || "";
    altInput.addEventListener("input", (ev) => {
      productImagesState[index].alt = ev.target.value;
    });
    body.appendChild(altInput);

    const actions = document.createElement("div");
    actions.className = "image-item__actions";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "button danger image-remove";
    removeBtn.textContent = "Eliminar";
    removeBtn.addEventListener("click", () => {
      productImagesState.splice(index, 1);
      renderImageManager();
    });
    actions.appendChild(removeBtn);
    body.appendChild(actions);

    row.appendChild(body);

    row.addEventListener("dragstart", (ev) => {
      dragImageIndex = index;
      ev.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      dragImageIndex = null;
      row.classList.remove("dragging");
      row.classList.remove("dragover");
    });
    row.addEventListener("dragover", (ev) => {
      if (dragImageIndex === null || dragImageIndex === index) return;
      ev.preventDefault();
      row.classList.add("dragover");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("dragover");
    });
    row.addEventListener("drop", (ev) => {
      if (dragImageIndex === null || dragImageIndex === index) return;
      ev.preventDefault();
      const [moved] = productImagesState.splice(dragImageIndex, 1);
      productImagesState.splice(index, 0, moved);
      dragImageIndex = null;
      renderImageManager();
    });

    list.appendChild(row);
  });
  imagePreview.appendChild(list);
  renderProductFormPreview();
}

async function uploadProductImages(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return;
  const skuInput = document.getElementById("productSku");
  const sku = skuInput ? skuInput.value.trim() : "";
  if (!sku) {
    alert("Completá el SKU antes de subir imágenes");
    productImageInput.value = "";
    return;
  }
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) {
      alert(`La imagen ${file.name} supera 5MB`);
      continue;
    }
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      alert(`Formato no permitido (${file.name}). Usa JPG o PNG`);
      continue;
    }
    try {
      imagePreview.classList.add("is-uploading");
      const fd = new FormData();
      fd.append("images", file);
      const resp = await apiFetch(
        `/api/product-image/${encodeURIComponent(sku)}`,
        {
          method: "POST",
          body: fd,
        },
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || "Error al subir imagen");
      }
      const first = Array.isArray(data.files) ? data.files[0] : null;
      const path = first?.path || data.path;
      if (path && !productImagesState.some((img) => img.url === path)) {
        productImagesState.push({
          url: path,
          alt: file.name.replace(/\.[^.]+$/, ""),
        });
      }
    } catch (err) {
      console.error(err);
      alert(err.message || "Error al subir imagen");
    } finally {
      imagePreview.classList.remove("is-uploading");
    }
  }
  renderImageManager();
  productImageInput.value = "";
}

if (imagePreview) {
  imagePreview.addEventListener("dragover", (ev) => {
    const types = Array.from(ev.dataTransfer?.types || []);
    if (types.includes("Files")) {
      ev.preventDefault();
      imagePreview.classList.add("is-dragover");
    }
  });
  imagePreview.addEventListener("dragleave", () => {
    imagePreview.classList.remove("is-dragover");
  });
  imagePreview.addEventListener("drop", (ev) => {
    const types = Array.from(ev.dataTransfer?.types || []);
    if (types.includes("Files")) {
      ev.preventDefault();
      imagePreview.classList.remove("is-dragover");
      uploadProductImages(ev.dataTransfer.files);
    }
  });
}

renderImageManager();

if (openModalBtn) {
  openModalBtn.addEventListener("click", () => openProductModal());
}
if (closeModalBtn) {
  closeModalBtn.addEventListener("click", () => productModal.classList.add("hidden"));
}

if (productImageInput) {
  productImageInput.addEventListener("change", () => {
    uploadProductImages(productImageInput.files);
  });
}

if (tagsInput) {
  tagsInput.addEventListener("input", () => {
    if (!isApplyingAutoTags) {
      tagsInput.dataset.autoGenerated = "";
      if (autoTagsToggle && autoTagsToggle.checked) {
        autoTagsToggle.checked = false;
      }
    }
    updateTagsPreview();
    if (!isApplyingAutoTags) {
      applyAutoAssist();
    } else {
      renderProductFormPreview();
    }
  });
}

if (productForm) {
  productForm.addEventListener("input", (event) => {
    const name = event.target?.name;
    if (name && autoAssistFieldNames.has(name)) {
      applyAutoAssist();
    } else {
      renderProductFormPreview();
    }
  });
  productForm.addEventListener("change", (event) => {
    const name = event.target?.name;
    if (name && autoAssistFieldNames.has(name)) {
      applyAutoAssist();
    } else {
      renderProductFormPreview();
    }
  });
}

if (autoSeoToggle) {
  autoSeoToggle.addEventListener("change", () => {
    if (autoSeoToggle.checked) {
      applyAutoAssist({ force: true });
    } else {
      if (metaTitleInput) metaTitleInput.readOnly = false;
      if (metaDescInput) metaDescInput.readOnly = false;
      applyAutoAssist();
    }
  });
}

if (showSeoAdvancedBtn) {
  showSeoAdvancedBtn.addEventListener("click", () => {
    if (autoSeoToggle) autoSeoToggle.checked = false;
    applyAutoAssist();
  });
}

if (autoTagsToggle) {
  autoTagsToggle.addEventListener("change", () => {
    if (autoTagsToggle.checked) {
      if (tagsInput) tagsInput.dataset.autoGenerated = "1";
      applyAutoAssist({ force: true });
    } else {
      if (tagsInput) {
        tagsInput.dataset.autoGenerated = "";
        tagsInput.readOnly = false;
      }
      applyAutoAssist();
    }
  });
}

function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function gatherProductBasics() {
  if (!productForm) return {};
  const get = (name) => (productForm.elements[name]?.value ?? "").toString().trim();
  const getNumber = (name) => {
    const raw = productForm.elements[name]?.value;
    if (raw == null || raw === "") return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  };
  const tagsValue = productForm.elements["tags"]?.value ?? "";
  const tags = tagsValue
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return {
    id: get("id"),
    sku: get("sku"),
    name: get("name"),
    brand: get("brand"),
    model: get("model"),
    catalog_brand: get("catalog_brand"),
    catalog_model: get("catalog_model"),
    catalog_piece: get("catalog_piece"),
    category: get("category"),
    subcategory: get("subcategory"),
    tags,
    slug: get("slug"),
    price_minorista: getNumber("price_minorista"),
    price_mayorista: getNumber("price_mayorista"),
    cost: getNumber("cost"),
    stock: getNumber("stock"),
    min_stock: getNumber("min_stock"),
    stock_mode: get("stock_mode"),
    remote_lead_min_days: getNumber("remote_lead_min_days"),
    remote_lead_max_days: getNumber("remote_lead_max_days"),
    show_marketplace_trust: Boolean(productForm.elements["show_marketplace_trust"]?.checked),
    description: descriptionInput ? descriptionInput.value.trim() : "",
  };
}


function suggestFulfillmentByHeuristics(data = {}) {
  const text = [
    data.name,
    data.description,
    data.category,
    data.subcategory,
    Array.isArray(data.tags) ? data.tags.join(" ") : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const stock = Number(data.stock);
  const hasRemoteSignals =
    /a pedido|preventa|importad|internacional|encargo|bajo pedido/.test(text) ||
    (Number.isFinite(stock) && stock <= 0);

  const isDisplayAssembly = /pantalla|modulo|módulo|display|service pack/.test(text);
  const isAccessory = /funda|cable|cargador|templado|accesorio/.test(text);

  const mode = hasRemoteSignals ? "remote" : "physical";
  let minDays = null;
  let maxDays = null;
  if (mode === "remote") {
    if (isAccessory) {
      minDays = 3;
      maxDays = 7;
    } else if (isDisplayAssembly) {
      minDays = 4;
      maxDays = 10;
    } else {
      minDays = 5;
      maxDays = 12;
    }
  }

  return {
    mode,
    minDays,
    maxDays,
    showTrust: mode === "remote",
  };
}

function applySuggestedFulfillment() {
  if (!productForm) return;
  const data = serializeProductForm(productForm);
  const suggestion = suggestFulfillmentByHeuristics(data);
  if (productForm.elements["stock_mode"]) {
    productForm.elements["stock_mode"].value = suggestion.mode;
  }
  if (productForm.elements["remote_lead_min_days"]) {
    productForm.elements["remote_lead_min_days"].value = suggestion.minDays ?? "";
  }
  if (productForm.elements["remote_lead_max_days"]) {
    productForm.elements["remote_lead_max_days"].value = suggestion.maxDays ?? "";
  }
  if (productForm.elements["show_marketplace_trust"]) {
    productForm.elements["show_marketplace_trust"].checked = suggestion.showTrust;
  }
  renderProductFormPreview();
  if (window.showToast) {
    showToast(
      suggestion.mode === "remote"
        ? "Sugerencia IA aplicada: stock remoto con ventana de entrega estimada."
        : "Sugerencia IA aplicada: stock físico inmediato.",
    );
  }
}

function formatCurrencyValue(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (currencyFormatter) {
    try {
      return currencyFormatter.format(value);
    } catch (err) {
      console.warn("currency-format-error", err);
    }
  }
  return `$${value.toFixed(2)}`;
}

function generateAutoSlug(data = {}) {
  const parts = [
    cleanLabel(data.catalog_brand) || cleanLabel(data.brand),
    cleanLabel(data.catalog_model) || cleanLabel(data.model),
    cleanLabel(data.catalog_piece),
    data.name,
  ].filter(Boolean);
  const base = parts.join(" ");
  const slug = slugify(base);
  if (slug) return slug;
  if (data.sku) return slugify(data.sku);
  return "";
}

function resolveAutoSeo(data = {}) {
  return buildSeoForProduct(data);
}

function generateAutoTags(data = {}) {
  const keywords = new Set();
  const addKeyword = (value) => {
    if (!value) return;
    const cleaned = value.toString().trim();
    if (cleaned) keywords.add(cleaned);
  };
  const addKeywordTokens = (value) => {
    if (!value) return;
    value
      .toString()
      .split(/[\s,\/|\-]+/)
      .map((token) => token.trim())
      .filter((token) => token && (token.length > 2 || /\d/.test(token)))
      .forEach((token) => addKeyword(token));
  };
  const primaryBrand = cleanLabel(data.catalog_brand) || cleanLabel(data.brand);
  const primaryModel = cleanLabel(data.catalog_model) || cleanLabel(data.model);
  const primaryPiece = cleanLabel(data.catalog_piece);
  addKeyword(primaryBrand);
  addKeyword(primaryModel);
  if (primaryBrand || primaryModel) {
    addKeyword(`${primaryBrand || ""} ${primaryModel || ""}`.trim());
  }
  addKeyword(primaryPiece);
  if (primaryPiece && (primaryBrand || primaryModel)) {
    addKeyword(`${primaryPiece} ${primaryBrand || primaryModel || ""}`.trim());
  }
  addKeyword(data.brand);
  addKeyword(data.model);
  addKeyword(data.catalog_brand);
  addKeyword(data.catalog_model);
  addKeyword(data.catalog_piece);
  addKeyword(data.category);
  addKeyword(data.subcategory);
  addKeywordTokens(data.name);
  addKeywordTokens(primaryPiece);
  addKeywordTokens(data.category);
  addKeywordTokens(data.subcategory);
  const baseTags = Array.from(keywords).filter(Boolean);
  return baseTags.slice(0, 10);
}

function updateTagsPreview() {
  if (!tagsInput || !tagsPreview) return;
  const tags = tagsInput.value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  tagsPreview.innerHTML = tags
    .map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`)
    .join(" ");
}

function updateAutoTagSuggestions(tags = [], enabled = false) {
  if (!autoTagSuggestions) return;
  if (!enabled) {
    autoTagSuggestions.innerHTML =
      '<span class="form-hint">Activá la generación automática para sugerencias inteligentes.</span>';
    return;
  }
  if (!tags.length) {
    autoTagSuggestions.innerHTML = "";
    return;
  }
  autoTagSuggestions.innerHTML = tags
    .map((tag) => `<span class="chip chip--ghost">${escapeHtml(tag)}</span>`)
    .join(" ");
}

function updateSeoAssistStatus(data = {}) {
  if (!seoAssistStatus) return;
  if (autoSeoToggle && autoSeoToggle.checked) {
    const missing = [];
    if (!data.name) missing.push("nombre");
    const hasBrand = cleanLabel(data.catalog_brand) || cleanLabel(data.brand);
    const hasModel = cleanLabel(data.catalog_model) || cleanLabel(data.model);
    if (!hasBrand) missing.push("marca");
    if (!hasModel) missing.push("modelo");
    if (!data.category) missing.push("categoría");
    seoAssistStatus.textContent = missing.length
      ? `Completá ${formatList(missing)} para optimizar el SEO automáticamente.`
      : "SEO optimizado automáticamente listo para destacar en Google.";
  } else {
    seoAssistStatus.textContent =
      "Modo manual habilitado. Ajustá título, meta descripción y URL según tu estrategia.";
  }
}

function updateTagsAssistStatus(data = {}, suggested = []) {
  if (!autoTagsStatus) return;
  if (autoTagsToggle && autoTagsToggle.checked) {
    const missing = [];
    const hasBrand = cleanLabel(data.catalog_brand) || cleanLabel(data.brand);
    const hasModel = cleanLabel(data.catalog_model) || cleanLabel(data.model);
    if (!hasBrand) missing.push("marca");
    if (!hasModel) missing.push("modelo");
    if (!data.category) missing.push("categoría");
    autoTagsStatus.textContent = missing.length
      ? `Sumá ${formatList(missing)} para generar tags potentes automáticamente.`
      : suggested.length
      ? "Generamos palabras clave relevantes automáticamente. Podés sumarlas a mano si querés más variantes."
      : "Completá más detalles para desbloquear sugerencias de tags SEO.";
  } else {
    autoTagsStatus.textContent =
      "Escribí tus propias palabras clave separadas por comas para un control total.";
  }
}

function updateDescriptionAssistStatus() {
  if (!descriptionAssistStatus) return;
  descriptionAssistStatus.textContent =
    "Escribí una descripción clara y simple con la información clave para tus clientes. El SEO se refuerza automáticamente con los demás datos.";
}

function updateSeoAdvancedVisibility() {
  if (!seoAdvancedFields) return;
  const shouldShow = !autoSeoToggle || !autoSeoToggle.checked;
  seoAdvancedFields.classList.toggle("is-collapsed", !shouldShow);
  seoAdvancedFields.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  if (showSeoAdvancedBtn) {
    showSeoAdvancedBtn.setAttribute("aria-expanded", shouldShow ? "true" : "false");
  }
}

function resetAutoAssistState({ keepToggles = false } = {}) {
  if (!productForm) return;
  productForm.dataset.manualSlug = "";
  if (!keepToggles) {
    if (autoSeoToggle) autoSeoToggle.checked = true;
    if (autoTagsToggle) autoTagsToggle.checked = true;
  }
  if (tagsInput) {
    tagsInput.dataset.autoGenerated = "1";
  }
  updateSeoAdvancedVisibility();
  updateDescriptionAssistStatus();
}

function applyAutoAssist({ force = false } = {}) {
  if (!productForm) return;
  const data = gatherProductBasics();
  const autoSeoEnabled = autoSeoToggle ? autoSeoToggle.checked : false;
  const autoTagsEnabled = autoTagsToggle ? autoTagsToggle.checked : false;

  if (autoSeoEnabled) {
    if (force) {
      productForm.dataset.manualSlug = "";
    }
    if (!productForm.dataset.manualSlug) {
      const slugCandidate = generateAutoSlug(data);
      if (slugCandidate && slugInput) {
        isApplyingAutoSeo = true;
        slugInput.value = slugCandidate;
        isApplyingAutoSeo = false;
      }
    }
    const autoSeo = resolveAutoSeo(data);
    const autoTitle = autoSeo.seoTitle;
    const autoDescription = autoSeo.seoDescription;
    if (metaTitleInput) {
      isApplyingAutoSeo = true;
      metaTitleInput.value = autoTitle;
      metaTitleInput.readOnly = true;
      isApplyingAutoSeo = false;
    }
    if (metaDescInput) {
      isApplyingAutoSeo = true;
      metaDescInput.value = autoDescription;
      metaDescInput.readOnly = true;
      isApplyingAutoSeo = false;
    }
  } else {
    if (metaTitleInput) metaTitleInput.readOnly = false;
    if (metaDescInput) metaDescInput.readOnly = false;
  }

  const autoTags = autoTagsEnabled ? generateAutoTags(data) : [];
  if (autoTagsEnabled && tagsInput) {
    isApplyingAutoTags = true;
    tagsInput.value = autoTags.join(", ");
    tagsInput.readOnly = true;
    tagsInput.dataset.autoGenerated = "1";
    isApplyingAutoTags = false;
  } else if (tagsInput) {
    tagsInput.readOnly = false;
    if (tagsInput.dataset.autoGenerated !== "0") {
      tagsInput.dataset.autoGenerated = "";
    }
  }

  updateTagsPreview();
  updateAutoTagSuggestions(autoTags, autoTagsEnabled);
  updateSeoAssistStatus(data);
  updateTagsAssistStatus(data, autoTags);
  updateDescriptionAssistStatus();
  updateSeoAdvancedVisibility();
  renderSeoPreview();
  renderProductFormPreview();
}

const nameInput = document.getElementById("productName");
const slugInput = document.getElementById("productSlug");
const descriptionInput = document.getElementById("productDescription");
const metaTitleInput = document.getElementById("productSeoTitle");
const metaDescInput = document.getElementById("productSeoDesc");
const seoSlugPreview = document.getElementById("seoSlugPreview");
const seoTitlePreview = document.getElementById("seoTitlePreview");
const seoDescPreview = document.getElementById("seoDescPreview");

function resolveDescriptionPreview() {
  const meta = metaDescInput?.value?.trim();
  if (meta) return meta;
  const data = serializeProductForm(productForm);
  const { generated } = applySeoDefaults(data);
  if (generated.seoDescription) return generated.seoDescription;
  const desc = descriptionInput?.value?.trim();
  return desc || "";
}

function renderSeoPreview() {
  if (!seoSlugPreview || !seoTitlePreview || !seoDescPreview) return;
  const data = serializeProductForm(productForm);
  const { product: enriched, generated } = applySeoDefaults(data);
  const previewTitle =
    metaTitleInput?.value?.trim() || enriched.seoTitle || generated.seoTitle || nameInput.value;
  const previewDesc =
    metaDescInput?.value?.trim() ||
    enriched.seoDescription ||
    generated.seoDescription ||
    resolveDescriptionPreview();
  seoSlugPreview.textContent = `/productos/${slugInput.value}`;
  seoTitlePreview.textContent = previewTitle;
  seoDescPreview.textContent = previewDesc;
}

if (nameInput) {
  nameInput.addEventListener("input", () => {
    if (!autoSeoToggle || !autoSeoToggle.checked) {
      if (!productForm.dataset.manualSlug && !productForm.elements.id.value) {
        slugInput.value = slugify(nameInput.value);
      }
      renderSeoPreview();
      renderProductFormPreview();
    }
  });
}

if (slugInput) {
  slugInput.addEventListener("input", () => {
    if (!isApplyingAutoSeo) {
      productForm.dataset.manualSlug = slugInput.value ? "1" : "";
    }
    renderSeoPreview();
    renderProductFormPreview();
  });
}

if (metaTitleInput) {
  metaTitleInput.addEventListener("input", () => {
    if (!isApplyingAutoSeo && autoSeoToggle && autoSeoToggle.checked) {
      autoSeoToggle.checked = false;
      applyAutoAssist();
      return;
    }
    renderSeoPreview();
    renderProductFormPreview();
  });
}

if (metaDescInput) {
  metaDescInput.addEventListener("input", () => {
    if (!isApplyingAutoSeo && autoSeoToggle && autoSeoToggle.checked) {
      autoSeoToggle.checked = false;
      applyAutoAssist();
      return;
    }
    renderSeoPreview();
    renderProductFormPreview();
  });
}

if (descriptionInput) {
  descriptionInput.addEventListener("input", () => {
    updateDescriptionAssistStatus();
    renderSeoPreview();
    renderProductFormPreview();
  });
}

function setLoading(state) {
  productForm
    .querySelectorAll("input,select,textarea,button")
    .forEach((el) => (el.disabled = state));
  productForm.dataset.loading = state ? "1" : "0";
}

async function loadProduct(id) {
  const r = await apiFetch(`${API_BASE}/${id}`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`GET ${id} failed: ${r.status}`);
  return await r.json();
}

function fillProductForm(p) {
  const set = (name, val) => {
    if (productForm.elements[name]) productForm.elements[name].value = val ?? "";
  };
  set("id", p.id);
  set("sku", p.sku);
  set("name", p.name);
  set("brand", p.brand);
  set("model", p.model);
  set("category", p.category);
  set("subcategory", p.subcategory);
  set("catalog_brand", p.catalog_brand);
  set("catalog_model", p.catalog_model);
  set("catalog_piece", p.catalog_piece);
  set("tags", Array.isArray(p.tags) ? p.tags.join(", ") : p.tags ?? "");
  set("stock", p.stock);
  set("min_stock", p.min_stock);
  set("price_minorista", p.price_minorista);
  set("price_mayorista", p.price_mayorista);
  set("cost", p.cost);
  set("supplier_id", p.supplier_id);
  set("stock_mode", p.stock_mode || p.fulfillment_mode);
  set("remote_lead_min_days", p.remote_lead_min_days || p.remote_lead_days);
  set("remote_lead_max_days", p.remote_lead_max_days);
  if (productForm.elements["show_marketplace_trust"]) {
    productForm.elements["show_marketplace_trust"].checked =
      p.show_marketplace_trust === true ||
      p.show_marketplace_trust === 1 ||
      p.show_marketplace_trust === "1";
  }
  set("slug", p.slug);
  set("description", p.description);
  set("seoTitle", p.seoTitle || p.meta_title);
  set("seoDescription", p.seoDescription || p.meta_description);
  set("meta_title", p.meta_title);
  set("meta_description", p.meta_description);
  set("dimensions", p.dimensions);
  set("weight", p.weight);
  set("color", p.color);
  set("visibility", p.visibility);
  const imgs = Array.isArray(p.images) && p.images.length ? p.images : [p.image].filter(Boolean);
  const alts = Array.isArray(p.images_alt) ? p.images_alt : [];
  productImagesState = imgs.map((url, index) => ({
    url,
    alt: alts[index] || "",
  }));
  renderImageManager();
  if (tagsInput) {
    const hasTags = Array.isArray(p.tags) ? p.tags.length > 0 : Boolean(p.tags);
    tagsInput.dataset.autoGenerated = hasTags ? "" : "1";
    updateTagsPreview();
  }
  if (autoSeoToggle) {
    const hasCustomSeo = Boolean(
      p.seoTitle || p.seoDescription || p.meta_title || p.meta_description,
    );
    autoSeoToggle.checked = !hasCustomSeo;
  }
  if (autoTagsToggle) {
    const hasTags = Array.isArray(p.tags) ? p.tags.length > 0 : Boolean(p.tags);
    autoTagsToggle.checked = !hasTags;
  }
  productForm.dataset.manualSlug = p.slug ? "1" : "";
  updateSeoAdvancedVisibility();
  applyAutoAssist({ force: false });
}

function serializeProductForm(form) {
  const fd = new FormData(form);
  const obj = {};
  fd.forEach((v, k) => {
    obj[k] = typeof v === "string" ? v.trim() : v;
  });
  if (obj.tags) {
    obj.tags = obj.tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  ["stock", "min_stock", "price_minorista", "price_mayorista", "cost", "weight", "remote_lead_min_days", "remote_lead_max_days"].forEach(
    (k) => {
      if (k in obj && obj[k] !== "") obj[k] = Number(obj[k]);
    },
  );
  if ("show_marketplace_trust" in obj) {
    obj.show_marketplace_trust = obj.show_marketplace_trust === "1";
  }
  if (!obj.stock_mode) delete obj.stock_mode;
  if (!(obj.stock_mode === "remote" || obj.stock_mode === "physical")) {
    delete obj.remote_lead_min_days;
    delete obj.remote_lead_max_days;
  }
  ["catalog_brand", "catalog_model", "catalog_piece"].forEach((field) => {
    if (!(field in obj)) return;
    const value = cleanLabel(obj[field]);
    if (value) {
      obj[field] = value;
    } else {
      delete obj[field];
    }
  });
  obj.seoTitle = obj.seoTitle || "";
  obj.seoDescription = obj.seoDescription || "";
  obj.meta_title = obj.meta_title || obj.seoTitle;
  obj.meta_description = obj.meta_description || obj.seoDescription;
  const images = productImagesState.map((img) => img.url);
  const alts = productImagesState.map((img) => img.alt || "");
  obj.images = images;
  obj.images_alt = alts;
  obj.image = images[0] || "";
  if (!obj.image) delete obj.image;
  if (!obj.id) {
    delete obj.id;
  }
  return obj;
}

function renderProductFormPreview() {
  if (!productForm || !productPreviewCard) return;
  const data = serializeProductForm(productForm);
  const name = data.name || "Nuevo producto sin título";
  const sku = data.sku || "";
  const minor = Number(data.price_minorista);
  const mayor = Number(data.price_mayorista);
  const stock = Number(data.stock);
  const minStock = Number(data.min_stock);
  const slug = data.slug || (data.name ? slugify(data.name) : "");
  const category = data.category || "";
  const subcategory = data.subcategory || "";
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const visibility = data.visibility || "public";

  if (productPreviewName) {
    productPreviewName.textContent = name || "Nuevo producto";
  }
  if (productPreviewSku) {
    productPreviewSku.textContent = sku
      ? `SKU: ${sku}`
      : "Completá el SKU para identificar el producto.";
  }
  if (productPreviewPrice) {
    const parts = [];
    if (Number.isFinite(minor) && minor > 0) {
      const formatted = currencyFormatter ? currencyFormatter.format(minor) : `$${minor}`;
      parts.push(`Minorista ${formatted}`);
    }
    if (Number.isFinite(mayor) && mayor > 0) {
      const formatted = currencyFormatter ? currencyFormatter.format(mayor) : `$${mayor}`;
      parts.push(`Mayorista ${formatted}`);
    }
    productPreviewPrice.textContent = parts.length
      ? parts.join(" • ")
      : "Definí los precios para ver cómo se mostrará.";
  }
  if (productPreviewStock) {
    productPreviewStock.classList.remove("is-warning", "is-danger");
    let stockMessage = "Ingresá el stock disponible.";
    if (Number.isFinite(stock)) {
      stockMessage = `Stock actual: ${stock}`;
      if (Number.isFinite(minStock) && minStock > 0) {
        stockMessage += ` (mínimo ${minStock})`;
        if (stock <= 0) {
          productPreviewStock.classList.add("is-danger");
        } else if (stock < minStock) {
          productPreviewStock.classList.add("is-warning");
        }
      } else if (stock <= 0) {
        productPreviewStock.classList.add("is-danger");
      }
    } else if (Number.isFinite(minStock) && minStock > 0) {
      stockMessage = `Stock mínimo deseado: ${minStock}`;
    }
    const stockMode = (data.stock_mode || "").toLowerCase();
    if (stockMode === "remote") {
      const minLead = Number(data.remote_lead_min_days);
      const maxLead = Number(data.remote_lead_max_days);
      if (Number.isFinite(minLead) && minLead > 0) {
        stockMessage += Number.isFinite(maxLead) && maxLead >= minLead
          ? ` · Remoto: ${minLead}-${maxLead} días`
          : ` · Remoto: ${minLead} días`;
      } else {
        stockMessage += " · Remoto: plazo a confirmar";
      }
    }
    productPreviewStock.textContent = stockMessage;
  }
  if (productPreviewMeta) {
    const metaParts = [];
    const explorerBrand = cleanLabel(data.catalog_brand) || cleanLabel(data.brand);
    const explorerModel = cleanLabel(data.catalog_model) || cleanLabel(data.model);
    const explorerPiece = cleanLabel(data.catalog_piece);
    const explorerPath = [explorerBrand, explorerModel, explorerPiece]
      .filter(Boolean)
      .join(" › ");
    if (explorerPath) {
      metaParts.push(`Explorador: ${explorerPath}`);
    } else {
      metaParts.push("Explorador: Automático");
    }
    if (category) metaParts.push(`Categoría: ${category}`);
    if (subcategory) metaParts.push(`Subcategoría: ${subcategory}`);
    if (tags.length) {
      const previewTags = tags.slice(0, 3).join(", ");
      metaParts.push(`Tags: ${previewTags}${tags.length > 3 ? "…" : ""}`);
    }
    const visibilityLabel =
      visibility === "private"
        ? "Visibilidad: Privado"
        : visibility === "draft"
        ? "Visibilidad: Borrador"
        : "Visibilidad: Público";
    metaParts.push(visibilityLabel);
    if (slug) {
      metaParts.push(`URL: /productos/${slug}`);
    } else {
      metaParts.push("Definí el nombre para generar la URL pública.");
    }
    productPreviewMeta.textContent = metaParts.join(" • ");
  }

  const primaryImage = productImagesState[0]?.url || "";
  const hasImage = Boolean(primaryImage);
  if (productPreviewMedia) {
    productPreviewMedia.classList.toggle(
      "product-preview__media--has-image",
      hasImage,
    );
  }
  if (productPreviewPlaceholder) {
    productPreviewPlaceholder.textContent = hasImage ? "" : "Sin imagen";
  }
  if (productPreviewImage) {
    if (hasImage) {
      productPreviewImage.src = primaryImage;
      productPreviewImage.alt = name
        ? `Imagen de ${name}`
        : "Vista previa del producto";
    } else {
      productPreviewImage.removeAttribute("src");
      productPreviewImage.alt = "Vista previa del producto";
    }
  }
}

function diffObjects(original = {}, current = {}) {
  const out = {};
  const keys = new Set([...Object.keys(original), ...Object.keys(current)]);
  keys.forEach((k) => {
    const a = original[k];
    const b = current[k];
    const isObj =
      (typeof a === "object" && a !== null) || (typeof b === "object" && b !== null);
    const A = isObj ? JSON.stringify(a ?? null) : a == null ? "" : String(a);
    const B = isObj ? JSON.stringify(b ?? null) : b == null ? "" : String(b);
    if (A !== B) out[k] = current[k];
  });
  delete out.id;
  return out;
}

async function openProductModal(id) {
  const skuInput = productForm.elements["sku"];
  deleteProductBtn.style.display = id ? "inline-block" : "none";
  duplicateProductBtn.style.display = id ? "inline-block" : "none";

  const supplierSelect = document.getElementById("productSupplier");
  if (suppliersCache.length === 0) {
    try {
      const resp = await apiFetch("/api/suppliers");
      if (resp.ok) {
        const data = await resp.json();
        suppliersCache = data.suppliers;
      }
    } catch (e) {
      console.error(e);
    }
  }
  supplierSelect.innerHTML =
    '<option value="">Proveedor</option>' +
    suppliersCache.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");

  if (!id) {
    productForm.reset();
    productImagesState = [];
    renderImageManager();
    originalProduct = null;
    skuInput.readOnly = false;
    if (productForm.elements.visibility) {
      productForm.elements.visibility.value = "public";
    }
    modalTitle.textContent = "Agregar producto";
    resetAutoAssistState();
    updateTagsPreview();
    applyAutoAssist({ force: true });
    productModal.classList.remove("hidden");
    return;
  }

  modalTitle.textContent = "Editar producto";
  skuInput.readOnly = true;
  const cached = productsCache.find((p) => String(p.id) === String(id));
  if (cached) {
    originalProduct = cached;
    fillProductForm(cached);
  } else {
    productForm.reset();
    productImagesState = [];
    renderImageManager();
    originalProduct = null;
    resetAutoAssistState();
    updateTagsPreview();
    applyAutoAssist({ force: true });
  }
  productModal.classList.remove("hidden");
  try {
    setLoading(true);
    const p = await loadProduct(id);
    originalProduct = p;
    fillProductForm(p);
  } catch (err) {
    console.error("Failed to load product", err);
    if (!cached && window.showToast) showToast("No se pudo cargar el producto.");
  } finally {
    setLoading(false);
  }
}

async function saveProduct(e) {
  e.preventDefault();
  const data = serializeProductForm(productForm);
  const isEdit = Boolean(data.id);
  if (!isEdit && !data.sku) {
    if (window.showToast) showToast("SKU requerido");
    return;
  }
  if (
    (typeof data.stock === "number" && data.stock < 0) ||
    (typeof data.min_stock === "number" && data.min_stock < 0)
  ) {
    if (window.showToast) showToast("Stock no puede ser negativo");
    return;
  }
  try {
    setLoading(true);
    let res;
    let responseBody = {};
    let highlightId = null;
    if (isEdit) {
      const payload = diffObjects(originalProduct, data);
      if (Object.keys(payload).length === 0) {
        productModal.classList.add("hidden");
        return;
      }
      res = await apiFetch(`${API_BASE}/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      res = await apiFetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    }
    responseBody = (await res.json().catch(() => ({}))) || {};
    if (!res.ok) {
      throw new Error(
        responseBody.error ||
          (isEdit
            ? "No se pudo actualizar el producto."
            : "No se pudo crear el producto."),
      );
    }
    highlightId = responseBody.product?.id ?? data.id;
    if (window.showToast) {
      showToast(isEdit ? "Producto actualizado" : "Producto agregado");
    }
    productModal.classList.add("hidden");
    await loadProducts({ highlightId });
  } catch (err) {
    console.error(err);
    if (window.showToast) {
      showToast(err.message || "Error al guardar. Revisá los campos.");
    }
  } finally {
    setLoading(false);
  }
}

productForm.addEventListener("submit", saveProduct);
if (suggestFulfillmentBtn) {
  suggestFulfillmentBtn.addEventListener("click", applySuggestedFulfillment);
}

async function loadProducts(options = {}) {
  if (!productsTableBody) return;
  const { highlightId } = options;
  try {
    productsTableBody.innerHTML =
      '<tr><td colspan="15">Cargando productos…</td></tr>';
    const query = new URLSearchParams({
      page: String(productsPage),
      pageSize: String(productsPageSize),
      search: productFilters.query || "",
      category: productFilters.category || "",
      visibility: productFilters.visibility || "",
      stockStatus: productFilters.stock || "",
      sort: productFilters.sort || "recent",
    });
    const res = await apiFetch(`/api/admin/products?${query.toString()}`, {
      headers: getAdminHeaders(),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error("No autorizado. Iniciá sesión con una cuenta con permisos de admin.");
      }
      throw new Error(`GET /api/admin/products failed: ${res.status}`);
    }
    const data = await res.json();
    productsLoadErrorMessage = "";
    productsCache = Array.isArray(data.items) ? data.items : [];
    productsTotalItems = Number(data.totalItems || productsCache.length);
    productsTotalPages = Number(data.totalPages || 1);
    productsPage = Number(data.page || productsPage);
    syncProductTaxonomies(productsCache);
    renderProductsTable();
    const start = productsTotalItems ? (productsPage - 1) * productsPageSize + 1 : 0;
    const end = Math.min(productsPage * productsPageSize, productsTotalItems);
    if (adminProductsRange) {
      adminProductsRange.textContent = `Mostrando ${start}-${end} de ${productsTotalItems} productos`;
    }
    if (adminProductsPageInfo) {
      adminProductsPageInfo.textContent = `Página ${productsPage} / ${productsTotalPages}`;
    }
    if (adminProductsPrevPage) adminProductsPrevPage.disabled = productsPage <= 1;
    if (adminProductsNextPage) adminProductsNextPage.disabled = productsPage >= productsTotalPages;
    if (highlightId) {
      highlightProductRow(highlightId);
    }
  } catch (err) {
    console.error(err);
    let details = "";
    try {
      const debugQuery = new URLSearchParams({
        page: String(productsPage),
        pageSize: String(productsPageSize),
        search: productFilters.query || "",
        category: productFilters.category || "",
        visibility: productFilters.visibility || "",
        stockStatus: productFilters.stock || "",
        sort: productFilters.sort || "recent",
      });
      const debugRes = await apiFetch(`/api/admin/products?${debugQuery.toString()}`, {
        headers: getAdminHeaders(),
      });
      const debugBody = await debugRes.text();
      details = ` (status ${debugRes.status}${debugBody ? `, body: ${debugBody.slice(0, 300)}` : ""})`;
      console.error("admin-products-debug", {
        status: debugRes.status,
        body: debugBody.slice(0, 1000),
      });
    } catch (debugErr) {
      console.error("admin-products-debug-failed", debugErr);
    }
    productsLoadErrorMessage = `${err.message || "No se pudieron cargar los productos."}${details}`;
    productsTableBody.innerHTML =
      `<tr><td colspan="15">${escapeHtml(productsLoadErrorMessage)}</td></tr>`;
    updateProductSummary([]);
  }
}

function debounce(fn, t = 600) {
  let i;
  return (...a) => {
    clearTimeout(i);
    i = setTimeout(() => fn(...a), t);
  };
}

async function patchField(id, field, value, input) {
  const old = input.dataset.original;
  try {
    const r = await apiFetch(`${API_BASE}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!r.ok) throw new Error("patch fail");
    highlightProductRow(id);
  } catch (e) {
    console.error(e);
    if (window.showToast) showToast("No se pudo actualizar");
    input.value = old;
  }
}
const debouncedPatch = debounce(patchField);

if (productsTableBody) {
  productsTableBody.addEventListener("focusin", (e) => {
    const input = e.target;
    if (input.classList.contains("inline-edit")) {
      input.dataset.original = input.value;
    }
  });

  productsTableBody.addEventListener("input", (e) => {
    const input = e.target;
    if (!input.classList.contains("inline-edit")) return;
    const row = input.closest("tr");
    if (!row) return;
    const id = row.dataset.id;
    const field = input.dataset.field;
    const value = input.type === "number" ? Number(input.value) : input.value;
    debouncedPatch(id, field, value, input);
    const product = productsCache.find((item) => String(item.id) === String(id));
    if (product) {
      product[field] = value;
      updateProductSummary(productsCache);
    }
  });
}

if (selectAllCheckbox) {
  selectAllCheckbox.addEventListener("change", () => {
    const checked = selectAllCheckbox.checked;
    document
      .querySelectorAll(".select-product")
      .forEach((cb) => (cb.checked = checked));
  });
}

if (bulkSelect && bulkValueInput) {
  bulkSelect.addEventListener("change", () => {
    bulkValueInput.style.display = bulkSelect.value.startsWith("price")
      ? "inline-block"
      : "none";
  });
}

if (applyBulkBtn && bulkSelect) {
  applyBulkBtn.addEventListener("click", async () => {
    const action = bulkSelect.value;
  const selected = Array.from(
    document.querySelectorAll(".select-product:checked"),
  ).map((cb) => cb.closest("tr").dataset.id);
  if (selected.length === 0) {
    alert("Seleccione productos");
    return;
  }
  if (action === "delete") {
    if (!confirm("¿Eliminar productos seleccionados?")) return;
    for (const id of selected) {
      await apiFetch(`/api/products/${id}`, { method: "DELETE" });
    }
  } else if (action.startsWith("vis-")) {
    const vis = action.split("-")[1];
    for (const id of selected) {
      await apiFetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: vis }),
      });
    }
  } else if (action.startsWith("price")) {
    const pct = parseFloat(bulkValueInput.value);
    if (isNaN(pct)) {
      alert("Ingrese un porcentaje válido");
      return;
    }
    for (const id of selected) {
      const row = document.querySelector(`tr[data-id='${id}']`);
      const minorInput = row.querySelector("input[data-field='price_minorista']");
      const mayorInput = row.querySelector("input[data-field='price_mayorista']");
      const factor = action === "price-inc" ? 1 + pct / 100 : 1 - pct / 100;
      const newMinor = Math.round(parseFloat(minorInput.value) * factor);
      const newMayor = Math.round(parseFloat(mayorInput.value) * factor);
      await apiFetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price_minorista: newMinor,
          price_mayorista: newMayor,
        }),
      });
    }
  }
  loadProducts();
  });
}

async function deleteProduct(id) {
  if (!confirm("¿Estás seguro de eliminar este producto?")) return;
  const resp = await apiFetch(`/api/products/${id}`, { method: "DELETE" });
  if (resp.ok) {
    loadProducts();
  } else {
    alert("Error al eliminar");
  }
}

deleteProductBtn.addEventListener("click", async () => {
  const id = productForm.elements.id.value;
  if (!id || !confirm("¿Eliminar producto?")) return;
  const resp = await apiFetch(`${API_BASE}/${id}`, { method: "DELETE" });
  if (resp.ok) {
    productModal.classList.add("hidden");
    loadProducts();
  } else {
    alert("Error al eliminar");
  }
});

duplicateProductBtn.addEventListener("click", async () => {
  const id = productForm.elements.id.value;
  if (!id) return;
  try {
    const resp = await apiFetch(`${API_BASE}/${id}/duplicate`, {
      method: "POST",
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(body.error || "Error al duplicar");
    }
    if (window.showToast) {
      showToast("Producto duplicado");
    } else {
      alert("Producto duplicado");
    }
    await loadProducts({ highlightId: body.product?.id });
  } catch (error) {
    console.error(error);
    if (window.showToast) {
      showToast(error.message || "Error al duplicar");
    } else {
      alert("Error al duplicar");
    }
  }
});

async function importCatalogCsvFromAdmin() {
  if (currentRole !== "admin") {
    alert("Solo administradores pueden importar CSV.");
    return;
  }
  if (!catalogCsvFileInput || !catalogCsvFileInput.files?.length) {
    alert("Seleccioná un archivo CSV antes de importar.");
    return;
  }
  const file = catalogCsvFileInput.files[0];
  const formData = new FormData();
  formData.append("file", file);

  if (catalogCsvImportStatus) {
    catalogCsvImportStatus.textContent = "Importando catálogo… esto puede tardar unos minutos.";
    catalogCsvImportStatus.style.color = "";
  }
  if (catalogCsvImportProgress) {
    catalogCsvImportProgress.value = 0;
    catalogCsvImportProgress.style.display = "block";
  }
  if (importCatalogCsvBtn) importCatalogCsvBtn.disabled = true;
  if (importStockXlsxBtn) importStockXlsxBtn.disabled = true;

  try {
    const includeOutOfStock = Boolean(catalogCsvIncludeOutOfStock?.checked);
    const archiveMissing = catalogCsvArchiveMissing?.checked !== false;
    const query = new URLSearchParams();
    if (includeOutOfStock) query.set("includeOutOfStock", "1");
    if (archiveMissing) query.set("archiveMissing", "1");
    const importUrl = `/api/admin/import/catalog-csv${query.toString() ? `?${query.toString()}` : ""}`;

    const resp = await apiFetch(importUrl, {
      method: "POST",
      headers: getAdminHeaders(),
      body: formData,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || "No se pudo importar el CSV");
    }
    const jobId = data.jobId;
    if (!jobId) {
      throw new Error("No se recibió jobId para monitorear la importación");
    }
    let summary = null;
    while (!summary) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const progressResp = await apiFetch(`/api/admin/import/jobs/${encodeURIComponent(jobId)}`, {
        headers: getAdminHeaders(),
      });
      const job = await progressResp.json().catch(() => ({}));
      if (!progressResp.ok) {
        throw new Error(job.error || "No se pudo consultar progreso de importación");
      }
      if (catalogCsvImportProgress) {
        catalogCsvImportProgress.value = Number(job.progress || 0);
      }
      if (catalogCsvImportStatus) {
        catalogCsvImportStatus.textContent =
          `${job.message || "Importando catálogo…"} ${job.progress || 0}% · ` +
          `${job.processedRows || 0} / ${job.totalRows || 0} filas · ` +
          `Insertados: ${job.inserted || 0} · Actualizados: ${job.updated || 0} · ` +
          `Salteados: ${job.skipped || 0} · Errores: ${job.errors || 0}`;
      }
      if (job.status === "failed") {
        throw new Error(job.error || job.message || "Falló la importación CSV");
      }
      if (job.status === "completed") {
        summary = job.summary || {};
      }
    }
    const pricing = summary.pricing || {};
    const safety = summary.safety || {};
    const catalog = summary.catalog || {};
    const statusMessage =
      `Importación OK · Filas: ${summary.totalRows || 0} · ` +
      `Insertados: ${summary.inserted || 0} · Actualizados: ${summary.updated || 0} · ` +
      `Desactivados por no venir en CSV: ${safety.archivedMissing || 0} · ` +
      `Salteados por stock/estado: ${safety.skippedUnavailable || 0} · ` +
      `Errores: ${summary.failed || 0} · Pricing OK: ${pricing.okRows || 0} · ` +
      `Revisión: ${pricing.revisionRows || 0} · ` +
      `Catálogo final: ${catalog.totalProductsAfterImport || 0} · ` +
      `Con supplierPartNumber: ${catalog.withSupplierPartNumber || 0} · ` +
      `Match potencial XLSX: ${catalog.potentialXlsxMatches || 0} · ` +
      `Publicables: ${catalog.visibleOrPublishable || 0} · ` +
      `Ocultos por stock/ordenable: ${catalog.hiddenNoStockOrNotOrderable || 0}`;
    const skippedUnavailable = Number(safety.skippedUnavailable || 0);
    const showAvailabilityHint = !includeOutOfStock && skippedUnavailable > 0;
    const availabilityBreakdown = showAvailabilityHint
      ? ` (sin stock: ${safety.skippedNoStock || 0}, no ordenables: ${safety.skippedNotOrderable || 0}, estado no disponible: ${safety.skippedStatusNotAvailable || 0}, máximo pedido 0: ${safety.skippedMaxOrderZero || 0})`
      : "";
    const availabilityHint = showAvailabilityHint
      ? ` Tip: activá “Incluir sin stock/no ordenables” para importar también esos registros.${availabilityBreakdown}`
      : "";
    const fullStatusMessage = `${statusMessage}${availabilityHint}`;

    if (catalogCsvImportStatus) {
      catalogCsvImportStatus.textContent = fullStatusMessage;
      catalogCsvImportStatus.style.color = "green";
    }
    if (window.showToast) {
      window.showToast("CSV importado correctamente");
    } else {
      alert(fullStatusMessage);
    }
    catalogCsvFileInput.value = "";
    await loadProducts();
  } catch (error) {
    console.error("catalog-csv-admin-import", error);
    const message = error?.message || "No se pudo importar el CSV";
    if (catalogCsvImportStatus) {
      catalogCsvImportStatus.textContent = message;
      catalogCsvImportStatus.style.color = "crimson";
    }
    if (window.showToast) {
      window.showToast(message);
    } else {
      alert(message);
    }
  } finally {
    if (importCatalogCsvBtn) importCatalogCsvBtn.disabled = false;
    if (importStockXlsxBtn) importStockXlsxBtn.disabled = false;
    if (catalogCsvImportProgress && catalogCsvImportProgress.value >= 100) {
      catalogCsvImportProgress.style.display = "none";
    }
  }
}

if (importCatalogCsvBtn) {
  importCatalogCsvBtn.addEventListener("click", importCatalogCsvFromAdmin);
}

async function importStockXlsxFromAdmin() {
  if (currentRole !== "admin") {
    alert("Solo administradores pueden importar stock XLSX.");
    return;
  }
  if (!stockXlsxFileInput || !stockXlsxFileInput.files?.length) {
    alert("Seleccioná un archivo XLSX antes de importar.");
    return;
  }

  const file = stockXlsxFileInput.files[0];
  const formData = new FormData();
  formData.append("file", file);

  if (stockXlsxImportStatus) {
    stockXlsxImportStatus.textContent = "Importando stock real desde XLSX…";
    stockXlsxImportStatus.style.color = "";
  }
  if (stockXlsxImportProgress) {
    stockXlsxImportProgress.value = 0;
    stockXlsxImportProgress.style.display = "block";
  }
  if (importStockXlsxBtn) importStockXlsxBtn.disabled = true;
  if (importCatalogCsvBtn) importCatalogCsvBtn.disabled = true;

  try {
    const zeroMissing = Boolean(stockXlsxZeroMissingProducts?.checked);
    const query = new URLSearchParams();
    if (zeroMissing) query.set("zeroMissingProducts", "1");
    const importUrl = `/api/admin/import/stock-xlsx${query.toString() ? `?${query.toString()}` : ""}`;

    const resp = await apiFetch(importUrl, {
      method: "POST",
      headers: getAdminHeaders(),
      body: formData,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || "No se pudo importar stock XLSX");
    }

    const jobId = data.jobId;
    if (!jobId) {
      throw new Error("No se recibió jobId para monitorear la importación");
    }
    let summary = null;
    while (!summary) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const progressResp = await apiFetch(`/api/admin/import/jobs/${encodeURIComponent(jobId)}`, {
        headers: getAdminHeaders(),
      });
      const job = await progressResp.json().catch(() => ({}));
      if (!progressResp.ok) {
        throw new Error(job.error || "No se pudo consultar progreso de importación");
      }
      if (stockXlsxImportProgress) {
        stockXlsxImportProgress.value = Number(job.progress || 0);
      }
      if (stockXlsxImportStatus) {
        stockXlsxImportStatus.textContent =
          `${job.message || "Importando stock real…"} ${job.progress || 0}% · ` +
          `${job.processedRows || 0} / ${job.totalRows || 0} filas · ` +
          `Actualizados: ${job.updated || 0} · Sin match: ${job.skipped || 0} · ` +
          `Errores: ${job.errors || 0}`;
      }
      if (job.status === "failed") {
        throw new Error(job.error || job.message || "Falló la importación XLSX");
      }
      if (job.status === "completed") {
        summary = job.summary || {};
      }
    }
    const statusMessage =
      `Stock XLSX OK · Filas: ${summary.totalRows || 0} · ` +
      `Matcheados: ${summary.matchedProducts || 0} · ` +
      `Actualizados: ${summary.updatedProducts || 0} · ` +
      `Sin match: ${summary.unmatchedRows || 0} · ` +
      `Stock 0: ${summary.zeroStockRows || 0} · ` +
      `Stock con +: ${summary.stockWithPlus || 0} · ` +
      `Errores: ${summary.failedRows || 0} · ` +
      `No listados seteados en 0: ${summary.zeroedMissingProducts || 0}`;

    if (stockXlsxImportStatus) {
      stockXlsxImportStatus.textContent = statusMessage;
      stockXlsxImportStatus.style.color = "green";
    }
    if (window.showToast) {
      window.showToast("Stock XLSX importado correctamente");
    } else {
      alert(statusMessage);
    }
    stockXlsxFileInput.value = "";
    await loadProducts();
  } catch (error) {
    console.error("stock-xlsx-admin-import", error);
    const message = error?.message || "No se pudo importar stock XLSX";
    if (stockXlsxImportStatus) {
      stockXlsxImportStatus.textContent = message;
      stockXlsxImportStatus.style.color = "crimson";
    }
    if (window.showToast) {
      window.showToast(message);
    } else {
      alert(message);
    }
  } finally {
    if (importStockXlsxBtn) importStockXlsxBtn.disabled = false;
    if (importCatalogCsvBtn) importCatalogCsvBtn.disabled = false;
    if (stockXlsxImportProgress && stockXlsxImportProgress.value >= 100) {
      stockXlsxImportProgress.style.display = "none";
    }
  }
}

if (importStockXlsxBtn) {
  importStockXlsxBtn.addEventListener("click", importStockXlsxFromAdmin);
}

if (currentRole !== "admin") {
  if (importCatalogCsvBtn) importCatalogCsvBtn.style.display = "none";
  if (catalogCsvFileInput) catalogCsvFileInput.style.display = "none";
  if (catalogCsvImportStatus) catalogCsvImportStatus.style.display = "none";
  if (importStockXlsxBtn) importStockXlsxBtn.style.display = "none";
  if (stockXlsxFileInput) stockXlsxFileInput.style.display = "none";
  if (stockXlsxZeroMissingProductsWrap) stockXlsxZeroMissingProductsWrap.style.display = "none";
  if (stockXlsxImportStatus) stockXlsxImportStatus.style.display = "none";
}

// ------------ Proveedores ------------
const suppliersTableBody = document.querySelector("#suppliersTable tbody");
const addSupplierForm = document.getElementById("addSupplierForm");

async function loadSuppliers() {
  try {
    const res = await apiFetch("/api/suppliers");
    const data = await res.json();
    suppliersTableBody.innerHTML = "";
    data.suppliers.forEach((sup) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${sup.id}</td>
        <td>${sup.name}</td>
        <td>${sup.contact || ""}</td>
        <td>${sup.email || ""}</td>
        <td>${sup.phone || ""}</td>
        <td>${sup.address || ""}</td>
        <td>${sup.payment_terms || ""}</td>
        <td>${sup.rating != null ? sup.rating : ""}</td>
        <td>
          <button class="edit-sup-btn">Editar</button>
          <button class="delete-sup-btn">Eliminar</button>
        </td>
      `;
      // Editar proveedor
      tr.querySelector(".edit-sup-btn").addEventListener("click", async () => {
        const name = prompt("Nombre", sup.name);
        if (name === null) return;
        const contact = prompt("Contacto", sup.contact || "");
        if (contact === null) return;
        const email = prompt("Correo electrónico", sup.email || "");
        if (email === null) return;
        const phone = prompt("Teléfono", sup.phone || "");
        if (phone === null) return;
        const address = prompt("Dirección", sup.address || "");
        if (address === null) return;
        const terms = prompt("Condiciones de pago", sup.payment_terms || "");
        if (terms === null) return;
        const rating = prompt(
          "Valoración (0–5)",
          sup.rating != null ? sup.rating : "",
        );
        if (rating === null) return;
        const update = {
          name,
          contact,
          email,
          phone,
          address,
          payment_terms: terms,
          rating: rating !== "" ? parseFloat(rating) : null,
        };
        const resp = await apiFetch(`/api/suppliers/${sup.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });
        if (resp.ok) {
          alert("Proveedor actualizado");
          loadSuppliers();
        } else {
          alert("Error al actualizar proveedor");
        }
      });
      // Eliminar proveedor
      tr.querySelector(".delete-sup-btn").addEventListener(
        "click",
        async () => {
          if (!confirm("¿Deseas eliminar este proveedor?")) return;
          const resp = await apiFetch(`/api/suppliers/${sup.id}`, {
            method: "DELETE",
          });
          if (resp.ok) {
            alert("Proveedor eliminado");
            loadSuppliers();
          } else {
            alert("Error al eliminar proveedor");
          }
        },
      );
      suppliersTableBody.appendChild(tr);
    });
    // Cargar proveedores en selector de órdenes de compra
    populateSupplierSelect(data.suppliers);
  } catch (err) {
    console.error(err);
    suppliersTableBody.innerHTML =
      '<tr><td colspan="9">No se pudieron cargar los proveedores</td></tr>';
  }
}

// Manejo del formulario de proveedores
if (addSupplierForm) {
  addSupplierForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newSup = {
      name: document.getElementById("supName").value.trim(),
      contact: document.getElementById("supContact").value.trim(),
      email: document.getElementById("supEmail").value.trim(),
      phone: document.getElementById("supPhone").value.trim(),
      address: document.getElementById("supAddress").value.trim(),
      payment_terms: document.getElementById("supTerms").value.trim(),
      rating: parseFloat(document.getElementById("supRating").value) || null,
    };
    try {
      const resp = await apiFetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSup),
      });
      if (resp.ok) {
        alert("Proveedor agregado");
        addSupplierForm.reset();
        loadSuppliers();
      } else {
        alert("Error al agregar proveedor");
      }
    } catch (err) {
      console.error(err);
      alert("Error de red");
    }
  });
}

// ------------ Órdenes de compra ------------
const purchaseOrdersTableBody = document.querySelector(
  "#purchaseOrdersTable tbody",
);
const addPoForm = document.getElementById("addPurchaseOrderForm");
const poSupplierSelect = document.getElementById("poSupplierSelect");
const poItemsContainer = document.getElementById("poItemsContainer");
const addPoItemBtn = document.getElementById("addPoItemBtn");

function populateSupplierSelect(suppliers) {
  if (!poSupplierSelect) return;
  poSupplierSelect.innerHTML =
    '<option value="">Seleccionar proveedor</option>';
  suppliers.forEach((sup) => {
    const opt = document.createElement("option");
    opt.value = sup.id;
    opt.textContent = sup.name;
    poSupplierSelect.appendChild(opt);
  });
}

// Agregar fila de ítem dinámicamente
if (addPoItemBtn) {
  addPoItemBtn.addEventListener("click", (e) => {
    e.preventDefault();
    addPoItemRow();
  });
}

function addPoItemRow() {
  const row = document.createElement("div");
  row.classList.add("po-item-row");
  row.innerHTML = `
    <input type="text" placeholder="SKU o ID" class="po-sku" required />
    <input type="number" placeholder="Cantidad" class="po-qty" min="1" required />
    <input type="number" placeholder="Coste unitario" class="po-cost" min="0" step="0.01" required />
    <button type="button" class="remove-po-item">X</button>
  `;
  row.querySelector(".remove-po-item").addEventListener("click", () => {
    poItemsContainer.removeChild(row);
  });
  poItemsContainer.appendChild(row);
}

async function loadPurchaseOrders() {
  try {
    const res = await apiFetch("/api/purchase-orders");
    const data = await res.json();
    purchaseOrdersTableBody.innerHTML = "";
    data.purchaseOrders.forEach((po) => {
      const tr = document.createElement("tr");
      const itemsSummary = po.items
        ? po.items.map((it) => `${it.sku || it.id} x${it.quantity}`).join(", ")
        : "";
      tr.innerHTML = `
        <td>${po.id}</td>
        <td>${new Date(po.date).toLocaleString()}</td>
        <td>${po.supplier}</td>
        <td>${itemsSummary}</td>
        <td>${po.status}</td>
        <td>${po.eta || ""}</td>
        <td>
          <button class="edit-po-status">Cambiar estado</button>
          <button class="delete-po">Eliminar</button>
        </td>
      `;
      // Cambiar estado
      tr.querySelector(".edit-po-status").addEventListener(
        "click",
        async () => {
          const newStatus = prompt(
            "Estado (pendiente, aprobada, recibido)",
            po.status,
          );
          if (!newStatus) return;
          const update = { status: newStatus.toLowerCase() };
          const resp = await apiFetch(`/api/purchase-orders/${po.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(update),
          });
          if (resp.ok) {
            alert("Orden actualizada");
            loadPurchaseOrders();
          } else {
            alert("Error al actualizar la orden");
          }
        },
      );
      // Eliminar
      tr.querySelector(".delete-po").addEventListener("click", async () => {
        if (!confirm("¿Eliminar esta orden de compra?")) return;
        const resp = await apiFetch(`/api/purchase-orders/${po.id}`, {
          method: "DELETE",
        });
        if (resp.ok) {
          alert("Orden eliminada");
          loadPurchaseOrders();
        } else {
          alert("Error al eliminar la orden");
        }
      });
      purchaseOrdersTableBody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    purchaseOrdersTableBody.innerHTML =
      '<tr><td colspan="7">No se pudieron cargar las órdenes de compra</td></tr>';
  }
  // Cargar proveedores y productos para crear órdenes
  loadSuppliers();
}

// Manejo del formulario de órdenes de compra
if (addPoForm) {
  addPoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const supplierId = poSupplierSelect.value;
    if (!supplierId) {
      alert("Selecciona un proveedor");
      return;
    }
    const items = [];
    const rows = poItemsContainer.querySelectorAll(".po-item-row");
    rows.forEach((row) => {
      const skuOrId = row.querySelector(".po-sku").value.trim();
      const qty = parseInt(row.querySelector(".po-qty").value, 10);
      const cost = parseFloat(row.querySelector(".po-cost").value);
      if (skuOrId && qty > 0) {
        items.push({ sku: skuOrId, quantity: qty, cost });
      }
    });
    if (items.length === 0) {
      alert("Agrega al menos un ítem");
      return;
    }
    const order = {
      supplier: supplierId,
      items,
      eta: document.getElementById("poEta").value || "",
    };
    try {
      const resp = await apiFetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(order),
      });
      if (resp.ok) {
        alert("Orden de compra creada");
        // Resetear formulario
        addPoForm.reset();
        poItemsContainer.innerHTML = "";
        loadPurchaseOrders();
      } else {
        alert("Error al crear la orden");
      }
    } catch (err) {
      console.error(err);
      alert("Error de red");
    }
  });
}

// ------------ Analíticas detalladas ------------
function isAnalyticsSectionVisible() {
  if (!analyticsSection) return false;
  return analyticsSection.style.display !== "none";
}

async function loadAnalytics(options = {}) {
  if (!analyticsSection) return;
  const { skipIfHidden = false } = options || {};
  if (skipIfHidden && !isAnalyticsSectionVisible()) {
    return;
  }
  if (analyticsLoading) return;
  analyticsLoading = true;
  try {
    await renderAnalyticsDashboard("analytics-dashboard", {
      autoRefreshMs: analyticsAutoRefreshMs,
    });
  } catch (err) {
    console.error("analytics-dashboard-refresh-error", err);
  } finally {
    analyticsLoading = false;
  }
}

function stopAnalyticsAutoRefresh() {
  analyticsAutoRefreshMs = null;
  if (analyticsRefreshTimer) {
    clearInterval(analyticsRefreshTimer);
    analyticsRefreshTimer = null;
  }
}

function startAnalyticsAutoRefresh({ immediate = true } = {}) {
  if (!isAnalyticsSectionVisible()) {
    return;
  }
  stopAnalyticsAutoRefresh();
  analyticsAutoRefreshMs = ANALYTICS_REFRESH_INTERVAL_MS;
  if (immediate) {
    loadAnalytics();
  }
  analyticsRefreshTimer = window.setInterval(() => {
    if (!isAnalyticsSectionVisible()) {
      stopAnalyticsAutoRefresh();
      return;
    }
    loadAnalytics({ skipIfHidden: true });
  }, ANALYTICS_REFRESH_INTERVAL_MS);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAnalyticsAutoRefresh();
    } else if (isAnalyticsSectionVisible()) {
      startAnalyticsAutoRefresh();
    }
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    stopAnalyticsAutoRefresh();
  });
}

if (isAnalyticsSectionVisible()) {
  startAnalyticsAutoRefresh();
}

// ------------ Pedidos ------------
const OrdersUI = (() => {
  const pageSize = 100;
  const elements = {};
  const state = {
    date: formatInputDate(new Date()),
    status: "all",
    q: "",
    includeDeleted: false,
    page: 1,
    selectedId: null,
    detail: null,
  };
  const allowOrderEditing =
    typeof window !== "undefined" &&
    window.location &&
    typeof window.location.pathname === "string" &&
    window.location.pathname.includes("admin.html");
  const PAYMENT_STATUS_OPTIONS = [
    { value: "approved", label: "Pagado" },
    { value: "pending", label: "Pendiente" },
    { value: "rejected", label: "Rechazado" },
    { value: "cancelled", label: "Cancelado" },
  ];
  const PAYMENT_STATUS_CODE_MAP = {
    pagado: "approved",
    pago: "approved",
    pagada: "approved",
    approved: "approved",
    paid: "approved",
    acreditado: "approved",
    accredited: "approved",
    pending: "pending",
    pendiente: "pending",
    "in_process": "pending",
    "in process": "pending",
    proceso: "pending",
    rechazado: "rejected",
    rechazada: "rejected",
    rejected: "rejected",
    cancelado: "rejected",
    cancelled: "cancelled",
    canceled: "cancelled",
    refunded: "rejected",
    refund: "rejected",
    devuelto: "rejected",
  };
  const PAYMENT_STATUS_LABELS = {
    approved: "Pagado",
    pending: "Pendiente",
    rejected: "Rechazado",
    cancelled: "Cancelado",
  };
  const SHIPPING_STATUS_OPTIONS = [
    { value: "preparing", label: "En preparación" },
    { value: "shipped", label: "Enviado" },
    { value: "delivered", label: "Entregado" },
    { value: "cancelled", label: "Cancelado" },
  ];
  const SHIPPING_STATUS_CODE_MAP = {
    pendiente: "preparing",
    pending: "preparing",
    preparando: "preparing",
    "en preparación": "preparing",
    "en preparacion": "preparing",
    preparacion: "preparing",
    preparing: "preparing",
    listo: "preparing",
    ready: "preparing",
    enviado: "shipped",
    envio: "shipped",
    shipped: "shipped",
    despachado: "shipped",
    entregado: "delivered",
    entregada: "delivered",
    delivered: "delivered",
    finalizado: "delivered",
    cancelado: "cancelled",
    cancelled: "cancelled",
    canceled: "cancelled",
  };
  const SHIPPING_STATUS_LABELS = {
    preparing: "En preparación",
    shipped: "Enviado",
    delivered: "Entregado",
    cancelled: "Cancelado",
  };
  const ORDER_STATUS_QUERY_MAP = {
    todos: "",
    all: "",
    pagado: "approved",
    pendiente: "pending",
    rechazado: "rejected",
    cancelado: "cancelled",
    cancelled: "cancelled",
    canceled: "cancelled",
    approved: "approved",
    pending: "pending",
    rejected: "rejected",
  };
  let cache = { items: [], summary: null };
  let initialized = false;
  let searchTimer;

  function mapPaymentStatusCodeForUi(status) {
    if (!status && status !== 0) return "pending";
    const key = String(status).trim().toLowerCase();
    if (PAYMENT_STATUS_CODE_MAP[key]) return PAYMENT_STATUS_CODE_MAP[key];
    if (
      key === "approved" ||
      key === "pending" ||
      key === "rejected" ||
      key === "cancelled"
    ) {
      return key;
    }
    return "pending";
  }

  function localizePaymentStatus(status) {
    const code = mapPaymentStatusCodeForUi(status);
    return PAYMENT_STATUS_LABELS[code] || (status ? String(status) : "");
  }

  function formatPaymentMethod(method) {
    const key = String(method || "").trim().toLowerCase();
    if (key === "mercado_pago" || key === "mercadopago") return "Mercado Pago";
    if (key === "transferencia") return "Transferencia bancaria";
    if (key === "efectivo") return "Efectivo";
    if (!key) return "—";
    return key;
  }

  function mapShippingStatusCodeForUi(status) {
    if (!status && status !== 0) return "preparing";
    const key = String(status).trim().toLowerCase();
    if (SHIPPING_STATUS_CODE_MAP[key]) return SHIPPING_STATUS_CODE_MAP[key];
    if (
      key === "preparing" ||
      key === "shipped" ||
      key === "delivered" ||
      key === "cancelled" ||
      key === "canceled"
    ) {
      return key === "canceled" ? "cancelled" : key;
    }
    return "preparing";
  }

  function localizeShippingStatus(status) {
    const code = mapShippingStatusCodeForUi(status);
    return SHIPPING_STATUS_LABELS[code] || (status ? String(status) : "");
  }

  function formatInputDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function toYmd(value) {
    if (typeof value !== "string") return value;
    const match = /^([0-9]{2})\/([0-9]{2})\/([0-9]{4})$/.exec(value.trim());
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
    return value;
  }

  function getIdentifier(order = {}) {
    return (
      order.id ||
      order.order_number ||
      order.number ||
      order.external_reference ||
      null
    );
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function displayValue(value) {
    if (value == null) return "—";
    const str = String(value).trim();
    return str ? escapeHtml(str) : "—";
  }

  function ensureElements() {
    if (elements.tableBody) return true;
    elements.banner = document.getElementById("ordersBanner");
    elements.date = document.getElementById("ordersDate");
    elements.todayBtn = document.getElementById("ordersTodayBtn");
    elements.status = document.getElementById("ordersStatus");
    elements.search = document.getElementById("ordersSearch");
    elements.includeDeleted = document.getElementById("ordersIncludeDeleted");
    elements.tableBody = document.querySelector("#ordersTable tbody");
    elements.pagination = document.getElementById("ordersPagination");
    elements.detail = document.getElementById("orderDetail");
    return (
      !!elements.banner &&
      !!elements.date &&
      !!elements.status &&
      !!elements.tableBody &&
      !!elements.pagination &&
      !!elements.detail
    );
  }

  function formatCurrency(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
    }).format(number);
  }

  function parseDateString(value) {
    if (!value) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
      if (ymdMatch) {
        const y = Number(ymdMatch[1]);
        const m = Number(ymdMatch[2]);
        const d = Number(ymdMatch[3]);
        if (![y, m, d].some((part) => Number.isNaN(part))) {
          return new Date(y, m - 1, d);
        }
      }
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(value) {
    const date = parseDateString(value);
    if (!date) return "—";
    return date.toLocaleString("es-AR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  function formatLongDate(value) {
    const date = parseDateString(value);
    if (!date) return "";
    return new Intl.DateTimeFormat("es-AR", { dateStyle: "full" }).format(date);
  }

  function mapAddress(order = {}) {
    const shipping = order.shipping_address || {};
    const cliente = order.customer || order.cliente || {};
    const direccion = cliente.direccion || {};
    const street =
      shipping.street ||
      direccion.calle ||
      cliente.calle ||
      order.address ||
      "";
    const number = shipping.number || direccion.numero || cliente.numero || "";
    const floor =
      shipping.floor ||
      shipping.piso ||
      shipping.apartment ||
      shipping.apartamento ||
      shipping.departamento ||
      direccion.piso ||
      direccion.apartamento ||
      direccion.departamento ||
      cliente.piso ||
      cliente.apartamento ||
      cliente.departamento ||
      "";
    const city = shipping.city || direccion.localidad || cliente.localidad || "";
    const province =
      shipping.province || direccion.provincia || cliente.provincia || "";
    const zip = shipping.zip || direccion.cp || cliente.cp || "";
    const parts = [];
    const streetParts = [street, number].filter(Boolean);
    if (floor) {
      streetParts.push(`Piso ${floor}`);
    }
    const streetLine = streetParts.join(" ");
    if (streetLine) parts.push(streetLine.trim());
    const cityLine = [city, province].filter(Boolean).join(", ");
    if (cityLine) parts.push(cityLine.trim());
    if (zip) parts.push(`CP ${zip}`);
    return {
      summary: parts.join(" – "),
      details: { street, number, floor, city, province, zip },
    };
  }

  function bindEvents() {
    if (elements.date) {
      elements.date.value = state.date;
      elements.date.addEventListener("change", () => {
        state.date = elements.date.value || formatInputDate(new Date());
        state.page = 1;
        refresh();
      });
    }
    if (elements.todayBtn) {
      elements.todayBtn.addEventListener("click", () => {
        state.date = formatInputDate(new Date());
        if (elements.date) elements.date.value = state.date;
        state.page = 1;
        refresh();
      });
    }
    if (elements.status) {
      elements.status.value = state.status;
      elements.status.addEventListener("change", () => {
        state.status = elements.status.value || "all";
        state.page = 1;
        refresh();
      });
    }
    if (elements.includeDeleted) {
      elements.includeDeleted.checked = state.includeDeleted;
      elements.includeDeleted.addEventListener("change", () => {
        state.includeDeleted = elements.includeDeleted.checked;
        state.page = 1;
        refresh();
      });
    }
    if (elements.search) {
      elements.search.value = state.q;
      elements.search.addEventListener("input", () => {
        const value = elements.search.value.trim();
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          state.q = value;
          state.page = 1;
          refresh();
        }, 250);
      });
    }
  }

  function syncSelection() {
    if (!state.selectedId) return;
    const exists = cache.items.some(
      (order) => getIdentifier(order) === state.selectedId,
    );
    if (!exists) {
      state.selectedId = null;
      state.detail = null;
    }
  }

  function renderBanner() {
    if (!elements.banner) return;
    if (!cache.summary) {
      elements.banner.textContent = "";
      return;
    }
    const summaryDate = cache.summary.date || state.date;
    const longDate = formatLongDate(summaryDate) || summaryDate;
    const total = cache.summary.total ?? cache.items.length;
    const paid = cache.summary.paid ?? 0;
    const pending = cache.summary.pending ?? 0;
    elements.banner.textContent = `¡Buen día! Hoy es ${longDate}. Pedidos: ${total} • Pagados: ${paid} • Pendientes: ${pending}`;
  }

  function renderPagination() {
    if (!elements.pagination) return;
    const total = cache.items.length;
    if (total <= pageSize) {
      elements.pagination.innerHTML = "";
      return;
    }
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (state.page > pageCount) state.page = pageCount;
    const fragment = document.createDocumentFragment();
    const prevBtn = document.createElement("button");
    prevBtn.textContent = "Anterior";
    prevBtn.disabled = state.page <= 1;
    prevBtn.addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        renderTable();
        renderPagination();
      }
    });
    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Siguiente";
    nextBtn.disabled = state.page >= pageCount;
    nextBtn.addEventListener("click", () => {
      if (state.page < pageCount) {
        state.page += 1;
        renderTable();
        renderPagination();
      }
    });
    const info = document.createElement("span");
    info.textContent = `Página ${state.page} de ${pageCount} (${total} pedidos)`;
    fragment.appendChild(prevBtn);
    fragment.appendChild(info);
    fragment.appendChild(nextBtn);
    elements.pagination.innerHTML = "";
    elements.pagination.appendChild(fragment);
  }

  function renderTable() {
    if (!elements.tableBody) return;
    elements.tableBody.innerHTML = "";
    const total = cache.items.length;
    if (total === 0) {
      elements.tableBody.innerHTML =
        '<tr><td colspan="9">No hay pedidos para la fecha elegida.</td></tr>';
      return;
    }
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (state.page > pageCount) state.page = pageCount;
    const start = (state.page - 1) * pageSize;
    const pageItems = cache.items.slice(start, start + pageSize);
    pageItems.forEach((order) => {
      const tr = document.createElement("tr");
      const identifier = getIdentifier(order);
      if (identifier && identifier === state.selectedId) {
        tr.classList.add("is-selected");
      }
      if (order.deleted_at) {
        tr.classList.add("order-row--deleted");
      }
      const numberTd = document.createElement("td");
      numberTd.textContent = identifier || "—";
      if (order.deleted_at) {
        const badge = document.createElement("span");
        badge.className = "order-badge";
        badge.textContent = "Eliminado";
        numberTd.appendChild(badge);
      }
      const dateTd = document.createElement("td");
      dateTd.textContent = formatDateTime(order.created_at);
      const customer = order.customer || order.cliente || {};
      const nameTd = document.createElement("td");
      nameTd.textContent = customer.name || customer.nombre || "—";
      const phoneTd = document.createElement("td");
      phoneTd.textContent = customer.phone || customer.telefono || "—";
      const addressTd = document.createElement("td");
      const addressInfo = mapAddress(order);
      addressTd.textContent = addressInfo.summary || "—";
      const itemsTd = document.createElement("td");
      const summary = order.items_summary || order.items_count || "";
      itemsTd.textContent =
        typeof summary === "number" ? `${summary} ítems` : summary || "—";
      const totalTd = document.createElement("td");
      const totals = order.totals || {};
      const grandTotal =
        totals.grand_total ||
        totals.total ||
        order.total ||
        order.total_amount ||
        0;
      totalTd.textContent = formatCurrency(grandTotal);
      const methodTd = document.createElement("td");
      methodTd.textContent = formatPaymentMethod(
        order.payment_method || order.metodo_pago,
      );
      const paymentTd = document.createElement("td");
      const paymentLabel = localizePaymentStatus(
        order.payment_status ||
          order.payment_status_code ||
          order.status ||
          "",
      );
      paymentTd.textContent = paymentLabel ? paymentLabel : "—";
      const actionsTd = document.createElement("td");
      actionsTd.className = "order-actions";

      const viewBtn = document.createElement("button");
      viewBtn.textContent = "Ver";
      viewBtn.addEventListener("click", () => {
        selectOrder(order);
      });
      actionsTd.appendChild(viewBtn);

      if (!order.deleted_at) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "button danger";
        deleteBtn.textContent = "Borrar";
        deleteBtn.addEventListener("click", () => {
          handleDelete(order);
        });
        actionsTd.appendChild(deleteBtn);
      } else {
        const restoreBtn = document.createElement("button");
        restoreBtn.className = "button secondary";
        restoreBtn.textContent = "Restaurar";
        restoreBtn.addEventListener("click", () => {
          handleRestore(order);
        });
        actionsTd.appendChild(restoreBtn);
      }

      tr.appendChild(numberTd);
      tr.appendChild(dateTd);
      tr.appendChild(nameTd);
      tr.appendChild(phoneTd);
      tr.appendChild(addressTd);
      tr.appendChild(itemsTd);
      tr.appendChild(totalTd);
      tr.appendChild(methodTd);
      tr.appendChild(paymentTd);
      tr.appendChild(actionsTd);
      elements.tableBody.appendChild(tr);
    });
  }

  function renderDetail() {
    if (!elements.detail) return;
    if (!state.selectedId) {
      elements.detail.innerHTML =
        "<p>Seleccioná un pedido para ver el detalle.</p>";
      return;
    }
    const detail = state.detail;
    if (!detail || getIdentifier(detail) !== state.selectedId) {
      elements.detail.innerHTML = "<p>Cargando detalle…</p>";
      return;
    }
    const identifier = getIdentifier(detail) || state.selectedId;
    const customer = detail.customer || detail.cliente || {};
    const addressInfo = mapAddress(detail);
    const shipping = addressInfo.details;
    const paymentSource =
      detail.payment_status_code ||
      detail.payment_status ||
      detail.estado_pago ||
      detail.status ||
      "";
    const paymentCode = mapPaymentStatusCodeForUi(paymentSource);
    const paymentLabel = localizePaymentStatus(paymentSource);
    const paymentMethodLabel = formatPaymentMethod(
      detail.payment_method || detail.metodo_pago,
    );
    const paymentDetails =
      detail.payment_details && typeof detail.payment_details === "object"
        ? detail.payment_details
        : {};
    const paymentReference =
      paymentDetails.reference || paymentDetails.note || "";
    const shippingSource =
      detail.shipping_status ||
      detail.estado_envio ||
      detail.shippingStatus ||
      detail.envio_estado ||
      "";
    const shippingCode = mapShippingStatusCodeForUi(shippingSource);
    const shippingLabel = localizeShippingStatus(shippingSource);
    const created = formatDateTime(detail.created_at || detail.fecha);
    const totals = detail.totals || {};
    const grandTotal =
      totals.grand_total ||
      totals.total ||
      detail.total ||
      detail.total_amount ||
      0;
    const trackingValue =
      detail.tracking ||
      detail.tracking_number ||
      detail.seguimiento ||
      detail.numero_seguimiento ||
      "";
    const carrierValue =
      detail.carrier ||
      detail.transportista ||
      detail.shipping_carrier ||
      "";
    const shippingNoteValue =
      detail.shipping_note ||
      detail.shipping_notes ||
      detail.shippingNote ||
      detail.nota_envio ||
      detail.nota ||
      detail.note ||
      "";
    const items = Array.isArray(detail.items) ? detail.items : [];
    const itemsHtml = items
      .map((item) => {
        const qty = item.quantity || item.qty || 0;
        const price = item.price || item.unit_price || 0;
        const label =
          item.name ||
          item.title ||
          item.descripcion ||
          item.product_id ||
          item.sku ||
          "Producto";
        const lineTotal = formatCurrency(Number(price) * Number(qty || 0));
        return `<li>${escapeHtml(label)} ×${escapeHtml(
          String(qty),
        )} – ${escapeHtml(lineTotal)}</li>`;
      })
      .join("");
    const invoiceEntries = Array.isArray(detail.invoices)
      ? detail.invoices.filter(Boolean)
      : [];
    if (!invoiceEntries.length && detail.invoice_url) {
      invoiceEntries.push({
        url: detail.invoice_url,
        filename: detail.invoice_filename || null,
        uploaded_at:
          detail.invoice_uploaded_at ||
          detail.invoice_date ||
          detail.updated_at ||
          detail.created_at ||
          null,
      });
    }
    const visibleInvoices = invoiceEntries.filter(
      (inv) => inv && !inv.deleted_at && inv.url,
    );
    const invoiceItemsHtml = visibleInvoices.length
      ? `<ul class="invoice-list">${visibleInvoices
          .map((inv, idx) => {
            const label =
              inv.original_name ||
              inv.filename ||
              `Factura ${idx + 1}`;
            const uploadedAt =
              inv.uploaded_at &&
              !Number.isNaN(new Date(inv.uploaded_at).getTime())
                ? new Date(inv.uploaded_at).toLocaleDateString('es-AR')
                : '';
            const viewLink = `<a href="${escapeHtml(
              inv.url,
            )}" target="_blank" rel="noopener" class="button secondary">Ver</a>`;
            const deleteButton =
              allowOrderEditing && inv.filename
                ? `<button type="button" class="button danger" data-invoice-delete="${escapeHtml(
                    inv.filename,
                  )}">Eliminar</button>`
                : '';
            const meta = uploadedAt
              ? ` <small>(${escapeHtml(uploadedAt)})</small>`
              : '';
            return `<li><span>${escapeHtml(label)}${meta}</span> ${viewLink}${
              deleteButton ? ` ${deleteButton}` : ''
            }</li>`;
          })
          .join('')}</ul>`
      : '<p><em>Factura pendiente</em></p>';
    const invoiceUploadHtml = allowOrderEditing
      ? `<div class="invoice-upload"><input type="file" data-invoice-file accept="application/pdf" /><button type="button" class="button secondary upload-invoice-btn">Subir factura (PDF)</button></div>`
      : '';
    const paymentOptionsHtml = PAYMENT_STATUS_OPTIONS.map((option) => {
      const selected = option.value === paymentCode ? " selected" : "";
      return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(
        option.label,
      )}</option>`;
    }).join("");
    const shippingOptionsHtml = SHIPPING_STATUS_OPTIONS.map((option) => {
      const selected = option.value === shippingCode ? " selected" : "";
      return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(
        option.label,
      )}</option>`;
    }).join("");
    const deletedBadge = detail.deleted_at
      ? '<span class="order-badge">Eliminado</span>'
      : "";
    const editSection = allowOrderEditing
      ? `
      <div class="order-edit">
        <h5>Actualizar pedido</h5>
        <div class="order-edit-grid">
          <label>
            <span>Estado de pago</span>
            <select data-order-field="payment-status">
              ${paymentOptionsHtml}
            </select>
          </label>
          <label>
            <span>Referencia de pago</span>
            <input
              type="text"
              data-order-field="payment-reference"
              value="${escapeHtml(paymentReference)}"
              placeholder="Comprobante o referencia"
            />
          </label>
          <label>
            <span>Estado de envío</span>
            <select data-order-field="shipping-status">
              ${shippingOptionsHtml}
            </select>
          </label>
          <label>
            <span>Nº de seguimiento</span>
            <input
              type="text"
              data-order-field="tracking"
              value="${escapeHtml(trackingValue)}"
              placeholder="Opcional"
            />
          </label>
          <label>
            <span>Transportista</span>
            <input
              type="text"
              data-order-field="carrier"
              value="${escapeHtml(carrierValue)}"
              placeholder="Opcional"
            />
          </label>
          <label class="order-edit-notes">
            <span>Notas de envío</span>
            <textarea
              data-order-field="shipping-note"
              placeholder="Opcional">${escapeHtml(shippingNoteValue)}</textarea>
          </label>
        </div>
        <div class="order-edit-actions">
          <button type="button" class="button secondary" data-mark-paid>
            Marcar como pagado
          </button>
          <button type="button" class="button danger" data-mark-cancelled>
            Marcar como cancelado
          </button>
        </div>
        <button type="button" class="button primary save-order-btn">Guardar</button>
      </div>
    `
      : "";
    elements.detail.innerHTML = `
      <h4>Pedido ${displayValue(identifier)} ${deletedBadge}</h4>
      <div class="detail-grid">
        <dl>
          <dt>Cliente</dt>
          <dd>${displayValue(customer.name || customer.nombre)}</dd>
        </dl>
        <dl>
          <dt>Email</dt>
          <dd>${displayValue(customer.email)}</dd>
        </dl>
        <dl>
          <dt>Teléfono</dt>
          <dd>${displayValue(customer.phone || customer.telefono)}</dd>
        </dl>
        <dl>
          <dt>Dirección de envío</dt>
          <dd>${displayValue(addressInfo.summary)}</dd>
        </dl>
        <dl>
          <dt>Código postal</dt>
          <dd>${displayValue(shipping.zip)}</dd>
        </dl>
        <dl>
          <dt>Piso / Depto</dt>
          <dd>${displayValue(shipping.floor)}</dd>
        </dl>
        <dl>
          <dt>Pago</dt>
          <dd>${displayValue(paymentLabel)}</dd>
        </dl>
        <dl>
          <dt>Método de pago</dt>
          <dd>${displayValue(paymentMethodLabel)}</dd>
        </dl>
        <dl>
          <dt>Referencia de pago</dt>
          <dd>${displayValue(paymentReference)}</dd>
        </dl>
        <dl>
          <dt>Envío</dt>
          <dd>${displayValue(shippingLabel)}</dd>
        </dl>
        <dl>
          <dt>Tracking</dt>
          <dd>${displayValue(trackingValue)}</dd>
        </dl>
        <dl>
          <dt>Transportista</dt>
          <dd>${displayValue(carrierValue)}</dd>
        </dl>
        <dl>
          <dt>Notas de envío</dt>
          <dd>${displayValue(shippingNoteValue)}</dd>
        </dl>
        <dl>
          <dt>Creado</dt>
          <dd>${displayValue(created)}</dd>
      </dl>
      <dl>
        <dt>Total</dt>
        <dd>${escapeHtml(formatCurrency(grandTotal))}</dd>
      </dl>
    </div>
    ${editSection}
    <div class="order-invoices">
      <h5>Facturas</h5>
      ${invoiceItemsHtml}
      ${invoiceUploadHtml}
    </div>
    <div class="order-items">
      <h5>Ítems</h5>
      <ul class="order-items-list">${
        itemsHtml || "<li>No se registraron ítems.</li>"
      }</ul>
      </div>
    `;
    if (allowOrderEditing) {
      const identifierToUpdate = identifier;
      const saveBtn = elements.detail.querySelector(".save-order-btn");
      if (saveBtn) {
        const paymentSelect = elements.detail.querySelector(
          '[data-order-field="payment-status"]',
        );
        const shippingSelect = elements.detail.querySelector(
          '[data-order-field="shipping-status"]',
        );
        const trackingInput = elements.detail.querySelector(
          '[data-order-field="tracking"]',
        );
        const carrierInput = elements.detail.querySelector(
          '[data-order-field="carrier"]',
        );
        const noteInput = elements.detail.querySelector(
          '[data-order-field="shipping-note"]',
        );
        const paymentReferenceInput = elements.detail.querySelector(
          '[data-order-field="payment-reference"]',
        );
        const markPaidBtn = elements.detail.querySelector('[data-mark-paid]');
        const markCancelledBtn = elements.detail.querySelector(
          '[data-mark-cancelled]',
        );
        saveBtn.addEventListener("click", async () => {
          if (!identifierToUpdate) return;
          const patch = {
            payment_status:
              (paymentSelect && paymentSelect.value) || paymentCode || "pending",
            shipping_status:
              (shippingSelect && shippingSelect.value) ||
              shippingCode ||
              "preparing",
            tracking:
              trackingInput && trackingInput.value.trim()
                ? trackingInput.value.trim()
                : null,
            carrier:
              carrierInput && carrierInput.value.trim()
                ? carrierInput.value.trim()
                : null,
            shipping_note:
              noteInput && noteInput.value.trim()
                ? noteInput.value.trim()
                : null,
          };
          if (paymentReferenceInput) {
            patch.payment_details = {
              reference: paymentReferenceInput.value.trim(),
            };
          }
          const originalText = saveBtn.textContent;
          saveBtn.disabled = true;
          saveBtn.textContent = "Guardando…";
          try {
            const res = await apiFetch(
              `/api/orders/${encodeURIComponent(String(identifierToUpdate))}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              },
            );
            if (!res.ok) {
              throw new Error(`save-order-failed:${res.status}`);
            }
            await refresh();
            await loadDetail(identifierToUpdate);
          } catch (err) {
            console.error(err);
            alert("No se pudo guardar el pedido. Intentalo de nuevo.");
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
          }
        });
        if (markPaidBtn && paymentSelect) {
          markPaidBtn.addEventListener("click", () => {
            paymentSelect.value = "approved";
            saveBtn.click();
          });
        }
        if (markCancelledBtn && paymentSelect) {
          markCancelledBtn.addEventListener("click", () => {
            paymentSelect.value = "cancelled";
            saveBtn.click();
          });
        }
      }
      const invoiceUploadInput = elements.detail.querySelector(
        '[data-invoice-file]',
      );
      const invoiceUploadBtn = elements.detail.querySelector(
        '.upload-invoice-btn',
      );
      if (invoiceUploadBtn && invoiceUploadInput && identifierToUpdate) {
        invoiceUploadBtn.addEventListener('click', async () => {
          if (!invoiceUploadInput.files || !invoiceUploadInput.files.length) {
            alert('Seleccioná un archivo PDF.');
            return;
          }
          const file = invoiceUploadInput.files[0];
          const isPdf =
            file.type === 'application/pdf' ||
            file.name.toLowerCase().endsWith('.pdf');
          if (!isPdf) {
            alert('El archivo debe ser un PDF.');
            return;
          }
          const formData = new FormData();
          formData.append('file', file);
          const originalText = invoiceUploadBtn.textContent;
          invoiceUploadBtn.disabled = true;
          invoiceUploadBtn.textContent = 'Subiendo…';
          try {
            const res = await apiFetch(
              `/api/orders/${encodeURIComponent(String(identifierToUpdate))}/invoices`,
              {
                method: 'POST',
                body: formData,
              },
            );
            if (!res.ok) throw new Error(`invoice-upload:${res.status}`);
            await loadDetail(identifierToUpdate);
          } catch (err) {
            console.error(err);
            alert('No se pudo subir la factura. Intentalo nuevamente.');
          } finally {
            invoiceUploadBtn.disabled = false;
            invoiceUploadBtn.textContent = originalText;
            invoiceUploadInput.value = '';
          }
        });
      }
      const invoiceDeleteButtons = elements.detail.querySelectorAll(
        '[data-invoice-delete]',
      );
      invoiceDeleteButtons.forEach((btn) => {
        btn.addEventListener('click', async () => {
          const fileName = btn.getAttribute('data-invoice-delete');
          if (!fileName || !identifierToUpdate) return;
          const confirmed = window.confirm(
            '¿Seguro que querés eliminar esta factura?',
          );
          if (!confirmed) return;
          const originalLabel = btn.textContent;
          btn.disabled = true;
          btn.textContent = 'Eliminando…';
          try {
            const res = await apiFetch(
              `/api/orders/${encodeURIComponent(String(identifierToUpdate))}/invoices/${encodeURIComponent(
                fileName,
              )}`,
              { method: 'DELETE' },
            );
            if (!res.ok) throw new Error(`invoice-delete:${res.status}`);
            await loadDetail(identifierToUpdate);
          } catch (err) {
            console.error(err);
            alert('No se pudo eliminar la factura.');
            btn.disabled = false;
            btn.textContent = originalLabel;
          }
        });
      });
    }
  }

  async function loadDetail(identifier) {
    if (!identifier) return;
    try {
      const res = await apiFetch(
        `/api/orders/${encodeURIComponent(String(identifier))}`,
      );
      if (!res.ok) throw new Error("No se pudo obtener el detalle");
      const data = await res.json();
      if (data && data.order) {
        state.detail = data.order;
      } else {
        state.detail = null;
      }
    } catch (err) {
      console.error(err);
      state.detail = null;
      elements.detail.innerHTML =
        "<p>No se pudo cargar el detalle del pedido.</p>";
      return;
    }
    renderDetail();
  }

  function selectOrder(order) {
    const identifier = getIdentifier(order);
    if (!identifier) return;
    state.selectedId = identifier;
    state.detail = null;
    renderTable();
    renderDetail();
    loadDetail(identifier);
  }

  async function handleDelete(order) {
    const identifier = getIdentifier(order);
    if (!identifier) return;
    const confirmed = window.confirm(
      "¿Seguro que querés eliminar este pedido? Podrás restaurarlo luego.",
    );
    if (!confirmed) return;
    try {
      const res = await apiFetch(
        `/api/orders/${encodeURIComponent(String(identifier))}`,
        { method: "DELETE" },
      );
      if (res.ok || res.status === 204) {
        await refresh();
      } else {
        alert("No se pudo eliminar el pedido.");
      }
    } catch (err) {
      console.error(err);
      alert("Error al eliminar el pedido.");
    }
  }

  async function handleRestore(order) {
    const identifier = getIdentifier(order);
    if (!identifier) return;
    try {
      const res = await apiFetch(
        `/api/orders/${encodeURIComponent(String(identifier))}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deleted_at: null }),
        },
      );
      if (res.ok) {
        await refresh();
      } else {
        alert("No se pudo restaurar el pedido.");
      }
    } catch (err) {
      console.error(err);
      alert("Error al restaurar el pedido.");
    }
  }

  async function refresh() {
    if (!ensureElements()) return;
    if (!initialized) {
      bindEvents();
      initialized = true;
    }
    if (elements.banner) {
      elements.banner.textContent = "Cargando pedidos…";
    }
    if (elements.tableBody) {
      elements.tableBody.innerHTML =
        '<tr><td colspan="9">Cargando pedidos…</td></tr>';
    }
    let res;
    let responseBodyText = "";
    try {
      const rawDate = elements.date ? elements.date.value || "" : "";
      const dateParam = toYmd(rawDate || state.date || "");
      const statusValue = state.status || "todos";
      const statusParam = ORDER_STATUS_QUERY_MAP[statusValue] ?? "";
      const q = state.q || "";
      const includeDeleted = state.includeDeleted;
      const statusQuery = statusParam
        ? `&status=${encodeURIComponent(statusParam)}`
        : "";
      const url = `/api/orders?date=${encodeURIComponent(
        dateParam,
      )}${statusQuery}&q=${encodeURIComponent(q)}${includeDeleted ? "&includeDeleted=1" : ""}`;
      console.info("orders-fetch:url", url);
      res = await apiFetch(url);
      if (!res.ok) {
        if (typeof res.text === "function") {
          try {
            responseBodyText = await res.text();
          } catch (textErr) {
            responseBodyText = textErr?.message || "";
          }
        }
        console.error("orders-load-failed", {
          status: res?.status,
          body: responseBodyText,
        });
        const error = new Error("orders-load-failed");
        error.status = res.status;
        error.body = responseBodyText;
        error.url = url;
        error.__ordersLogged = true;
        throw error;
      }
      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        responseBodyText = jsonErr?.message || "json-parse-error";
        console.error("orders-load-failed", {
          status: res?.status,
          body: responseBodyText,
        });
        const error = new Error("orders-load-failed");
        error.status = res?.status;
        error.body = responseBodyText;
        error.url = url;
        error.__ordersLogged = true;
        throw error;
      }
      console.info("orders-response:keys", Object.keys(data || {}));
      console.info("orders-response:counts", {
        orders: Array.isArray(data?.orders) ? data.orders.length : null,
        items: Array.isArray(data?.items) ? data.items.length : null,
        summary: data?.summary,
        total: data?.total ?? data?.summary?.total ?? null,
      });
      const rows = data.orders || data.items || [];
      const total =
        typeof data.total === "number"
          ? data.total
          : data.summary?.total ?? rows.length;
      const summarySource =
        data.summary && typeof data.summary === "object" ? data.summary : {};
      const summary = {
        ...summarySource,
        total,
      };
      if (!summary.date) {
        summary.date = dateParam || state.date;
      }
      cache = {
        items: Array.isArray(rows) ? rows : [],
        summary,
      };
      syncSelection();
      renderBanner();
      renderTable();
      renderPagination();
      renderDetail();
    } catch (err) {
      if (!err?.__ordersLogged) {
        let body = err?.body ?? err?.message ?? "";
        if (!body && res && typeof res.text === "function" && !res.bodyUsed) {
          try {
            body = await res.text();
          } catch (textErr) {
            body = textErr?.message || "";
          }
        }
        if (!body) body = responseBodyText || "";
        console.error("orders-load-failed", {
          status: res?.status,
          body,
        });
      }
      cache = { items: [], summary: null };
      if (elements.tableBody) {
        elements.tableBody.innerHTML =
          '<tr><td colspan="9">No se pudieron cargar los pedidos.</td></tr>';
      }
      if (elements.pagination) elements.pagination.innerHTML = "";
      renderBanner();
      renderDetail();
    }
  }

  return {
    init: () => {
      if (!ensureElements()) return;
      if (!initialized) {
        bindEvents();
        initialized = true;
      }
      refresh();
    },
    refresh,
  };
})();

// ------------ Clientes ------------
const clientsTableBody = document.querySelector("#clientsTable tbody");

async function loadClients() {
  try {
    const res = await apiFetch("/api/clients");
    if (!res.ok) throw new Error("No se pudieron obtener los clientes");
    const data = await res.json();
    clientsTableBody.innerHTML = "";
    data.clients.forEach((client) => {
      const tr = document.createElement("tr");
      const emailTd = document.createElement("td");
      emailTd.textContent = client.email;
      const nameTd = document.createElement("td");
      nameTd.textContent = client.name || "";
      const balanceTd = document.createElement("td");
      balanceTd.textContent = `$${client.balance.toLocaleString("es-AR")}`;
      const limitTd = document.createElement("td");
      limitTd.textContent = `$${client.limit.toLocaleString("es-AR")}`;
      const actionTd = document.createElement("td");
      actionTd.classList.add("table-actions");
      const payBtn = document.createElement("button");
      payBtn.textContent = "Registrar pago";
      payBtn.addEventListener("click", async () => {
        const amountStr = prompt("Monto del pago ($)", "0");
        if (amountStr === null) return;
        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
          alert("Monto inválido");
          return;
        }
        const newBalance = client.balance - amount;
        // Enviar actualización al servidor
        const resp = await apiFetch(
          `/api/clients/${encodeURIComponent(client.email)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ balance: newBalance }),
          },
        );
        if (resp.ok) {
          alert("Pago registrado");
          loadClients();
        } else {
          alert("Error al registrar pago");
        }
      });
      actionTd.appendChild(payBtn);

      if (client.email) {
        const docsBtn = document.createElement("button");
        docsBtn.textContent = "Ver documentos";
        docsBtn.className = "button secondary";
        docsBtn.addEventListener("click", () => {
          openClientDocumentsModal(client);
        });
        actionTd.appendChild(docsBtn);
      }

      tr.appendChild(emailTd);
      tr.appendChild(nameTd);
      tr.appendChild(balanceTd);
      tr.appendChild(limitTd);
      tr.appendChild(actionTd);
      clientsTableBody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    clientsTableBody.innerHTML =
      '<tr><td colspan="5">No se pudieron cargar los clientes</td></tr>';
  }
}

// ------------ Solicitudes mayoristas ------------
function getDefaultWholesaleSubject(status) {
  switch (status) {
    case "approved":
      return "Cuenta mayorista aprobada – NERIN Parts";
    case "waiting_documents":
      return "Información adicional requerida para tu solicitud mayorista";
    case "rejected":
      return "Actualización sobre tu solicitud mayorista";
    default:
      return "Actualización de tu solicitud mayorista";
  }
}

function getWholesaleStatusMeta(status) {
  return (
    WHOLESALE_STATUS_META[status] || {
      label: status ? status : "Sin estado",
      tone: "muted",
    }
  );
}

function formatWholesaleStatusBadge(status) {
  const meta = getWholesaleStatusMeta(status);
  return `<span class="wh-status-badge wh-status-badge--${meta.tone}">${escapeHtml(
    meta.label,
  )}</span>`;
}

function getFilteredWholesaleRequests() {
  const statusValue =
    wholesaleStatusFilter && wholesaleStatusFilter.value
      ? wholesaleStatusFilter.value
      : "all";
  const searchValue =
    wholesaleSearchInput && wholesaleSearchInput.value
      ? wholesaleSearchInput.value.trim().toLowerCase()
      : "";
  return wholesaleState.requests.filter((request) => {
    if (statusValue !== "all" && request.status !== statusValue) {
      return false;
    }
    if (searchValue) {
      const haystack = [
        request.legalName,
        request.contactName,
        request.email,
        request.taxId,
        request.companyType,
        request.salesChannel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchValue)) {
        return false;
      }
    }
    return true;
  });
}

function renderWholesaleTable(options = {}) {
  if (!wholesaleTableBody) return;
  if (options.loading) {
    wholesaleTableBody.innerHTML =
      '<tr><td colspan="5">Cargando solicitudes…</td></tr>';
    return;
  }
  const rows = getFilteredWholesaleRequests();
  if (!rows.length) {
    wholesaleTableBody.innerHTML =
      '<tr><td colspan="5">No hay solicitudes con los filtros seleccionados.</td></tr>';
    return;
  }
  wholesaleTableBody.innerHTML = "";
  rows.forEach((request) => {
    const tr = document.createElement("tr");
    tr.dataset.id = request.id;
    if (request.id === wholesaleState.selectedId) {
      tr.classList.add("is-selected");
    }
    const refCell = document.createElement("td");
    const reference = request.id
      ? request.id.replace(/^whr_/i, "WH-").toUpperCase().slice(0, 12)
      : "—";
    refCell.textContent = reference;
    const statusCell = document.createElement("td");
    statusCell.innerHTML = formatWholesaleStatusBadge(request.status);
    const legalCell = document.createElement("td");
    legalCell.textContent =
      request.legalName || request.contactName || "—";
    const emailCell = document.createElement("td");
    emailCell.textContent = request.email || "—";
    const updatedCell = document.createElement("td");
    updatedCell.textContent = formatDateTimeDisplay(
      request.updatedAt || request.submittedAt || request.createdAt,
    );
    tr.append(refCell, statusCell, legalCell, emailCell, updatedCell);
    tr.addEventListener("click", () => selectWholesaleRequest(request.id));
    wholesaleTableBody.appendChild(tr);
  });
}

async function loadWholesaleRequests(options = {}) {
  if (!wholesaleTableBody) return;
  if (wholesaleState.loading && !options.force) return;
  wholesaleState.loading = true;
  renderWholesaleTable({ loading: true });
  try {
    const res = await apiFetch("/api/wholesale/requests");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    const list = Array.isArray(data.requests) ? data.requests.slice() : [];
    list.sort((a, b) => {
      const tA = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
      const tB = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
      return tB - tA;
    });
    wholesaleState.requests = list;
    renderWholesaleTable();
    if (wholesaleState.selectedId) {
      const match = list.find((item) => item.id === wholesaleState.selectedId);
      if (match) {
        wholesaleState.detail = match;
        renderWholesaleDetail(match, { preserveInputs: true });
      }
    }
  } catch (err) {
    console.error("wholesale-load", err);
    wholesaleTableBody.innerHTML =
      '<tr><td colspan="5">No se pudieron cargar las solicitudes.</td></tr>';
    if (window.showToast) {
      showToast("No se pudieron cargar las solicitudes mayoristas");
    }
  } finally {
    wholesaleState.loading = false;
  }
}

async function selectWholesaleRequest(id) {
  if (!id) return;
  wholesaleState.selectedId = id;
  renderWholesaleTable();
  if (wholesaleDetailContainer) {
    wholesaleDetailContainer.innerHTML =
      '<div class="wh-detail-loading">Cargando solicitud…</div>';
  }
  try {
    const res = await apiFetch(
      `/api/wholesale/requests/${encodeURIComponent(id)}`,
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    wholesaleState.detail = data.request;
    renderWholesaleDetail(data.request);
  } catch (err) {
    console.error("wholesale-detail", err);
    if (wholesaleDetailContainer) {
      wholesaleDetailContainer.innerHTML =
        '<div class="wh-detail-error">No se pudo cargar la solicitud seleccionada.</div>';
    }
  }
}

function renderWholesaleDocuments(request) {
  const docs = Array.isArray(request?.documents) ? request.documents : [];
  if (!docs.length) {
    return '<li class="wh-doc-empty">Sin documentos adjuntos por el momento.</li>';
  }
  return docs
    .map((doc) => {
      const docId = escapeHtml(doc.id || "");
      const label = escapeHtml(doc.label || doc.originalName || "Documento");
      const url = doc.url ? escapeHtml(doc.url) : "#";
      const uploadedAt = formatDateTimeDisplay(doc.uploadedAt);
      const uploader =
        doc.uploadedBy && (doc.uploadedBy.name || doc.uploadedBy.email)
          ? `<span class="wh-doc-meta">${escapeHtml(
              doc.uploadedBy.name || doc.uploadedBy.email,
            )}</span>`
          : "";
      return `<li data-doc-id="${docId}">
        <div class="wh-doc-main">
          <a href="${url}" target="_blank" rel="noopener">${label}</a>
          <span class="wh-doc-date">${uploadedAt}</span>
          ${uploader}
        </div>
        <button type="button" class="link-button" data-remove-doc="${docId}">Eliminar</button>
      </li>`;
    })
    .join("");
}

function renderWholesaleHistory(history) {
  const items = Array.isArray(history) ? history : [];
  if (!items.length) {
    return '<li class="wh-history-empty">Todavía no hay eventos registrados.</li>';
  }
  return items
    .map((entry) => {
      const label =
        WHOLESALE_HISTORY_LABELS[entry.action] ||
        entry.action ||
        "Actividad";
      const actor =
        entry.by && (entry.by.name || entry.by.email)
          ? `<span class="wh-history-actor">${escapeHtml(
              entry.by.name || entry.by.email,
            )}</span>`
          : "";
      const note = entry.note
        ? `<div class="wh-history-note">${formatMultiline(entry.note)}</div>`
        : "";
      return `<li>
        <div class="wh-history-header">
          <span class="wh-history-label">${escapeHtml(label)}</span>
          <span class="wh-history-time">${formatDateTimeDisplay(entry.at)}</span>
        </div>
        ${actor ? `<div class="wh-history-meta">${actor}</div>` : ""}
        ${note}
      </li>`;
    })
    .join("");
}

function renderWholesaleDetail(request, options = {}) {
  if (!wholesaleDetailContainer) return;
  if (options.loading) {
    wholesaleDetailContainer.innerHTML =
      '<div class="wh-detail-loading">Cargando solicitud…</div>';
    return;
  }
  if (!request) {
    wholesaleDetailContainer.innerHTML = `
      <div class="wholesale-empty">
        <h4>Seleccioná una solicitud</h4>
        <p>Elegí un registro de la lista para revisar los datos enviados, agregar documentación y completar la aprobación.</p>
      </div>
    `;
    return;
  }
  let previousInputs = null;
  if (options.preserveInputs) {
    previousInputs = {
      assignedTo:
        document.getElementById("wholesaleAssigneeInput")?.value || "",
      internalNotes:
        document.getElementById("wholesaleInternalNotes")?.value || "",
      subject:
        document.getElementById("wholesaleEmailSubject")?.value || "",
      message:
        document.getElementById("wholesaleDecisionMessage")?.value || "",
      notify:
        document.getElementById("wholesaleNotifyApplicant")?.checked ?? true,
      createAccount:
        document.getElementById("wholesaleCreateAccount")?.checked ?? true,
      timelineType:
        document.getElementById("wholesaleTimelineType")?.value || "note",
    };
  }
  const archiveNextStatus =
    request.status === "archived" ? "pending_review" : "archived";
  const archiveLabel =
    request.status === "archived" ? "Reabrir" : "Archivar";
  const infoRows = [
    {
      label: "Correo corporativo",
      value: request.email
        ? `<a href="mailto:${escapeHtml(request.email)}">${escapeHtml(
            request.email,
          )}</a>`
        : "—",
    },
    { label: "Razón social", value: renderNullable(request.legalName) },
    { label: "Responsable", value: renderNullable(request.contactName) },
    { label: "CUIT", value: renderNullable(request.taxId) },
    { label: "Teléfono", value: renderNullable(request.phone) },
    { label: "Provincia", value: renderNullable(request.province) },
    { label: "Rubro principal", value: renderNullable(request.companyType) },
    { label: "Canales de venta", value: renderNullable(request.salesChannel) },
    { label: "Volumen mensual", value: renderNullable(request.monthlyVolume) },
    { label: "Sistema / Marketplace", value: renderNullable(request.systems) },
    { label: "Sitio web", value: renderLink(request.website) },
    { label: "Constancia AFIP", value: renderLink(request.afipUrl) },
    { label: "Notas del solicitante", value: formatMultiline(request.notes) },
  ];
  const infoHtml = infoRows
    .map(
      (row) =>
        `<div class="wh-info-item"><dt>${row.label}</dt><dd>${row.value}</dd></div>`,
    )
    .join("");
  const documentsHtml = renderWholesaleDocuments(request);
  const historyHtml = renderWholesaleHistory(request.history);
  const timelineOptions = WHOLESALE_TIMELINE_TYPES.map(
    (item) => `<option value="${item.value}">${item.label}</option>`,
  ).join("");
  const subjectValue = getDefaultWholesaleSubject(request.status);
  const accountMeta =
    request.account && request.account.createdAt
      ? `<p class="wh-detail-meta">Cuenta creada el ${formatDateTimeDisplay(
          request.account.createdAt,
        )}</p>`
      : "";
  wholesaleDetailContainer.innerHTML = `
    <div class="wh-detail-card">
      <header class="wh-detail-head">
        <div>
          <div class="wh-detail-status">
            ${formatWholesaleStatusBadge(request.status)}
            <span class="wh-detail-updated">Actualizado ${formatDateTimeDisplay(
              request.updatedAt || request.createdAt,
            )}</span>
          </div>
          <h3>${escapeHtml(
            request.legalName ||
              request.contactName ||
              request.email ||
              "Solicitud mayorista",
          )}</h3>
          <p class="wh-detail-summary">
            ${request.email ? escapeHtml(request.email) : ""}
            ${request.taxId ? ` · CUIT ${escapeHtml(request.taxId)}` : ""}
            ${request.province ? ` · ${escapeHtml(request.province)}` : ""}
          </p>
          ${accountMeta}
        </div>
        <div class="wh-detail-actions">
          <button class="button primary" id="wholesaleApproveBtn">Aprobar</button>
          <button class="button" id="wholesaleRequestDocsBtn">Pedir documentación</button>
          <button class="button danger" id="wholesaleRejectBtn">Rechazar</button>
          <button class="button subtle" id="wholesaleArchiveBtn" data-next-status="${archiveNextStatus}">${archiveLabel}</button>
        </div>
      </header>
      <div class="wh-detail-columns">
        <section class="wh-info">
          <h4>Datos del solicitante</h4>
          <dl class="wh-info-grid">
            ${infoHtml}
          </dl>
        </section>
        <aside class="wh-management">
          <h4>Gestión interna</h4>
          <form id="wholesaleNotesForm" class="wh-form">
            <label>
              <span>Asignado a</span>
              <div class="wh-inline-field">
                <input type="text" id="wholesaleAssigneeInput" value="${escapeHtml(
                  request.assignedTo || "",
                )}" />
                <button type="button" class="button" id="wholesaleTakeBtn">Tomar caso</button>
              </div>
            </label>
            <label>
              <span>Notas internas</span>
              <textarea id="wholesaleInternalNotes" rows="4" placeholder="Seguimiento interno">${escapeHtml(
                request.internalNotes || "",
              )}</textarea>
            </label>
            <button type="submit" class="button primary">Guardar cambios</button>
          </form>
          <section class="wh-decision">
            <h4>Comunicación con el cliente</h4>
            <label>
              <span>Asunto del correo</span>
              <input type="text" id="wholesaleEmailSubject" value="${escapeHtml(
                subjectValue,
              )}" />
            </label>
            <label>
              <span>Mensaje al cliente</span>
              <textarea id="wholesaleDecisionMessage" rows="4" placeholder="Detalle del mensaje"></textarea>
            </label>
            <label class="input-checkbox">
              <input type="checkbox" id="wholesaleNotifyApplicant" checked /> Notificar por email
            </label>
            ${
              request.account && request.account.createdAt
                ? `<p class="wh-detail-meta">La cuenta ya fue generada el ${formatDateTimeDisplay(
                    request.account.createdAt,
                  )}.</p>`
                : `<label class="input-checkbox"><input type="checkbox" id="wholesaleCreateAccount" checked /> Crear cuenta y enviar clave provisoria</label>`
            }
          </section>
        </aside>
      </div>
      <section class="wh-documents">
        <h4>Documentación</h4>
        <ul class="wh-documents-list">
          ${documentsHtml}
        </ul>
        <form id="wholesaleDocumentForm" class="wh-form" enctype="multipart/form-data">
          <div class="wh-document-fields">
            <input type="text" id="wholesaleDocumentLabel" placeholder="Descripción del archivo" />
            <input type="file" id="wholesaleDocumentFile" accept=".pdf,.jpg,.jpeg,.png" required />
            <button type="submit" class="button">Adjuntar</button>
          </div>
          <p class="wh-form-hint">Hasta 5 MB. Formatos permitidos: PDF, JPG, PNG.</p>
        </form>
      </section>
      <section class="wh-timeline">
        <h4>Seguimiento</h4>
        <form id="wholesaleTimelineForm" class="wh-form-inline">
          <select id="wholesaleTimelineType">
            ${timelineOptions}
          </select>
          <input type="text" id="wholesaleTimelineNote" placeholder="Detalle del contacto" required />
          <button type="submit" class="button">Registrar</button>
        </form>
        <ul class="wh-history-list">
          ${historyHtml}
        </ul>
      </section>
    </div>
  `;
  attachWholesaleDetailEvents(request);
  if (previousInputs) {
    const subjectInput = document.getElementById("wholesaleEmailSubject");
    if (subjectInput && previousInputs.subject) {
      subjectInput.value = previousInputs.subject;
    }
    const messageInput = document.getElementById("wholesaleDecisionMessage");
    if (messageInput && previousInputs.message) {
      messageInput.value = previousInputs.message;
    }
    const notifyCheckbox = document.getElementById(
      "wholesaleNotifyApplicant",
    );
    if (notifyCheckbox) {
      notifyCheckbox.checked = previousInputs.notify;
    }
    const createCheckbox = document.getElementById("wholesaleCreateAccount");
    if (createCheckbox && typeof previousInputs.createAccount === "boolean") {
      createCheckbox.checked = previousInputs.createAccount;
    }
    const notesTextarea = document.getElementById("wholesaleInternalNotes");
    if (notesTextarea && previousInputs.internalNotes) {
      notesTextarea.value = previousInputs.internalNotes;
    }
    const assigneeInput = document.getElementById("wholesaleAssigneeInput");
    if (assigneeInput && previousInputs.assignedTo) {
      assigneeInput.value = previousInputs.assignedTo;
    }
    const timelineType = document.getElementById("wholesaleTimelineType");
    if (timelineType && previousInputs.timelineType) {
      timelineType.value = previousInputs.timelineType;
    }
  }
}

function attachWholesaleDetailEvents(request) {
  const approveBtn = document.getElementById("wholesaleApproveBtn");
  if (approveBtn) {
    approveBtn.addEventListener("click", () =>
      handleWholesaleDecision("approved", approveBtn),
    );
  }
  const docsBtn = document.getElementById("wholesaleRequestDocsBtn");
  if (docsBtn) {
    docsBtn.addEventListener("click", () =>
      handleWholesaleDecision("waiting_documents", docsBtn),
    );
  }
  const rejectBtn = document.getElementById("wholesaleRejectBtn");
  if (rejectBtn) {
    rejectBtn.addEventListener("click", () =>
      handleWholesaleDecision("rejected", rejectBtn),
    );
  }
  const archiveBtn = document.getElementById("wholesaleArchiveBtn");
  if (archiveBtn) {
    archiveBtn.addEventListener("click", () => {
      const next = archiveBtn.dataset.nextStatus || "archived";
      handleWholesaleDecision(next, archiveBtn);
    });
  }
  const notesForm = document.getElementById("wholesaleNotesForm");
  if (notesForm) {
    notesForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const assignedTo =
        document.getElementById("wholesaleAssigneeInput")?.value.trim() || "";
      const internalNotes =
        document.getElementById("wholesaleInternalNotes")?.value || "";
      updateWholesaleRequest(
        request.id,
        { assignedTo, internalNotes },
        { successMessage: "Cambios guardados" },
      );
    });
  }
  const takeBtn = document.getElementById("wholesaleTakeBtn");
  if (takeBtn) {
    takeBtn.addEventListener("click", () => {
      const actor = getCurrentActor();
      const assignedTo =
        actor.name || actor.email || "Administrador";
      const notesInput = document.getElementById("wholesaleInternalNotes");
      const internalNotes = notesInput ? notesInput.value : "";
      const assigneeInput = document.getElementById("wholesaleAssigneeInput");
      if (assigneeInput) assigneeInput.value = assignedTo;
      updateWholesaleRequest(
        request.id,
        { assignedTo, internalNotes },
        { successMessage: "Caso asignado" },
      );
    });
  }
  const docForm = document.getElementById("wholesaleDocumentForm");
  if (docForm) {
    docForm.addEventListener("submit", (event) =>
      handleWholesaleDocumentUpload(event, request.id),
    );
  }
  wholesaleDetailContainer
    .querySelectorAll("[data-remove-doc]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const docId = btn.getAttribute("data-remove-doc");
        handleWholesaleDocumentRemove(request.id, docId, btn);
      });
    });
  const timelineForm = document.getElementById("wholesaleTimelineForm");
  if (timelineForm) {
    timelineForm.addEventListener("submit", (event) =>
      handleWholesaleTimelineSubmit(event, request.id),
    );
  }
}

async function updateWholesaleRequest(id, payload, options = {}) {
  if (!id) return null;
  const actor = getCurrentActor();
  const body = {
    ...payload,
    actorName: actor.name,
    actorEmail: actor.email,
  };
  try {
    const res = await apiFetch(
      `/api/wholesale/requests/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(wholesaleState.requests)) {
      wholesaleState.requests = wholesaleState.requests.map((item) =>
        item.id === data.request.id ? data.request : item,
      );
    }
    wholesaleState.detail = data.request;
    renderWholesaleTable();
    renderWholesaleDetail(data.request);
    if (options.successMessage && window.showToast) {
      showToast(options.successMessage);
    }
    if (data.emailSent && window.showToast) {
      showToast("Correo enviado al solicitante");
    }
    if (data.credentials && data.credentials.tempPassword) {
      alert(`Clave provisoria generada: ${data.credentials.tempPassword}`);
    }
    return data.request;
  } catch (err) {
    console.error("wholesale-update", err);
    if (window.showToast) {
      showToast("No se pudo actualizar la solicitud");
    }
    throw err;
  }
}

async function handleWholesaleDecision(status, trigger) {
  const detail = wholesaleState.detail;
  if (!detail || !detail.id) return;
  const nextStatus =
    status === "archived" && detail.status === "archived"
      ? "pending_review"
      : status;
  const confirmMessage =
    nextStatus === "approved"
      ? "¿Aprobar la solicitud mayorista?"
      : nextStatus === "rejected"
      ? "¿Rechazar la solicitud mayorista?"
      : nextStatus === "waiting_documents"
      ? "¿Marcar la solicitud como pendiente de documentación?"
      : nextStatus === "archived"
      ? "¿Archivar la solicitud mayorista?"
      : null;
  if (confirmMessage && !confirm(confirmMessage)) {
    return;
  }
  if (trigger) trigger.disabled = true;
  try {
    const notifyCheckbox = document.getElementById(
      "wholesaleNotifyApplicant",
    );
    const subjectInput = document.getElementById("wholesaleEmailSubject");
    const messageInput = document.getElementById("wholesaleDecisionMessage");
    const createCheckbox = document.getElementById("wholesaleCreateAccount");
    const subjectValue = subjectInput ? subjectInput.value.trim() : "";
    const messageValue = messageInput ? messageInput.value.trim() : "";
    await updateWholesaleRequest(
      detail.id,
      {
        status: nextStatus,
        decisionNote: messageValue,
        emailSubject: subjectValue || undefined,
        emailMessage: messageValue || undefined,
        notifyApplicant: notifyCheckbox ? notifyCheckbox.checked : false,
        createAccount:
          nextStatus === "approved" && createCheckbox
            ? createCheckbox.checked
            : undefined,
      },
      {
        successMessage:
          nextStatus === "approved"
            ? "Solicitud aprobada"
            : nextStatus === "rejected"
            ? "Solicitud rechazada"
            : nextStatus === "waiting_documents"
            ? "Estado actualizado"
            : nextStatus === "archived"
            ? "Solicitud archivada"
            : "Solicitud actualizada",
      },
    );
  } catch (err) {
    // Manejado por updateWholesaleRequest
  } finally {
    if (trigger) trigger.disabled = false;
  }
}

async function handleWholesaleDocumentUpload(event, id) {
  event.preventDefault();
  const form = event.currentTarget;
  const fileInput = form.querySelector("#wholesaleDocumentFile");
  if (!fileInput || !fileInput.files || !fileInput.files.length) {
    if (window.showToast) showToast("Seleccioná un archivo");
    return;
  }
  const labelInput = form.querySelector("#wholesaleDocumentLabel");
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  if (labelInput && labelInput.value.trim()) {
    formData.append("label", labelInput.value.trim());
  }
  const actor = getCurrentActor();
  formData.append("actorName", actor.name || "");
  if (actor.email) formData.append("actorEmail", actor.email);
  try {
    const res = await apiFetch(
      `/api/wholesale/requests/${encodeURIComponent(id)}/documents`,
      {
        method: "POST",
        body: formData,
      },
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    wholesaleState.requests = wholesaleState.requests.map((item) =>
      item.id === data.request.id ? data.request : item,
    );
    wholesaleState.detail = data.request;
    renderWholesaleTable();
    renderWholesaleDetail(data.request);
    form.reset();
    if (window.showToast) showToast("Documento adjuntado");
  } catch (err) {
    console.error("wholesale-doc-upload", err);
    if (window.showToast) showToast("No se pudo adjuntar el documento");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleWholesaleDocumentRemove(id, docId, trigger) {
  if (!docId) return;
  if (!confirm("¿Eliminar el documento adjunto?")) return;
  if (trigger) trigger.disabled = true;
  try {
    const res = await apiFetch(
      `/api/wholesale/requests/${encodeURIComponent(id)}/documents/${encodeURIComponent(
        docId,
      )}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    wholesaleState.requests = wholesaleState.requests.map((item) =>
      item.id === data.request.id ? data.request : item,
    );
    wholesaleState.detail = data.request;
    renderWholesaleTable();
    renderWholesaleDetail(data.request);
    if (window.showToast) showToast("Documento eliminado");
  } catch (err) {
    console.error("wholesale-doc-remove", err);
    if (window.showToast) showToast("No se pudo eliminar el documento");
  } finally {
    if (trigger) trigger.disabled = false;
  }
}

async function handleWholesaleTimelineSubmit(event, id) {
  event.preventDefault();
  const form = event.currentTarget;
  const typeSelect = form.querySelector("#wholesaleTimelineType");
  const noteInput = form.querySelector("#wholesaleTimelineNote");
  const note = noteInput ? noteInput.value.trim() : "";
  if (!note) {
    if (window.showToast) showToast("Ingresá un detalle para el seguimiento");
    return;
  }
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    await updateWholesaleRequest(
      id,
      {
        timelineEntry: {
          type: typeSelect ? typeSelect.value : "note",
          note,
        },
      },
      { successMessage: "Seguimiento registrado" },
    );
    form.reset();
  } catch (err) {
    // manejado en updateWholesaleRequest
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ------------ Métricas ------------
const metricsContent = document.getElementById("metricsContent");
let salesChartInstance;
let topProductsChartInstance;
const MOCK_METRICS = {
  totalOrders: 0,
  salesByMonth: {
    "2025-01": 10000,
    "2025-02": 15000,
    "2025-03": 12000,
  },
  topProducts: [
    { name: "Producto demo A", quantity: 25 },
    { name: "Producto demo B", quantity: 15 },
    { name: "Producto demo C", quantity: 8 },
  ],
};

function renderMetrics(m) {
  let html = `<p>Total de pedidos: ${m.totalOrders}</p>`;
  // Calcular total anual y desglose de IVA (21%)
  const totalAnnual = Object.values(m.salesByMonth).reduce(
    (sum, t) => sum + t,
    0,
  );
  const iva = Math.round(totalAnnual * 0.21);
  html += `<p>Total de ventas (neto): $${totalAnnual.toLocaleString("es-AR")}</p>`;
  html += `<p>IVA (21%): $${iva.toLocaleString("es-AR")}</p>`;
  html += "<h4>Ventas por mes</h4>";
  html +=
    '<div class="chart-wrapper"><canvas id="salesChartCanvas" height="180"></canvas></div>';
  html += "<h4>Productos más vendidos</h4>";
  html +=
    '<div class="chart-wrapper"><canvas id="topProductsChartCanvas" height="180"></canvas></div>';
  metricsContent.innerHTML = html;
  const labels = Object.keys(m.salesByMonth);
  const values = Object.values(m.salesByMonth);
  const ctx = document.getElementById("salesChartCanvas").getContext("2d");
  if (salesChartInstance) {
    salesChartInstance.destroy();
  }
  salesChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Ventas",
          data: values,
          backgroundColor: "#3b82f6",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `$${ctx.parsed.y.toLocaleString("es-AR")}`,
          },
        },
      },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });

  const topLabels = m.topProducts.map((p) => p.name);
  const topData = m.topProducts.map((p) => p.quantity);
  const ctxTop = document
    .getElementById("topProductsChartCanvas")
    .getContext("2d");
  if (topProductsChartInstance) {
    topProductsChartInstance.destroy();
  }
  topProductsChartInstance = new Chart(ctxTop, {
    type: "bar",
    data: {
      labels: topLabels,
      datasets: [
        {
          label: "Unidades",
          data: topData,
          backgroundColor: "#10b981",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

async function loadMetrics() {
  let m;
  try {
    const res = await apiFetch("/api/metrics");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    m = data.metrics;
    if (!m || !Object.keys(m.salesByMonth).length) {
      m = MOCK_METRICS;
    }
  } catch (err) {
    console.error("Error al obtener métricas:", err);
    m = MOCK_METRICS;
  }
  renderMetrics(m);
}

// ------------ Devoluciones ------------
// Cuerpo de la tabla de devoluciones
const returnsTableBody = document.querySelector("#returnsTable tbody");

/**
 * Carga las solicitudes de devolución desde el backend y las muestra en la tabla.
 * Permite al administrador aprobar o rechazar cada solicitud. Una vez actualizada,
 * se recarga la lista para reflejar los cambios.
 */
async function loadReturns() {
  try {
    const res = await apiFetch("/api/returns");
    if (!res.ok) throw new Error("No se pudieron obtener las devoluciones");
    const data = await res.json();
    returnsTableBody.innerHTML = "";
    if (!data.returns || data.returns.length === 0) {
      returnsTableBody.innerHTML =
        '<tr><td colspan="7">No hay solicitudes de devolución.</td></tr>';
      return;
    }
    data.returns.forEach((ret) => {
      const tr = document.createElement("tr");
      // Mostrar datos básicos de la devolución
      tr.innerHTML = `
        <td>${ret.id}</td>
        <td>${ret.orderId}</td>
        <td>${ret.customerEmail || ""}</td>
        <td>${new Date(ret.date).toLocaleString("es-AR")}</td>
        <td>${ret.reason}</td>
        <td>${ret.status}</td>
        <td></td>
      `;
      // Acción de aprobar/rechazar
      const actionTd = tr.querySelector("td:last-child");
      if (ret.status === "pendiente") {
        const approveBtn = document.createElement("button");
        approveBtn.textContent = "Aprobar";
        approveBtn.className = "save-order-btn";
        const rejectBtn = document.createElement("button");
        rejectBtn.textContent = "Rechazar";
        rejectBtn.style.marginLeft = "0.25rem";
        rejectBtn.className = "delete-btn";
        approveBtn.addEventListener("click", async () => {
          if (!confirm("¿Aprobar esta devolución?")) return;
          const resp = await apiFetch(`/api/returns/${ret.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "aprobado" }),
          });
          if (resp.ok) {
            alert("Devolución aprobada");
            loadReturns();
          } else {
            alert("Error al actualizar la devolución");
          }
        });
        rejectBtn.addEventListener("click", async () => {
          if (!confirm("¿Rechazar esta devolución?")) return;
          const resp = await apiFetch(`/api/returns/${ret.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "rechazado" }),
          });
          if (resp.ok) {
            alert("Devolución rechazada");
            loadReturns();
          } else {
            alert("Error al actualizar la devolución");
          }
        });
        actionTd.appendChild(approveBtn);
        actionTd.appendChild(rejectBtn);
      }
      returnsTableBody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    returnsTableBody.innerHTML =
      '<tr><td colspan="7">No se pudieron cargar las devoluciones.</td></tr>';
  }
}

// ------------ Configuración ------------
const configForm = document.getElementById("configForm");
const gaInput = document.getElementById("configGAId");
const metaInput = document.getElementById("configMetaId");
const whatsappInput = document.getElementById("configWhatsApp");
const carriersTextarea = document.getElementById("configCarriers");
const shippingTable = document.getElementById("shippingTable");
const shippingTableBody = document.querySelector("#shippingTable tbody");
const saveShippingBtn = document.getElementById("saveShippingBtn");
const shippingAlert = document.getElementById("shippingAlert");
let shippingMethods = [];
const paymentSettingsForm = document.getElementById("paymentSettingsForm");
const transferEnabledInput = document.getElementById("transferEnabled");
const bankNameInput = document.getElementById("bankName");
const bankHolderInput = document.getElementById("bankHolder");
const bankTypeInput = document.getElementById("bankType");
const bankCbuInput = document.getElementById("bankCbu");
const bankAliasInput = document.getElementById("bankAlias");
const bankCuitInput = document.getElementById("bankCuit");
const bankInstructionsInput = document.getElementById("bankInstructions");
const cashEnabledInput = document.getElementById("cashEnabled");
const cashAllowedMethodsSelect = document.getElementById("cashAllowedMethods");
const cashPickupInput = document.getElementById("cashPickup");
const cashDeliveryInput = document.getElementById("cashDelivery");
const savePaymentSettingsBtn = document.getElementById("savePaymentSettingsBtn");
const paymentSettingsStatus = document.getElementById("paymentSettingsStatus");

/**
 * Carga los valores de configuración actuales y los muestra en el formulario.
 */
async function loadConfigForm() {
  try {
    const res = await apiFetch("/api/config");
    if (!res.ok) throw new Error("No se pudo obtener la configuración");
    const cfg = await res.json();
    gaInput.value = cfg.googleAnalyticsId || "";
    metaInput.value = cfg.metaPixelId || "";
    whatsappInput.value = cfg.whatsappNumber || "";
    carriersTextarea.value = (cfg.defaultCarriers || []).join("\n");
  } catch (err) {
    console.error(err);
    alert("Error al cargar la configuración");
  }
}

function renderCashAllowedOptions(selected = []) {
  if (!cashAllowedMethodsSelect) return;
  const selectedSet = new Set(selected.map((s) => String(s).toLowerCase()));
  const methods =
    shippingMethods && shippingMethods.length
      ? shippingMethods
      : [
          { id: "retiro", label: "Retiro en local" },
          { id: "estandar", label: "Envío estándar" },
          { id: "express", label: "Envío express" },
        ];
  cashAllowedMethodsSelect.innerHTML = "";
  methods.forEach((method) => {
    const option = document.createElement("option");
    option.value = method.id;
    option.textContent = method.label || method.id;
    option.selected = selectedSet.has(String(method.id).toLowerCase());
    cashAllowedMethodsSelect.appendChild(option);
  });
}

async function loadPaymentSettingsAdmin() {
  if (!paymentSettingsForm) return;
  try {
    const res = await apiFetch("/api/payment-settings");
    if (!res.ok) throw new Error("No se pudo obtener la configuración de pagos");
    const settings = await res.json();
    if (transferEnabledInput)
      transferEnabledInput.checked = settings?.bank_transfer?.enabled !== false;
    if (bankNameInput) bankNameInput.value = settings?.bank_transfer?.bank_name || "";
    if (bankHolderInput)
      bankHolderInput.value = settings?.bank_transfer?.account_holder_name || "";
    if (bankTypeInput)
      bankTypeInput.value = settings?.bank_transfer?.account_type || "";
    if (bankCbuInput) bankCbuInput.value = settings?.bank_transfer?.cbu || "";
    if (bankAliasInput) bankAliasInput.value = settings?.bank_transfer?.alias || "";
    if (bankCuitInput) bankCuitInput.value = settings?.bank_transfer?.cuit || "";
    if (bankInstructionsInput)
      bankInstructionsInput.value = settings?.bank_transfer?.additional_instructions || "";
    if (cashEnabledInput)
      cashEnabledInput.checked = settings?.cash_payment?.enabled !== false;
    renderCashAllowedOptions(settings?.cash_payment?.allowed_shipping_methods || []);
    if (cashPickupInput)
      cashPickupInput.value = settings?.cash_payment?.instructions_pickup || "";
    if (cashDeliveryInput)
      cashDeliveryInput.value = settings?.cash_payment?.instructions_delivery || "";
    if (paymentSettingsStatus) {
      paymentSettingsStatus.textContent = settings?.updated_at
        ? `Actualizado: ${new Date(settings.updated_at).toLocaleString("es-AR")}`
        : "";
    }
  } catch (error) {
    console.error(error);
    alert("No se pudieron cargar los datos de pago");
  }
}

async function loadShippingTable() {
  try {
    const res = await apiFetch("/api/shipping-table");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "error");
    shippingMethods = Array.isArray(data.methods) && data.methods.length
      ? data.methods
      : [
          { id: "retiro", label: "Retiro en local" },
          { id: "estandar", label: "Envío estándar" },
          { id: "express", label: "Envío express" },
        ];
    if (shippingTable) {
      const headerRow = shippingTable.querySelector("thead tr");
      if (headerRow) {
        headerRow.innerHTML = "";
        const provTh = document.createElement("th");
        provTh.textContent = "Provincia";
        headerRow.appendChild(provTh);
        shippingMethods.forEach((method) => {
          const th = document.createElement("th");
          th.dataset.method = method.id;
          th.textContent = `${method.label} ($)`;
          headerRow.appendChild(th);
        });
      }
    }
    shippingTableBody.innerHTML = "";
    (data.costos || []).forEach((row) => {
      const tr = document.createElement("tr");
      const provTd = document.createElement("td");
      provTd.textContent = row.provincia;
      tr.appendChild(provTd);
      shippingMethods.forEach((method) => {
        const costTd = document.createElement("td");
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.step = "1";
        input.value =
          row.metodos && typeof row.metodos[method.id] === "number"
            ? row.metodos[method.id]
            : 0;
        input.dataset.method = method.id;
        costTd.appendChild(input);
        tr.appendChild(costTd);
      });
      shippingTableBody.appendChild(tr);
    });
    renderCashAllowedOptions(
      Array.from(cashAllowedMethodsSelect?.selectedOptions || []).map(
        (opt) => opt.value,
      ),
    );
    if (shippingAlert) shippingAlert.style.display = "none";
  } catch (err) {
    console.error(err);
    if (shippingAlert) {
      shippingAlert.textContent = "Error al cargar la tabla de env\u00edos";
      shippingAlert.style.display = "block";
    }
  }
}

// Guardar configuración al enviar el formulario
if (configForm) {
  configForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newCfg = {
      googleAnalyticsId: gaInput.value.trim(),
      metaPixelId: metaInput.value.trim(),
      whatsappNumber: whatsappInput.value.trim(),
      defaultCarriers: carriersTextarea.value
        .split(/\n+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    };
    try {
      const resp = await apiFetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCfg),
      });
      if (resp.ok) {
        alert("Configuración guardada");
        loadConfigForm();
      } else {
        const data = await resp.json().catch(() => ({}));
        alert(data.error || "Error al guardar la configuración");
      }
    } catch (err) {
      console.error(err);
      alert("Error de red al guardar la configuración");
    }
  });
}

if (saveShippingBtn) {
  saveShippingBtn.addEventListener("click", async () => {
    const rows = shippingTableBody.querySelectorAll("tr");
    const costos = [];
    let valid = true;
    rows.forEach((tr) => {
      const provincia = tr.children[0].textContent.trim();
      const metodos = {};
      shippingMethods.forEach((method) => {
        const input = tr.querySelector(`input[data-method="${method.id}"]`);
        if (!input) return;
        const val = parseFloat(input.value);
        if (Number.isNaN(val) || val < 0) {
          valid = false;
          input.classList.add("invalid");
        } else {
          input.classList.remove("invalid");
        }
        metodos[method.id] = Number.isNaN(val) ? 0 : val;
      });
      costos.push({ provincia, metodos });
    });
    if (!valid) {
      shippingAlert.textContent = "Ingresa valores v\u00e1lidos";
      shippingAlert.style.display = "block";
      return;
    }
    try {
      const resp = await apiFetch("/api/shipping-table", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costos, methods: shippingMethods }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        shippingAlert.textContent = "Cambios guardados";
        shippingAlert.style.color = "green";
        shippingAlert.style.display = "block";
      } else {
        shippingAlert.textContent = data.error || "Error al guardar";
        shippingAlert.style.color = "";
        shippingAlert.style.display = "block";
      }
    } catch (err) {
      console.error(err);
      shippingAlert.textContent = "Error de red";
      shippingAlert.style.display = "block";
    }
  });
}

if (savePaymentSettingsBtn && paymentSettingsForm) {
  savePaymentSettingsBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    const payload = {
      bank_transfer: {
        enabled: transferEnabledInput?.checked ?? true,
        bank_name: bankNameInput?.value.trim() || "",
        account_holder_name: bankHolderInput?.value.trim() || "",
        account_type: bankTypeInput?.value.trim() || "",
        cbu: bankCbuInput?.value.trim() || "",
        alias: bankAliasInput?.value.trim() || "",
        cuit: bankCuitInput?.value.trim() || "",
        additional_instructions: bankInstructionsInput?.value.trim() || "",
      },
      cash_payment: {
        enabled: cashEnabledInput?.checked ?? true,
        allowed_shipping_methods: Array.from(
          cashAllowedMethodsSelect?.selectedOptions || [],
        ).map((opt) => opt.value),
        instructions_pickup: cashPickupInput?.value.trim() || "",
        instructions_delivery: cashDeliveryInput?.value.trim() || "",
      },
    };
    try {
      const res = await apiFetch("/api/admin/payment-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Error al guardar pagos");
      paymentSettingsStatus.textContent = "Configuración guardada";
      loadPaymentSettingsAdmin();
    } catch (error) {
      console.error(error);
      paymentSettingsStatus.textContent = "No se pudo guardar la configuración";
    }
  });
}

const partnerForm = document.getElementById("partnerForm");
const partnersTableBody = document.querySelector("#partnersTable tbody");
const referralForm = document.getElementById("referralForm");
const referralsTableBody = document.querySelector("#referralsTable tbody");
const reviewsTableBody = document.querySelector("#reviewsTable tbody");
const auditTableBody = document.querySelector("#auditTable tbody");
const auditRefreshBtn = document.getElementById("auditRefresh");
const partnerAddressInput = document.getElementById("partnerAddress");
const partnerAddressSuggestions = document.getElementById(
  "partnerAddressSuggestions",
);
const partnerLatInput = document.getElementById("partnerLat");
const partnerLngInput = document.getElementById("partnerLng");

let addressAutocompleteTimer = null;
let lastAddressQuery = "";

function parseCommaList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clearPartnerAddressSuggestions() {
  if (!partnerAddressSuggestions) return;
  partnerAddressSuggestions.innerHTML = "";
  partnerAddressSuggestions.classList.remove("is-visible");
}

function renderPartnerAddressSuggestions(items) {
  if (!partnerAddressSuggestions) return;
  partnerAddressSuggestions.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "address-autocomplete__empty";
    empty.textContent = "No se encontraron direcciones.";
    partnerAddressSuggestions.appendChild(empty);
    partnerAddressSuggestions.classList.add("is-visible");
    return;
  }

  items.forEach((item) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "address-autocomplete__option";
    option.textContent = item.display_name || "";
    option.addEventListener("click", () => {
      if (partnerAddressInput) {
        partnerAddressInput.value = item.display_name || "";
      }
      if (partnerLatInput) partnerLatInput.value = item.lat || "";
      if (partnerLngInput) partnerLngInput.value = item.lon || "";
      clearPartnerAddressSuggestions();
    });
    partnerAddressSuggestions.appendChild(option);
  });
  partnerAddressSuggestions.classList.add("is-visible");
}

async function fetchPartnerAddressSuggestions(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("q", query);
  const res = await fetch(url.toString(), {
    headers: { "Accept-Language": "es" },
  });
  if (!res.ok) throw new Error("address-search");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function loadPartnersAdmin() {
  if (!partnersTableBody) return;
  partnersTableBody.innerHTML = "";
  try {
    const res = await apiFetch("/api/admin/partners", {
      headers: getAdminHeaders({ Accept: "application/json" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error");
    const partners = Array.isArray(data.partners) ? data.partners : [];
    partners.forEach((partner) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(partner.name || "")}</td>
        <td></td>
        <td>${escapeHtml((partner.tags || []).join(", "))}</td>
        <td></td>
      `;
      const statusCell = row.children[1];
      const select = document.createElement("select");
      ["PENDING", "APPROVED", "SUSPENDED"].forEach((status) => {
        const option = document.createElement("option");
        option.value = status;
        option.textContent = status;
        if (partner.status === status) option.selected = true;
        select.appendChild(option);
      });
      statusCell.appendChild(select);
      const actionsCell = row.children[3];
      const saveBtn = document.createElement("button");
      saveBtn.className = "button";
      saveBtn.type = "button";
      saveBtn.textContent = "Actualizar";
      saveBtn.addEventListener("click", async () => {
        await apiFetch(`/api/admin/partners/${partner.id}`, {
          method: "PUT",
          headers: getAdminHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ status: select.value }),
        });
        loadPartnersAdmin();
      });
      actionsCell.appendChild(saveBtn);
      partnersTableBody.appendChild(row);
    });
  } catch (error) {
    console.error(error);
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="4">No se pudieron cargar partners.</td>`;
    partnersTableBody.appendChild(row);
  }
}

if (partnerForm) {
  if (partnerAddressInput && partnerAddressSuggestions) {
    partnerAddressInput.addEventListener("input", () => {
      const query = partnerAddressInput.value.trim();
      if (addressAutocompleteTimer) {
        window.clearTimeout(addressAutocompleteTimer);
      }
      if (query.length < 3) {
        clearPartnerAddressSuggestions();
        lastAddressQuery = query;
        return;
      }
      addressAutocompleteTimer = window.setTimeout(async () => {
        lastAddressQuery = query;
        try {
          const results = await fetchPartnerAddressSuggestions(query);
          if (partnerAddressInput.value.trim() !== lastAddressQuery) return;
          renderPartnerAddressSuggestions(results);
        } catch (error) {
          console.error(error);
          clearPartnerAddressSuggestions();
        }
      }, 300);
    });

    partnerAddressInput.addEventListener("blur", () => {
      window.setTimeout(() => {
        clearPartnerAddressSuggestions();
      }, 150);
    });

    partnerAddressInput.addEventListener("focus", () => {
      if (partnerAddressSuggestions?.children.length) {
        partnerAddressSuggestions.classList.add("is-visible");
      }
    });
  }

  partnerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      name: document.getElementById("partnerName")?.value.trim(),
      address: document.getElementById("partnerAddress")?.value.trim(),
      whatsapp: document.getElementById("partnerWhatsapp")?.value.trim(),
      lat: document.getElementById("partnerLat")?.value,
      lng: document.getElementById("partnerLng")?.value,
      tags: parseCommaList(document.getElementById("partnerTags")?.value),
      photos: parseCommaList(document.getElementById("partnerPhotos")?.value),
      status: document.getElementById("partnerStatus")?.value,
    };
    await apiFetch("/api/admin/partners", {
      method: "POST",
      headers: getAdminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    partnerForm.reset();
    loadPartnersAdmin();
  });
}

async function loadReferralsAdmin() {
  if (!referralsTableBody) return;
  referralsTableBody.innerHTML = "";
  try {
    const res = await apiFetch("/api/admin/referrals", {
      headers: getAdminHeaders({ Accept: "application/json" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error");
    const referrals = Array.isArray(data.referrals) ? data.referrals : [];
    referrals.forEach((referral) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(referral.id)}</td>
        <td>${escapeHtml(referral.partner_id || "")}</td>
        <td>${escapeHtml(referral.customer_email || "")}</td>
        <td></td>
        <td></td>
      `;
      const statusCell = row.children[3];
      const select = document.createElement("select");
      ["OPEN", "ACCEPTED", "COMPLETED", "CLOSED"].forEach((status) => {
        const option = document.createElement("option");
        option.value = status;
        option.textContent = status;
        if (referral.status === status) option.selected = true;
        select.appendChild(option);
      });
      statusCell.appendChild(select);
      const actionsCell = row.children[4];
      const saveBtn = document.createElement("button");
      saveBtn.className = "button";
      saveBtn.type = "button";
      saveBtn.textContent = "Actualizar";
      saveBtn.addEventListener("click", async () => {
        await apiFetch(`/api/admin/referrals/${referral.id}`, {
          method: "PUT",
          headers: getAdminHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ status: select.value }),
        });
        loadReferralsAdmin();
      });
      actionsCell.appendChild(saveBtn);
      referralsTableBody.appendChild(row);
    });
  } catch (error) {
    console.error(error);
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="5">No se pudieron cargar referrals.</td>`;
    referralsTableBody.appendChild(row);
  }
}

if (referralForm) {
  referralForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      orderId: document.getElementById("referralOrderId")?.value.trim(),
      partnerId: document.getElementById("referralPartnerId")?.value.trim(),
      customerName: document.getElementById("referralCustomerName")?.value.trim(),
      customerEmail: document.getElementById("referralCustomerEmail")?.value.trim(),
      status: document.getElementById("referralStatus")?.value,
    };
    await apiFetch("/api/admin/referrals", {
      method: "POST",
      headers: getAdminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    referralForm.reset();
    loadReferralsAdmin();
  });
}

async function loadReviewsAdmin() {
  if (!reviewsTableBody) return;
  reviewsTableBody.innerHTML = "";
  try {
    const res = await apiFetch("/api/admin/reviews", {
      headers: getAdminHeaders({ Accept: "application/json" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error");
    const reviews = Array.isArray(data.reviews) ? data.reviews : [];
    reviews.forEach((review) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(review.id)}</td>
        <td>${escapeHtml(review.verification_type || "")}</td>
        <td>${escapeHtml(String(review.rating || ""))}</td>
        <td></td>
        <td></td>
      `;
      const statusCell = row.children[3];
      const select = document.createElement("select");
      ["PENDING", "PUBLISHED", "FLAGGED", "REMOVED"].forEach((status) => {
        const option = document.createElement("option");
        option.value = status;
        option.textContent = status;
        if (review.status === status) option.selected = true;
        select.appendChild(option);
      });
      statusCell.appendChild(select);
      const actionsCell = row.children[4];
      const saveBtn = document.createElement("button");
      saveBtn.className = "button";
      saveBtn.type = "button";
      saveBtn.textContent = "Actualizar";
      saveBtn.addEventListener("click", async () => {
        await apiFetch(`/api/admin/reviews/${review.id}`, {
          method: "PUT",
          headers: getAdminHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ status: select.value }),
        });
        loadReviewsAdmin();
      });
      actionsCell.appendChild(saveBtn);
      reviewsTableBody.appendChild(row);
    });
  } catch (error) {
    console.error(error);
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="5">No se pudieron cargar reseñas.</td>`;
    reviewsTableBody.appendChild(row);
  }
}

async function loadAuditAdmin() {
  if (!auditTableBody) return;
  auditTableBody.innerHTML = "";
  try {
    const from = document.getElementById("auditFrom")?.value;
    const to = document.getElementById("auditTo")?.value;
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const res = await apiFetch(`/api/admin/audit?${params.toString()}`, {
      headers: getAdminHeaders({ Accept: "application/json" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error");
    const entries = Array.isArray(data.entries) ? data.entries : [];
    entries.forEach((entry) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(entry.created_at || "")}</td>
        <td>${escapeHtml(entry.type || "")}</td>
        <td>${escapeHtml(JSON.stringify(entry.data || {}))}</td>
      `;
      auditTableBody.appendChild(row);
    });
    if (!entries.length) {
      const row = document.createElement("tr");
      row.innerHTML = `<td colspan="3">Sin eventos.</td>`;
      auditTableBody.appendChild(row);
    }
  } catch (error) {
    console.error(error);
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="3">No se pudo cargar la auditoría.</td>`;
    auditTableBody.appendChild(row);
  }
}

if (auditRefreshBtn) {
  auditRefreshBtn.addEventListener("click", loadAuditAdmin);
}

// Cargar productos inicialmente
loadProducts();
