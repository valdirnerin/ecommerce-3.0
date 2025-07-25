/*
 * Lógica del panel de administración de NERIN.
 *
 * Este módulo gestiona la navegación entre secciones (productos, pedidos,
 * clientes y métricas), solicita datos al backend y permite
 * crear/editar/eliminar productos y actualizar estados de pedidos.
 */

import { getUserRole, logout } from "./api.js";

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
    }
  });
});

// ------------ Productos ------------
const productsTableBody = document.querySelector("#productsTable tbody");
const addProductForm = document.getElementById("addProductForm");

async function loadProducts() {
  try {
    const res = await fetch("/api/products");
    const data = await res.json();
    productsTableBody.innerHTML = "";
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
        <td>${product.stock}</td>
        <td>${product.min_stock ?? ""}</td>
        <td>$${product.price_minorista.toLocaleString("es-AR")}</td>
        <td>$${product.price_mayorista.toLocaleString("es-AR")}</td>
        <td>
          <button class="edit-btn">Editar</button>
          <button class="delete-btn">Eliminar</button>
        </td>
      `;
      // Editar
      tr.querySelector(".edit-btn").addEventListener("click", async () => {
        const name = prompt("Nombre", product.name);
        if (name === null) return;
        const brand = prompt("Marca", product.brand);
        if (brand === null) return;
        const model = prompt("Modelo", product.model);
        if (model === null) return;
        const stock = prompt("Stock", product.stock);
        if (stock === null) return;
        const minStock = prompt("Mín. stock", product.min_stock ?? 5);
        if (minStock === null) return;
        const priceMinor = prompt("Precio minorista", product.price_minorista);
        if (priceMinor === null) return;
        const priceMajor = prompt("Precio mayorista", product.price_mayorista);
        if (priceMajor === null) return;
        // Campos adicionales
        const description = prompt("Descripción", product.description || "");
        if (description === null) return;
        const category = prompt("Categoría", product.category || "");
        if (category === null) return;
        const weight = prompt(
          "Peso (g)",
          product.weight != null ? product.weight : "",
        );
        if (weight === null) return;
        const dimensions = prompt("Dimensiones", product.dimensions || "");
        if (dimensions === null) return;
        const color = prompt("Color", product.color || "");
        if (color === null) return;
        const vipChoice = confirm(
          "¿Marcar como exclusivo VIP?\nAceptar = Sí, Cancelar = No",
        );
        const image = prompt("Ruta de imagen", product.image);
        if (image === null) return;
        const update = {
          name,
          brand,
          model,
          stock: parseInt(stock, 10),
          min_stock: parseInt(minStock, 10),
          price_minorista: parseInt(priceMinor, 10),
          price_mayorista: parseInt(priceMajor, 10),
          description: description.trim(),
          category: category.trim() || undefined,
          weight: weight !== "" ? parseFloat(weight) : undefined,
          dimensions: dimensions.trim() || undefined,
          color: color.trim() || undefined,
          vip_only: vipChoice,
          image,
        };
        const resp = await fetch(`/api/products/${product.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });
        if (resp.ok) {
          alert("Producto actualizado");
          loadProducts();
        } else {
          alert("Error al actualizar");
        }
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
      '<tr><td colspan="9">No se pudieron cargar los productos</td></tr>';
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
    weight: (function () {
      const wVal = document.getElementById("newWeight").value;
      return wVal !== "" ? parseFloat(wVal) : undefined;
    })(),
    dimensions:
      document.getElementById("newDimensions").value.trim() || undefined,
    color: document.getElementById("newColor").value.trim() || undefined,
    vip_only: document.getElementById("newVipOnly").checked,
    image: document.getElementById("newImage").value.trim(),
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
  try {
    const res = await fetch("/api/analytics/detailed");
    const data = await res.json();
    const container = document.getElementById("analyticsContent");
    container.innerHTML = "";
    const {
      salesByCategory,
      salesByProduct,
      returnsByProduct,
      topCustomers,
      monthlySales,
      averageOrderValue,
      returnRate,
      mostReturnedProduct,
    } = data.analytics;

    /**
     * Helper para construir un gráfico de barras horizontal.
     * Recibe un objeto donde las claves son etiquetas y los valores números.
     * Genera un fragmento HTML con barras proporcionales al valor máximo.
     */
    function buildBarChart(title, dataObj, valueSuffix = "") {
      const wrapper = document.createElement("div");
      const h4 = document.createElement("h4");
      h4.textContent = title;
      wrapper.appendChild(h4);
      const barChart = document.createElement("div");
      barChart.className = "bar-chart";
      const values = Object.values(dataObj);
      const maxVal = values.length ? Math.max(...values) : 0;
      Object.entries(dataObj).forEach(([label, val]) => {
        const width = maxVal > 0 ? ((val / maxVal) * 100).toFixed(2) : 0;
        const row = document.createElement("div");
        row.className = "bar-row";
        const spanLabel = document.createElement("span");
        spanLabel.className = "bar-label";
        spanLabel.textContent = label;
        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.width = `${width}%`;
        const spanVal = document.createElement("span");
        spanVal.className = "bar-value";
        // Formatear valores numéricos
        spanVal.textContent =
          valueSuffix === "u."
            ? `${val} ${valueSuffix}`
            : `$${val.toLocaleString("es-AR")}${valueSuffix}`;
        row.appendChild(spanLabel);
        row.appendChild(bar);
        row.appendChild(spanVal);
        barChart.appendChild(row);
      });
      wrapper.appendChild(barChart);
      return wrapper;
    }
    // Construir y agregar gráficos
    // Ventas por categoría (valores monetarios)
    container.appendChild(
      buildBarChart("Ventas por categoría", salesByCategory, ""),
    );
    // Unidades vendidas por producto (cantidades)
    container.appendChild(
      buildBarChart("Unidades vendidas por producto", salesByProduct, " u."),
    );
    // Devoluciones por producto (cantidades)
    container.appendChild(
      buildBarChart("Devoluciones por producto", returnsByProduct, " u."),
    );
    // Clientes con mayor facturación (valores monetarios)
    // Convertir topCustomers en un objeto { email: total }
    const clientTotals = {};
    topCustomers.forEach((c) => {
      clientTotals[c.email] = c.total;
    });
    container.appendChild(
      buildBarChart("Clientes con mayor facturación", clientTotals, ""),
    );

    // Ventas por mes (valores monetarios)
    container.appendChild(
      buildBarChart("Ventas por mes", monthlySales, ""),
    );

    // Estadísticas adicionales
    const stats = document.createElement("div");
    stats.className = "analytics-stats";
    const pAvg = document.createElement("p");
    pAvg.textContent = `Valor medio de pedido: $${averageOrderValue.toFixed(2)}`;
    const pRate = document.createElement("p");
    pRate.textContent = `Tasa de devoluciones: ${(returnRate * 100).toFixed(2)}%`;
    const pMost = document.createElement("p");
    pMost.textContent = `Producto más devuelto: ${mostReturnedProduct || "N/A"}`;
    stats.appendChild(pAvg);
    stats.appendChild(pRate);
    stats.appendChild(pMost);
    container.appendChild(stats);
  } catch (err) {
    console.error(err);
    const container = document.getElementById("analyticsContent");
    container.innerHTML = "<p>No se pudieron cargar las analíticas</p>";
  }
}

