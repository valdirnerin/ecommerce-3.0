/*
 * Lógica del panel de administración de NERIN.
 *
 * Este módulo gestiona la navegación entre secciones (productos, pedidos,
 * clientes y métricas), solicita datos al backend y permite
 * crear/editar/eliminar productos y actualizar estados de pedidos.
 */

import {
  getUserRole,
  logout,
  getProducts,
  getOrders,
  getClients,
  getSuppliers,
  createSupplier,
  getShippingTable,
  saveShippingTable,
} from "./api.js";
import { renderAnalyticsDashboard } from "./analytics.js";
import { formatCurrencyARS } from "./dataAdapters.js";

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
const productsTableBody = document.querySelector("#productsTable tbody");
const addProductForm = document.getElementById("addProductForm");
const newImageInput = document.getElementById("newImage");
const imagePreview = document.getElementById("imagePreview");
let uploadedImagePath = "";
let editingRow = null;

newImageInput.addEventListener("change", async () => {
  const file = newImageInput.files[0];
  imagePreview.innerHTML = "";
  uploadedImagePath = "";
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    alert("La imagen supera 5MB");
    newImageInput.value = "";
    return;
  }
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    alert("Formato no permitido. Usa JPG o PNG");
    newImageInput.value = "";
    return;
  }
  const sku = document.getElementById("newSku").value.trim();
  if (!sku) {
    alert("Completá el SKU antes de subir la imagen");
    newImageInput.value = "";
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
      newImageInput.value = "";
    }
  } catch (err) {
    console.error(err);
    alert("Error al subir imagen");
    newImageInput.value = "";
  }
});

