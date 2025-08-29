/*
 * Lógica del panel de administración de NERIN.
 *
 * Este módulo gestiona la navegación entre secciones (productos, pedidos,
 * clientes y métricas), solicita datos al backend y permite
 * crear/editar/eliminar productos y actualizar estados de pedidos.
 */

import { getUserRole, logout } from "./api.js";
import { renderAnalyticsDashboard } from "./analytics.js";
import "./mpStatusMap.js";

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
      loadOrders();
    } else if (target === "clientsSection") {
      loadClients();
    } else if (target === "metricsSection") {
      loadMetrics();
    } else if (target === "returnsSection") {
      loadReturns();
    } else if (target === "configSection") {
      loadConfigForm();
    } else if (target === "footerSection") {
      loadFooter();
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
let uploadedImagePath = "";
let originalProduct = null;
let productsCache = [];
let suppliersCache = [];

openModalBtn.addEventListener("click", () => openProductModal());
closeModalBtn.addEventListener("click", () => productModal.classList.add("hidden"));

productImageInput.addEventListener("change", async () => {
  const file = productImageInput.files[0];
  imagePreview.innerHTML = "";
  uploadedImagePath = "";
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    alert("La imagen supera 5MB");
    productImageInput.value = "";
    return;
  }
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    alert("Formato no permitido. Usa JPG o PNG");
    productImageInput.value = "";
    return;
  }
  const sku = document.getElementById("productSku").value.trim();
  if (!sku) {
    alert("Completá el SKU antes de subir la imagen");
    productImageInput.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    imagePreview.innerHTML = `<img src="${e.target.result}" alt="img" />`;
  };
  reader.readAsDataURL(file);
  const fd = new FormData();
  fd.append("image", file);
  try {
    const resp = await fetch(`/api/product-image/${encodeURIComponent(sku)}`, {
      method: "POST",
      body: fd,
    });
    if (resp.ok) {
      const data = await resp.json();
      uploadedImagePath = data.path;
    } else {
      alert("Error al subir imagen");
      productImageInput.value = "";
    }
  } catch (err) {
    console.error(err);
    alert("Error al subir imagen");
    productImageInput.value = "";
  }
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
const metaTitleInput = document.getElementById("productMetaTitle");
const metaDescInput = document.getElementById("productMetaDesc");
const seoSlugPreview = document.getElementById("seoSlugPreview");
const seoTitlePreview = document.getElementById("seoTitlePreview");
const seoDescPreview = document.getElementById("seoDescPreview");

function renderSeoPreview() {
  seoSlugPreview.textContent = `/productos/${slugInput.value}`;
  seoTitlePreview.textContent = metaTitleInput.value || nameInput.value;
  seoDescPreview.textContent = metaDescInput.value;
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
  set("meta_title", p.meta_title);
  set("meta_description", p.meta_description);
  set("dimensions", p.dimensions);
  set("weight", p.weight);
  set("color", p.color);
  set("visibility", p.visibility);
  if (p.image) {
    imagePreview.innerHTML = `<img src="${p.image}" alt="img" />`;
    uploadedImagePath = p.image;
  } else {
    imagePreview.innerHTML = "";
    uploadedImagePath = "";
  }
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
  if (uploadedImagePath) obj.image = uploadedImagePath;
  return obj;
}

function diffObjects(original = {}, current = {}) {
  const out = {};
  const keys = new Set([...Object.keys(original), ...Object.keys(current)]);
  keys.forEach((k) => {
    const a = original[k];
    const b = current[k];
    const A = a == null ? "" : String(a);
    const B = b == null ? "" : String(b);
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
    imagePreview.innerHTML = "";
    uploadedImagePath = "";
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
    imagePreview.innerHTML = "";
    uploadedImagePath = "";
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

if (footerForm) {
  footerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const parseNav = (txt) =>
      txt
        .split(/\n+/)
        .map((l) => {
          const [text, url] = l.split('|').map((s) => s.trim());
          return text && url ? { text, url } : null;
        })
        .filter(Boolean);
    const payload = {
      version: 1,
      identity: {
        brand_name: footerForm.brand_name.value.trim(),
        logo_variant: footerForm.logo_variant.value,
        tagline: footerForm.tagline.value.trim(),
      },
      navigation: [
        parseNav(footerForm.nav1.value),
        parseNav(footerForm.nav2.value),
        parseNav(footerForm.nav3.value),
      ],
      contact: {
        whatsapp_number: footerForm.whatsapp_number.value.trim(),
        email: footerForm.email.value.trim(),
        address: footerForm.address.value.trim(),
        opening_hours: footerForm.opening_hours.value.trim(),
      },
      cta: {
        enabled: footerForm.cta_enabled.checked,
        prompt: footerForm.cta_prompt.value.trim(),
        button_text: footerForm.cta_button_text.value.trim(),
        cta_link: footerForm.cta_link.value.trim(),
      },
      legal: {
        company_name: footerForm.company_name.value.trim(),
        cuit: footerForm.cuit.value.trim(),
        terms: footerForm.terms.value.trim(),
        privacy: footerForm.privacy.value.trim(),
      },
      appearance: {
        theme: footerForm.theme.value,
        accent: footerForm.accent.value.trim(),
      },
    };
    try {
      const resp = await fetch('/api/admin/footer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        alert('Footer actualizado');
        loadFooter();
      } else {
        const data = await resp.json().catch(() => ({}));
        alert(data.error || 'Error al guardar');
      }
    } catch (err) {
      console.error(err);
      alert('Error de red');
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
const ordersTableBody = document.querySelector("#ordersTable tbody");
const orderStatusFilter = document.getElementById("orderStatusFilter");
if (orderStatusFilter) {
  orderStatusFilter.addEventListener("change", () => {
    loadOrders();
  });
}

async function loadOrders() {
  try {
    const res = await fetch("/api/orders");
    const data = await res.json();
    ordersTableBody.innerHTML = "";
    const filter = document.getElementById("orderStatusFilter");
    const statusFilter = filter ? filter.value : "todos";
    data.orders
      .filter((o) =>
        statusFilter === "todos" ? true : o.payment_status === statusFilter,
      )
      .forEach(async (order) => {
        const tr = document.createElement("tr");
        // Resumen de items
        const itemsText = (order.productos || order.items || [])
          .map((it) => `${it.name} x${it.quantity}`)
          .join(", ");
        const cliente = order.cliente || {};
        const direccion = cliente.direccion || {};
        const dirText = direccion.calle
          ? `${direccion.calle} ${direccion.numero || ""}, ${direccion.localidad || ""}, ${
              direccion.provincia || ""
            } ${direccion.cp || ""}`
          : order.address || "";
        // Crear celdas manualmente para añadir listeners
        const idTd = document.createElement("td");
        idTd.textContent = order.order_number;
        const dateTd = document.createElement("td");
        dateTd.textContent = new Date(order.created_at).toLocaleString("es-AR");
        const nameTd = document.createElement("td");
        nameTd.textContent = cliente.nombre || "";
        const phoneTd = document.createElement("td");
        phoneTd.textContent = cliente.telefono || "";
        const addressTd = document.createElement("td");
        addressTd.textContent = dirText;
        const provTd = document.createElement("td");
        provTd.textContent = order.provincia_envio || "";
        const costoTd = document.createElement("td");
        costoTd.textContent = `$${(order.costo_envio || 0).toLocaleString("es-AR")}`;
        const itemsTd = document.createElement("td");
        itemsTd.textContent = itemsText;
        const totalTd = document.createElement("td");
        totalTd.textContent = `$${order.total_amount.toLocaleString("es-AR")}`;
        const statusTd = document.createElement("td");
        const statusSelect = document.createElement("select");
        (window.MP_STATUS_VALUES || ["pendiente", "aprobado", "rechazado"]).forEach(
          (st) => {
            const opt = document.createElement("option");
            opt.value = st;
            opt.textContent = st;
            statusSelect.appendChild(opt);
          },
        );
        statusSelect.value = order.payment_status;
        statusTd.appendChild(statusSelect);
        const trackingTd = document.createElement("td");
        const trackingInput = document.createElement("input");
        trackingInput.type = "text";
        trackingInput.value = order.seguimiento || "";
        trackingInput.placeholder = "Nº";
        trackingTd.appendChild(trackingInput);
        const carrierTd = document.createElement("td");
        const carrierInput = document.createElement("input");
        carrierInput.type = "text";
        carrierInput.value = order.transportista || "";
        carrierInput.placeholder = "Empresa";
        carrierTd.appendChild(carrierInput);
        const envioTd = document.createElement("td");
        const envioSelect = document.createElement("select");
        ["pendiente", "en preparación", "enviado", "entregado"].forEach(
          (st) => {
            const opt = document.createElement("option");
            opt.value = st;
            opt.textContent = st;
            if (order.shipping_status === st) opt.selected = true;
            envioSelect.appendChild(opt);
          },
        );
        envioTd.appendChild(envioSelect);
        const invoiceTd = document.createElement("td");
        const invoiceStatus = document.createElement("span");
        invoiceStatus.className = "invoice-status";
        invoiceTd.appendChild(invoiceStatus);
        const invoiceBtn = document.createElement("button");
        invoiceBtn.className = "invoice-btn";
        invoiceTd.appendChild(invoiceBtn);
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".pdf,.xml";
        fileInput.style.display = "none";
        invoiceTd.appendChild(fileInput);
        const fileNameSpan = document.createElement("div");
        fileNameSpan.className = "invoice-name";
        invoiceTd.appendChild(fileNameSpan);
        const actionTd = document.createElement("td");
        const saveBtn = document.createElement("button");
        saveBtn.className = "save-order-btn";
        saveBtn.textContent = "Guardar";
        actionTd.appendChild(saveBtn);
        tr.appendChild(idTd);
        tr.appendChild(dateTd);
        tr.appendChild(nameTd);
        tr.appendChild(phoneTd);
        tr.appendChild(addressTd);
        tr.appendChild(provTd);
        tr.appendChild(costoTd);
        tr.appendChild(itemsTd);
        tr.appendChild(totalTd);
        tr.appendChild(statusTd);
        tr.appendChild(envioTd);
        tr.appendChild(trackingTd);
        tr.appendChild(carrierTd);
        tr.appendChild(invoiceTd);
        tr.appendChild(actionTd);
        // Listener para guardar cambios de estado y envío
        saveBtn.addEventListener("click", async () => {
          const newPago = statusSelect.value;
          const newEnvio = envioSelect.value;
          const trackingVal = trackingInput.value.trim();
          const carrierVal = carrierInput.value.trim();
          const resp = await fetch(`/api/orders/${order.order_number}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              estado_pago: newPago,
              payment_status: newPago,
              estado_envio: newEnvio,
              shipping_status: newEnvio,
              seguimiento: trackingVal,
              tracking_code: trackingVal,
              transportista: carrierVal,
              carrier: carrierVal,
            }),
          });
          if (resp.ok) {
            alert("Pedido actualizado");
            loadOrders();
          } else {
            alert("Error al actualizar el pedido");
          }
        });
        async function updateInvoiceUI() {
          try {
            const invRes = await fetch(
              `/api/invoice-files/${order.order_number}`,
            );
            if (invRes.ok) {
              const data = await invRes.json();
              invoiceBtn.textContent = "Ver factura";
              invoiceStatus.textContent = "Factura cargada";
              invoiceStatus.className = "invoice-status loaded";
              fileNameSpan.textContent = data.fileName;
              invoiceBtn.onclick = () => {
                window.open(data.url, "_blank");
              };
            } else {
              invoiceBtn.textContent = "Cargar factura";
              fileNameSpan.textContent = "";
              const pending = order.payment_status === "aprobado";
              invoiceStatus.textContent = pending ? "Pendiente" : "No emitida";
              invoiceStatus.className =
                "invoice-status " + (pending ? "pending" : "none");
              invoiceBtn.onclick = () => fileInput.click();
            }
          } catch (_) {
            invoiceBtn.textContent = "Cargar factura";
            invoiceStatus.textContent = "Pendiente";
            invoiceStatus.className = "invoice-status pending";
            invoiceBtn.onclick = () => fileInput.click();
          }
        }
        fileInput.addEventListener("change", () => {
          const file = fileInput.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = reader.result.split(",")[1];
            const resp = await fetch(
              `/api/invoice-files/${order.order_number}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fileName: file.name, data: base64 }),
              },
            );
            if (resp.ok) {
              await updateInvoiceUI();
            } else {
              alert("Error al subir factura");
            }
          };
          reader.readAsDataURL(file);
        });
        updateInvoiceUI();
        ordersTableBody.appendChild(tr);
      });
  } catch (err) {
    console.error(err);
    ordersTableBody.innerHTML =
      '<tr><td colspan="5">No se pudieron cargar los pedidos</td></tr>';
  }
}

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
const footerForm = document.getElementById("footerForm");

async function loadFooter() {
  if (!footerForm) return;
  try {
    const res = await fetch('/api/footer');
    const data = await res.json();
    footerForm.brand_name.value = data.identity.brand_name || '';
    footerForm.logo_variant.value = data.identity.logo_variant || 'light';
    footerForm.tagline.value = data.identity.tagline || '';
    footerForm.nav1.value = (data.navigation[0] || [])
      .map((l) => `${l.text}|${l.url}`)
      .join('\n');
    footerForm.nav2.value = (data.navigation[1] || [])
      .map((l) => `${l.text}|${l.url}`)
      .join('\n');
    footerForm.nav3.value = (data.navigation[2] || [])
      .map((l) => `${l.text}|${l.url}`)
      .join('\n');
    footerForm.whatsapp_number.value = data.contact.whatsapp_number || '';
    footerForm.email.value = data.contact.email || '';
    footerForm.address.value = data.contact.address || '';
    footerForm.opening_hours.value = data.contact.opening_hours || '';
    footerForm.cta_enabled.checked = !!data.cta.enabled;
    footerForm.cta_prompt.value = data.cta.prompt || '';
    footerForm.cta_button_text.value = data.cta.button_text || '';
    footerForm.cta_link.value = data.cta.cta_link || '';
    footerForm.company_name.value = data.legal.company_name || '';
    footerForm.cuit.value = data.legal.cuit || '';
    footerForm.terms.value = data.legal.terms || '';
    footerForm.privacy.value = data.legal.privacy || '';
    footerForm.theme.value = data.appearance.theme || 'light';
    footerForm.accent.value = data.appearance.accent || '';
  } catch (e) {
    console.error('footer load', e);
  }
}

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
