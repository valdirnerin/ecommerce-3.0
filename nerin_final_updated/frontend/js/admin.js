/*
 * Lógica del panel de administración de NERIN.
 *
 * Este módulo gestiona la navegación entre secciones (productos, pedidos,
 * clientes y métricas), solicita datos al backend y permite
 * crear/editar/eliminar productos y actualizar estados de pedidos.
 */

import { getUserRole, logout } from "./api.js";
import { renderAnalyticsDashboard } from "./analytics.js";

const ADMIN_BUILD_FALLBACK =
  (typeof window !== "undefined" && window.__NERIN_ADMIN_BUILD__) || "dev";

if (typeof window !== "undefined" && !window.__NERIN_ADMIN_BUILD__) {
  window.__NERIN_ADMIN_BUILD__ = ADMIN_BUILD_FALLBACK;
}

async function logAdminBuildVersion() {
  let buildId = ADMIN_BUILD_FALLBACK;
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
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
    "configSection",
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
    } else if (target === "configSection") {
      loadConfigForm();
    } else if (target === "suppliersSection") {
      loadSuppliers();
    } else if (target === "purchaseOrdersSection") {
      loadPurchaseOrders();
    } else if (target === "analyticsSection") {
      loadAnalytics();
    } else if (target === "shippingSection") {
      loadShippingTable();
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

function formatMultiline(value) {
  if (!value) return "—";
  return escapeHtml(String(value)).replace(/\n/g, "<br />");
}

const currentAdminActor = {
  name: (typeof localStorage !== "undefined" && localStorage.getItem("nerinUserName")) || "Administrador",
  email: (typeof localStorage !== "undefined" && localStorage.getItem("nerinUserEmail")) || "",
};

function getCurrentActor() {
  const actor = { ...currentAdminActor };
  if (!actor.name) actor.name = "Administrador";
  if (!actor.email) delete actor.email;
  return actor;
}

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
const bulkSelect = document.getElementById("bulkActionSelect");
const bulkValueInput = document.getElementById("bulkValue");
const applyBulkBtn = document.getElementById("applyBulkBtn");
const selectAllCheckbox = document.getElementById("selectAllProducts");

const API_BASE = "/api/products";
let originalProduct = null;
let productsCache = [];
let suppliersCache = [];
let productImagesState = [];
let dragImageIndex = null;

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
      const resp = await fetch(
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

openModalBtn.addEventListener("click", () => openProductModal());
closeModalBtn.addEventListener("click", () => productModal.classList.add("hidden"));

productImageInput.addEventListener("change", () => {
  uploadProductImages(productImageInput.files);
});

tagsInput.addEventListener("input", () => {
  const tags = tagsInput.value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t);
  tagsPreview.innerHTML = tags
    .map((t) => `<span class="chip">${t}</span>`)
    .join("");
});

function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const nameInput = document.getElementById("productName");
const slugInput = document.getElementById("productSlug");
const descriptionInput = document.getElementById("productDescription");
const metaTitleInput = document.getElementById("productMetaTitle");
const metaDescInput = document.getElementById("productMetaDesc");
const seoSlugPreview = document.getElementById("seoSlugPreview");
const seoTitlePreview = document.getElementById("seoTitlePreview");
const seoDescPreview = document.getElementById("seoDescPreview");

function resolveDescriptionPreview() {
  const meta = metaDescInput?.value?.trim();
  if (meta) return meta;
  const desc = descriptionInput?.value?.trim();
  return desc || "";
}

function renderSeoPreview() {
  seoSlugPreview.textContent = `/productos/${slugInput.value}`;
  seoTitlePreview.textContent = metaTitleInput.value || nameInput.value;
  seoDescPreview.textContent = resolveDescriptionPreview();
}

nameInput.addEventListener("input", () => {
  if (!productForm.elements.id.value) {
    slugInput.value = slugify(nameInput.value);
  }
  renderSeoPreview();
});
slugInput.addEventListener("input", renderSeoPreview);
metaTitleInput.addEventListener("input", renderSeoPreview);
metaDescInput.addEventListener("input", renderSeoPreview);
if (descriptionInput) descriptionInput.addEventListener("input", renderSeoPreview);

function setLoading(state) {
  productForm
    .querySelectorAll("input,select,textarea,button")
    .forEach((el) => (el.disabled = state));
  productForm.dataset.loading = state ? "1" : "0";
}

async function loadProduct(id) {
  const r = await fetch(`${API_BASE}/${id}`, { headers: { Accept: "application/json" } });
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
  set("tags", Array.isArray(p.tags) ? p.tags.join(", ") : p.tags ?? "");
  set("stock", p.stock);
  set("min_stock", p.min_stock);
  set("price_minorista", p.price_minorista);
  set("price_mayorista", p.price_mayorista);
  set("cost", p.cost);
  set("supplier_id", p.supplier_id);
  set("slug", p.slug);
  set("description", p.description);
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
  renderSeoPreview();
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
  ["stock", "min_stock", "price_minorista", "price_mayorista", "cost", "weight"].forEach(
    (k) => {
      if (k in obj && obj[k] !== "") obj[k] = Number(obj[k]);
    },
  );
  const images = productImagesState.map((img) => img.url);
  const alts = productImagesState.map((img) => img.alt || "");
  obj.images = images;
  obj.images_alt = alts;
  obj.image = images[0] || "";
  if (!obj.image) delete obj.image;
  return obj;
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
      const resp = await fetch("/api/suppliers");
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
    modalTitle.textContent = "Agregar producto";
    renderSeoPreview();
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
    renderSeoPreview();
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
  if (data.stock < 0 || data.min_stock < 0) {
    if (window.showToast) showToast("Stock no puede ser negativo");
    return;
  }
  try {
    setLoading(true);
    let res;
    if (isEdit) {
      const payload = diffObjects(originalProduct, data);
      if (Object.keys(payload).length === 0) {
        productModal.classList.add("hidden");
        return;
      }
      res = await fetch(`${API_BASE}/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    }
    if (!res.ok) throw new Error("save fail");
    if (window.showToast) showToast("Guardado correctamente");
    productModal.classList.add("hidden");
    loadProducts();
  } catch (err) {
    console.error(err);
    if (window.showToast) showToast("Error al guardar. Revisá los campos.");
  } finally {
    setLoading(false);
  }
}

productForm.addEventListener("submit", saveProduct);

async function loadProducts() {
  try {
    const res = await fetch("/api/products");
    const data = await res.json();
    productsCache = data.products;
    productsTableBody.innerHTML = "";
    const categories = new Set();
    const subcategories = new Set();
    if (productsCache.length === 0) {
      productsTableBody.innerHTML =
        '<tr><td colspan="14">No hay productos</td></tr>';
      return;
    }
    productsCache.forEach((product) => {
      if (product.category) categories.add(product.category);
      if (product.subcategory) subcategories.add(product.subcategory);
      const tr = document.createElement("tr");
      tr.dataset.id = product.id;
      const lowBadge =
        product.min_stock !== undefined && product.stock < product.min_stock
          ? '<span class="badge">Bajo</span>'
          : "";
      tr.innerHTML = `
        <td><input type="checkbox" class="select-product" /></td>
        <td>${product.sku}</td>
        <td>${product.name}</td>
        <td>${product.brand || ""}</td>
        <td>${product.model || ""}</td>
        <td>${product.category || ""}</td>
        <td>${product.subcategory || ""}</td>
        <td>${(product.tags || []).join(", ")}</td>
        <td><input type="number" class="inline-edit" data-field="stock" min="0" value="${product.stock}" />${lowBadge}</td>
        <td>${product.min_stock ?? ""}</td>
        <td><input type="number" class="inline-edit" data-field="price_minorista" min="0" value="${product.price_minorista}" /></td>
        <td><input type="number" class="inline-edit" data-field="price_mayorista" min="0" value="${product.price_mayorista}" /></td>
        <td>${product.visibility || ""}</td>
        <td><button class="edit-btn" data-id="${product.id}">Editar</button> <button class="delete-btn" data-id="${product.id}">Eliminar</button></td>`;
      const editBtn = tr.querySelector(".edit-btn");
      editBtn.addEventListener("click", () =>
        openProductModal(editBtn.dataset.id),
      );
      const delBtn = tr.querySelector(".delete-btn");
      delBtn.addEventListener("click", () =>
        deleteProduct(delBtn.dataset.id),
      );
      productsTableBody.appendChild(tr);
    });
    const categorySelect = document.getElementById("productCategory");
    categorySelect.innerHTML =
      '<option value="">Categoría</option>' +
      Array.from(categories)
        .map((c) => `<option value="${c}">${c}</option>`)
        .join("");
    const subcatSelect = document.getElementById("productSubcategory");
    subcatSelect.innerHTML =
      '<option value="">Subcategoría</option>' +
      Array.from(subcategories)
        .map((c) => `<option value="${c}">${c}</option>`)
        .join("");
  } catch (err) {
    console.error(err);
    productsTableBody.innerHTML =
      '<tr><td colspan="14">No se pudieron cargar los productos</td></tr>';
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
    const r = await fetch(`${API_BASE}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!r.ok) throw new Error("patch fail");
  } catch (e) {
    console.error(e);
    if (window.showToast) showToast("No se pudo actualizar");
    input.value = old;
  }
}
const debouncedPatch = debounce(patchField);

productsTableBody.addEventListener("focusin", (e) => {
  const input = e.target;
  if (input.classList.contains("inline-edit")) {
    input.dataset.original = input.value;
  }
});

productsTableBody.addEventListener("input", (e) => {
  const input = e.target;
  if (!input.classList.contains("inline-edit")) return;
  const id = input.closest("tr").dataset.id;
  const field = input.dataset.field;
  const value = input.type === "number" ? Number(input.value) : input.value;
  debouncedPatch(id, field, value, input);
});

selectAllCheckbox.addEventListener("change", () => {
  const checked = selectAllCheckbox.checked;
  document
    .querySelectorAll(".select-product")
    .forEach((cb) => (cb.checked = checked));
});

bulkSelect.addEventListener("change", () => {
  bulkValueInput.style.display = bulkSelect.value.startsWith("price")
    ? "inline-block"
    : "none";
});

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
      await fetch(`/api/products/${id}`, { method: "DELETE" });
    }
  } else if (action.startsWith("vis-")) {
    const vis = action.split("-")[1];
    for (const id of selected) {
      await fetch(`/api/products/${id}`, {
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
      await fetch(`/api/products/${id}`, {
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

async function deleteProduct(id) {
  if (!confirm("¿Estás seguro de eliminar este producto?")) return;
  const resp = await fetch(`/api/products/${id}`, { method: "DELETE" });
  if (resp.ok) {
    loadProducts();
  } else {
    alert("Error al eliminar");
  }
}

deleteProductBtn.addEventListener("click", async () => {
  const id = productForm.elements.id.value;
  if (!id || !confirm("¿Eliminar producto?")) return;
  const resp = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
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
  const resp = await fetch(`${API_BASE}/${id}/duplicate`, {
    method: "POST",
  });
  if (resp.ok) {
    alert("Producto duplicado");
    loadProducts();
  } else {
    alert("Error al duplicar");
  }
});

// ------------ Proveedores ------------
const suppliersTableBody = document.querySelector("#suppliersTable tbody");
const addSupplierForm = document.getElementById("addSupplierForm");

async function loadSuppliers() {
  try {
    const res = await fetch("/api/suppliers");
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
        const resp = await fetch(`/api/suppliers/${sup.id}`, {
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
          const resp = await fetch(`/api/suppliers/${sup.id}`, {
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
      const resp = await fetch("/api/suppliers", {
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
    const res = await fetch("/api/purchase-orders");
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
          const resp = await fetch(`/api/purchase-orders/${po.id}`, {
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
        const resp = await fetch(`/api/purchase-orders/${po.id}`, {
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
      const resp = await fetch("/api/purchase-orders", {
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
async function loadAnalytics() {
  await renderAnalyticsDashboard("analytics-dashboard");
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
    cancelled: "rejected",
    canceled: "rejected",
    refunded: "rejected",
    refund: "rejected",
    devuelto: "rejected",
  };
  const PAYMENT_STATUS_LABELS = {
    approved: "Pagado",
    pending: "Pendiente",
    rejected: "Rechazado",
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
    if (key === "approved" || key === "pending" || key === "rejected") {
      return key;
    }
    return "pending";
  }

  function localizePaymentStatus(status) {
    const code = mapPaymentStatusCodeForUi(status);
    return PAYMENT_STATUS_LABELS[code] || (status ? String(status) : "");
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
    if (typeof value === "string" && value.includes("-")) {
      const [y, m, d] = value.split("-").map((part) => Number(part));
      if ([y, m, d].some((part) => Number.isNaN(part))) return null;
      return new Date(y, m - 1, d);
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
    const city = shipping.city || direccion.localidad || cliente.localidad || "";
    const province =
      shipping.province || direccion.provincia || cliente.provincia || "";
    const zip = shipping.zip || direccion.cp || cliente.cp || "";
    const parts = [];
    const streetLine = [street, number].filter(Boolean).join(" ");
    if (streetLine) parts.push(streetLine.trim());
    const cityLine = [city, province].filter(Boolean).join(", ");
    if (cityLine) parts.push(cityLine.trim());
    if (zip) parts.push(`CP ${zip}`);
    return {
      summary: parts.join(" – "),
      details: { street, number, city, province, zip },
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
          <dt>Pago</dt>
          <dd>${displayValue(paymentLabel)}</dd>
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
          const originalText = saveBtn.textContent;
          saveBtn.disabled = true;
          saveBtn.textContent = "Guardando…";
          try {
            const res = await fetch(
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
            const res = await fetch(
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
            const res = await fetch(
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
      const res = await fetch(
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
      const res = await fetch(
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
      const res = await fetch(
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
      res = await fetch(url);
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
    const res = await fetch("/api/clients");
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
        const resp = await fetch(
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
    const res = await fetch("/api/wholesale/requests");
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
    const res = await fetch(
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
    const res = await fetch(
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
    const res = await fetch(
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
    const res = await fetch(
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
    const res = await fetch("/api/metrics");
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
    const res = await fetch("/api/returns");
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
          const resp = await fetch(`/api/returns/${ret.id}`, {
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
          const resp = await fetch(`/api/returns/${ret.id}`, {
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
const shippingTableBody = document.querySelector("#shippingTable tbody");
const saveShippingBtn = document.getElementById("saveShippingBtn");
const shippingAlert = document.getElementById("shippingAlert");

/**
 * Carga los valores de configuración actuales y los muestra en el formulario.
 */
async function loadConfigForm() {
  try {
    const res = await fetch("/api/config");
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

async function loadShippingTable() {
  try {
    const res = await fetch("/api/shipping-table");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "error");
    shippingTableBody.innerHTML = "";
    (data.costos || []).forEach((row) => {
      const tr = document.createElement("tr");
      const provTd = document.createElement("td");
      provTd.textContent = row.provincia;
      const costTd = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.value = row.costo;
      costTd.appendChild(input);
      tr.appendChild(provTd);
      tr.appendChild(costTd);
      shippingTableBody.appendChild(tr);
    });
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
      const resp = await fetch("/api/config", {
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
      const input = tr.querySelector("input");
      const val = parseFloat(input.value);
      if (Number.isNaN(val)) {
        valid = false;
        input.classList.add("invalid");
      } else {
        input.classList.remove("invalid");
      }
      costos.push({ provincia, costo: val });
    });
    if (!valid) {
      shippingAlert.textContent = "Ingresa valores v\u00e1lidos";
      shippingAlert.style.display = "block";
      return;
    }
    try {
      const resp = await fetch("/api/shipping-table", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costos }),
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

// Cargar productos inicialmente
loadProducts();