// ------------ Pedidos ------------
const ordersTableBody = document.querySelector("#ordersTable tbody");

async function loadOrders() {
  try {
    const res = await fetch("/api/orders");
    const data = await res.json();
    ordersTableBody.innerHTML = "";
    data.orders.forEach(async (order) => {
      const tr = document.createElement("tr");
      // Resumen de items
      const itemsText = order.items
        .map((it) => `${it.name} x${it.quantity}`)
        .join(", ");
      // Crear celdas manualmente para añadir listeners
      const idTd = document.createElement("td");
      idTd.textContent = order.id;
      const dateTd = document.createElement("td");
      dateTd.textContent = new Date(order.date).toLocaleString("es-AR");
      const itemsTd = document.createElement("td");
      itemsTd.textContent = itemsText;
      const statusTd = document.createElement("td");
      const statusSelect = document.createElement("select");
      ["pendiente", "pagado", "en preparación", "enviado", "entregado"].forEach(
        (st) => {
          const opt = document.createElement("option");
          opt.value = st;
          opt.textContent = st;
          if (order.status === st) opt.selected = true;
          statusSelect.appendChild(opt);
        },
      );
      statusTd.appendChild(statusSelect);
      const trackingTd = document.createElement("td");
      const trackingInput = document.createElement("input");
      trackingInput.type = "text";
      trackingInput.value = order.tracking || "";
      trackingInput.placeholder = "Nº";
      trackingTd.appendChild(trackingInput);
      const carrierTd = document.createElement("td");
      const carrierInput = document.createElement("input");
      carrierInput.type = "text";
      carrierInput.value = order.carrier || "";
      carrierInput.placeholder = "Empresa";
      carrierTd.appendChild(carrierInput);
      const invoiceTd = document.createElement("td");
      const invoiceBtn = document.createElement("button");
      invoiceBtn.className = "invoice-btn";
      invoiceBtn.textContent = "Factura";
      invoiceTd.appendChild(invoiceBtn);
      const actionTd = document.createElement("td");
      const saveBtn = document.createElement("button");
      saveBtn.className = "save-order-btn";
      saveBtn.textContent = "Guardar";
      actionTd.appendChild(saveBtn);
      tr.appendChild(idTd);
      tr.appendChild(dateTd);
      tr.appendChild(itemsTd);
      tr.appendChild(statusTd);
      tr.appendChild(trackingTd);
      tr.appendChild(carrierTd);
      tr.appendChild(invoiceTd);
      tr.appendChild(actionTd);
      // Listener para guardar cambios de estado y envío
      saveBtn.addEventListener("click", async () => {
        const newStatus = statusSelect.value;
        const trackingVal = trackingInput.value.trim();
        const carrierVal = carrierInput.value.trim();
        const resp = await fetch(`/api/orders/${order.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: newStatus,
            tracking: trackingVal,
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
      // Listener para factura (crea o abre)
      invoiceBtn.addEventListener("click", async () => {
        try {
          const resp = await fetch(`/api/invoices/${order.id}`, {
            method: "POST",
          });
          if (resp.ok) {
            window.open(`/invoice.html?orderId=${order.id}`, "_blank");
          } else {
            const dataErr = await resp.json().catch(() => ({}));
            alert(dataErr.error || "Error generando factura");
          }
        } catch (err) {
          alert("Error al generar factura");
        }
      });
      // Establecer texto de botón según existencia de factura
      try {
        const invRes = await fetch(`/api/invoices/${order.id}`);
        if (invRes.ok) {
          invoiceBtn.textContent = "Ver factura";
        } else {
          invoiceBtn.textContent = "Generar factura";
        }
      } catch (e) {
        invoiceBtn.textContent = "Factura";
      }
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

async function loadMetrics() {
  try {
    const res = await fetch("/api/metrics");
    const data = await res.json();
    const m = data.metrics;
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
    html += '<canvas id="salesChartCanvas" height="180"></canvas>';
    // Productos más vendidos (gráfico de barras)
    html += "<h4>Productos más vendidos</h4>";
    html += '<div class="bar-chart">';
    const prodQtys = m.topProducts.map((p) => p.quantity);
    const maxQty = prodQtys.length ? Math.max(...prodQtys) : 0;
    m.topProducts.forEach((p) => {
      const width = maxQty > 0 ? ((p.quantity / maxQty) * 100).toFixed(2) : 0;
      html += `<div class="bar-row"><span class="bar-label">${p.name}</span><div class="bar" style="width:${width}%"></div><span class="bar-value">${p.quantity} u.</span></div>`;
    });
    html += "</div>";
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
  } catch (err) {
    console.error(err);
    metricsContent.textContent = "No se pudieron cargar las métricas.";
  }
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

// Cargar productos inicialmente
loadProducts();