async function loadProducts() {
  try {
    const res = await fetch("/api/products");
    const data = await res.json();
    productsTableBody.innerHTML = "";
    if (data.products.length === 0) {
      productsTableBody.innerHTML =
        '<tr><td colspan="13">No hay productos</td></tr>';
      return;
    }
    data.products.forEach((product) => {
      const tr = document.createElement("tr");
      // Resaltar si el stock está por debajo del mínimo configurado
      if (
        product.min_stock !== undefined &&
        product.stock < product.min_stock
      ) {
        tr.classList.add("low-stock");
      }
      tr.innerHTML = `
        <td>${product.id}</td>
        <td>${product.sku}</td>
        <td>${product.name}</td>
        <td>${product.brand}</td>
        <td>${product.model}</td>
        <td>${product.category || ""}</td>
        <td>${product.subcategory || ""}</td>
        <td>${(product.tags || []).join(", ")}</td>
        <td>${product.stock}</td>
        <td>${product.min_stock ?? ""}</td>
        <td>${
          Number(product.price_minorista) > 0
            ? formatCurrencyARS(product.price_minorista)
            : "—"
        }</td>
        <td>${
          Number(product.price_mayorista) > 0
            ? formatCurrencyARS(product.price_mayorista)
            : "—"
        }</td>
        <td>
          <button class="edit-btn">Editar</button>
          <button class="delete-btn">Eliminar</button>
        </td>
      `;
      // Editar
      tr.querySelector(".edit-btn").addEventListener("click", () => {
        if (editingRow) return;
        editingRow = tr;
        tr.classList.add("editing");
        const cells = tr.querySelectorAll("td");
        cells[2].innerHTML = `<input type="text" value="${product.name}" />`;
        cells[3].innerHTML = `<input type="text" value="${product.brand}" />`;
        cells[4].innerHTML = `<input type="text" value="${product.model}" />`;
        cells[8].innerHTML = `<input type="number" min="0" value="${product.stock}" />`;
        cells[10].innerHTML = `<input type="number" min="0" value="${product.price_minorista}" />`;
        cells[11].innerHTML = `<input type="number" min="0" value="${product.price_mayorista}" />`;
        cells[12].innerHTML = `
          <button class="save-btn">Guardar</button>
          <button class="cancel-btn">Cancelar</button>
        `;
        cells[12]
          .querySelector(".save-btn")
          .addEventListener("click", async () => {
            const inputs = tr.querySelectorAll("input");
            const update = {
              name: inputs[0].value.trim(),
              brand: inputs[1].value.trim(),
              model: inputs[2].value.trim(),
              stock: parseInt(inputs[3].value, 10),
              price_minorista: parseFloat(inputs[4].value),
              price_mayorista: parseFloat(inputs[5].value),
            };
            const resp = await fetch(`/api/products/${product.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(update),
            });
            if (resp.ok) {
              editingRow = null;
              loadProducts();
            } else {
              alert("Error al actualizar");
            }
          });
        cells[12].querySelector(".cancel-btn").addEventListener("click", () => {
          editingRow = null;
          loadProducts();
        });
      });
      // Eliminar
      tr.querySelector(".delete-btn").addEventListener("click", async () => {
        if (!confirm("¿Estás seguro de eliminar este producto?")) return;
        const resp = await fetch(`/api/products/${product.id}`, {
          method: "DELETE",
        });
        if (resp.ok) {
          alert("Producto eliminado");
          loadProducts();
        } else {
          alert("Error al eliminar");
        }
      });
      productsTableBody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    productsTableBody.innerHTML =
      '<tr><td colspan="13">No se pudieron cargar los productos</td></tr>';
  }
}

// Manejar adición de nuevos productos
addProductForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const newProd = {
    sku: document.getElementById("newSku").value.trim(),
    name: document.getElementById("newName").value.trim(),
    brand: document.getElementById("newBrand").value.trim(),
    model: document.getElementById("newModel").value.trim(),
    stock: parseInt(document.getElementById("newStock").value, 10),
    min_stock: parseInt(document.getElementById("newMinStock").value, 10),
    price_minorista: parseInt(
      document.getElementById("newPriceMinor").value,
      10,
    ),
    price_mayorista: parseInt(
      document.getElementById("newPriceMajor").value,
      10,
    ),
    description: document.getElementById("newDescription").value.trim(),
    category: document.getElementById("newCategory").value.trim() || undefined,
    subcategory:
      document.getElementById("newSubcategory").value.trim() || undefined,
    tags: document
      .getElementById("newTags")
      .value.split(",")
      .map((t) => t.trim())
      .filter((t) => t),
    slug: document.getElementById("newSlug").value.trim(),
    meta_title:
      document.getElementById("newMetaTitle").value.trim() || undefined,
    meta_description:
      document.getElementById("newMetaDesc").value.trim() || undefined,
    visibility: document.getElementById("newVisibility").value,
    featured: document.getElementById("newFeatured").checked,
    weight: (function () {
      const wVal = document.getElementById("newWeight").value;
      return wVal !== "" ? parseFloat(wVal) : undefined;
    })(),
    dimensions:
      document.getElementById("newDimensions").value.trim() || undefined,
    color: document.getElementById("newColor").value.trim() || undefined,
    vip_only: false,
    image: uploadedImagePath,
  };
  try {
    const resp = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newProd),
    });
    if (resp.ok) {
      alert("Producto agregado");
      addProductForm.reset();
      imagePreview.innerHTML = "";
      uploadedImagePath = "";
      loadProducts();
    } else {
      alert("Error al agregar producto");
    }
  } catch (err) {
    console.error(err);
    alert("Error de red");
  }
});

// ------------ Proveedores ------------
const suppliersTableBody = document.querySelector("#suppliersTable tbody");
const addSupplierForm = document.getElementById("addSupplierForm");

async function loadSuppliers() {
  try {
    const suppliers = await getSuppliers();
    suppliersTableBody.innerHTML = "";
    suppliers.forEach((sup) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${sup.id}</td>
        <td>${sup.name}</td>
        <td>${sup.contact || "—"}</td>
        <td>${sup.email || "—"}</td>
        <td>${sup.phone || "—"}</td>
        <td>${sup.address || "—"}</td>
        <td>${sup.payment_terms || "—"}</td>
        <td>${sup.rating ?? "—"}</td>
      `;
      suppliersTableBody.appendChild(tr);
    });
    populateSupplierSelect(suppliers);
  } catch (err) {
    console.error(err);
    suppliersTableBody.innerHTML =
      '<tr><td colspan="8">No se pudieron cargar los proveedores</td></tr>';
  }
}

if (addSupplierForm) {
  addSupplierForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      name: document.getElementById("supName").value.trim(),
      contact: document.getElementById("supContact").value.trim(),
      email: document.getElementById("supEmail").value.trim(),
      phone: document.getElementById("supPhone").value.trim(),
      address: document.getElementById("supAddress").value.trim(),
      payment_terms: document.getElementById("supTerms").value.trim(),
      rating: parseFloat(document.getElementById("supRating").value) || 0,
    };
    try {
      await createSupplier(body);
      addSupplierForm.reset();
      loadSuppliers();
    } catch (err) {
      console.error(err);
      if (window.showToast) window.showToast("Error al agregar proveedor");
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
        <td>${po.date ? new Date(po.date).toLocaleString('es-AR') : '—'}</td>
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
          : "";
        // Crear celdas manualmente para añadir listeners
        const idTd = document.createElement("td");
        idTd.textContent = order.order_number;
        const dateTd = document.createElement("td");
        dateTd.textContent = order.created_at
          ? new Date(order.created_at).toLocaleString('es-AR')
          : '—';
        const nameTd = document.createElement("td");
        nameTd.textContent = cliente.nombre || "";
        const phoneTd = document.createElement("td");
        phoneTd.textContent = cliente.telefono || "";
        const addressTd = document.createElement("td");
        addressTd.textContent = dirText;
        const provTd = document.createElement("td");
        provTd.textContent = order.provincia_envio || "";
        const costoTd = document.createElement("td");
        costoTd.textContent = formatCurrencyARS(order.costo_envio || 0);
        const itemsTd = document.createElement("td");
        itemsTd.textContent = itemsText;
        const totalTd = document.createElement("td");
        totalTd.textContent = formatCurrencyARS(order.total_amount);
        const statusTd = document.createElement("td");
        const statusSelect = document.createElement("select");
        ["pendiente", "en proceso", "pagado", "rechazado"].forEach((st) => {
          const opt = document.createElement("option");
          opt.value = st;
          opt.textContent = st;
          statusSelect.appendChild(opt);
        });
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
              const pending = order.payment_status === "pagado";
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
      balanceTd.textContent = formatCurrencyARS(client.balance);
      const limitTd = document.createElement("td");
      limitTd.textContent = formatCurrencyARS(client.limit);
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
  html += `<p>Total de ventas (neto): ${formatCurrencyARS(totalAnnual)}</p>`;
  html += `<p>IVA (21%): ${formatCurrencyARS(iva)}</p>`;
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
            label: (ctx) => formatCurrencyARS(ctx.parsed.y),
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
        <td>${ret.date ? new Date(ret.date).toLocaleString('es-AR') : '—'}</td>
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
    const rows = await getShippingTable();
    shippingTableBody.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const provTd = document.createElement("td");
      provTd.textContent = row.province || row.provincia;
      const costTd = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.value = row.cost ?? row.costo ?? 0;
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
    const list = [];
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
      list.push({ province: provincia, cost: val });
    });
    if (!valid) {
      shippingAlert.textContent = "Ingresa valores válidos";
      shippingAlert.style.display = "block";
      return;
    }
    try {
      await saveShippingTable(list);
      shippingAlert.textContent = "Cambios guardados";
      shippingAlert.style.color = "green";
      shippingAlert.style.display = "block";
    } catch (err) {
      console.error(err);
      shippingAlert.textContent = "Error al guardar";
      shippingAlert.style.color = "";
      shippingAlert.style.display = "block";
    }
  });
}

// Cargar productos inicialmente
loadProducts();
