/*
 * Sección "Mi cuenta" renovada.
 * Muestra datos clave, pedidos, devoluciones y permite
 * editar perfil en un panel de cliente profesional.
 */

async function initAccount() {
  const email = localStorage.getItem("nerinUserEmail");
  const name = localStorage.getItem("nerinUserName");
  if (!email) {
    window.location.href = "/login.html";
    return;
  }

  const accountInfoDiv = document.getElementById("accountInfo");
  const loyaltyLevelDiv = document.getElementById("loyaltyLevel");
  const loyaltyProgress = document.getElementById("loyaltyProgress");
  const loyaltyMessage = document.getElementById("loyaltyMessage");
  const benefitsDiv = document.getElementById("benefitsList");
  const invoiceList = document.getElementById("invoiceList");
  const supportBtn = document.getElementById("supportBtn");

  let clientData = null;
  let orders = [];

  // Obtener datos del cliente y sus pedidos
  try {
    const [clientsRes, ordersRes] = await Promise.all([
      fetch("/api/clients"),
      fetch("/api/orders"),
    ]);
    if (clientsRes.ok) {
      const { clients } = await clientsRes.json();
      clientData = clients.find((c) => c.email === email) || null;
    }
    if (ordersRes.ok) {
      const data = await ordersRes.json();
      orders = data.orders.filter(
        (o) => o.customer && o.customer.email === email,
      );
    }
  } catch (err) {
    console.error(err);
  }

  // Panel principal con datos clave
  const lastLogin = localStorage.getItem("nerinLastLogin");
  let infoHtml = `<p><strong>Usuario:</strong> ${name || email}</p>`;
  if (clientData) {
    infoHtml += `<p><strong>Saldo actual:</strong> $${clientData.balance.toLocaleString(
      "es-AR",
    )} / Límite $${clientData.limit.toLocaleString("es-AR")}</p>`;
    if (clientData.city) {
      infoHtml += `<p><strong>Ubicación habitual:</strong> ${clientData.city}, ${
        clientData.country || ""
      }</p>`;
    }
  } else {
    infoHtml += "<p>No hay saldo registrado.</p>";
  }
  if (lastLogin) {
    infoHtml += `<p><strong>Último acceso:</strong> ${new Date(
      lastLogin,
    ).toLocaleString("es-AR")}</p>`;
  }
  accountInfoDiv.innerHTML = infoHtml;

  // Calcular estado de fidelización
  const totalSpent = orders.reduce((t, o) => t + (o.total || 0), 0);
  const orderCount = orders.length;
  let level = "Nuevo";
  let progress = 0;
  let nextMsg = "";
  if (orderCount >= 10 || totalSpent >= 500000) {
    level = "Mayorista";
    progress = 100;
    nextMsg = "¡Tienes el máximo nivel!";
  } else if (orderCount >= 3 || totalSpent >= 100000) {
    level = "Frecuente";
    progress = Math.min(100, (orderCount / 10) * 100);
    nextMsg = "Estás a 1 compra de subir a Mayorista";
  } else {
    progress = Math.min(100, (orderCount / 3) * 100);
    nextMsg = "Estás a 1 compra de desbloquear 5% OFF permanente";
  }
  loyaltyLevelDiv.textContent = level;
  loyaltyProgress.style.width = `${progress}%`;
  loyaltyMessage.textContent = nextMsg;

  // Beneficios activos (mostrar algo aunque no haya nada)
  if (level === "Nuevo" && orderCount === 0) {
    benefitsDiv.innerHTML = `No tenés beneficios activos por ahora.<br/>🟢 Con tu primera compra accedés a:<ul><li>Soporte técnico prioritario</li><li>Seguimiento personalizado por WhatsApp</li><li>Descuento en tu segunda compra</li></ul>`;
  } else {
    benefitsDiv.textContent = "Beneficios disponibles para tu nivel.";
  }

  renderOrders(orders, email, invoiceList);
  loadUserReturns(email);

  // Configurar botón de soporte con número desde la configuración global
  if (window.NERIN_CONFIG && window.NERIN_CONFIG.whatsappNumber) {
    const phone = window.NERIN_CONFIG.whatsappNumber.replace(/[^0-9]/g, "");
    supportBtn.href = `https://wa.me/${phone}`;
  } else {
    supportBtn.href = "https://wa.me/541112345678";
  }

  // Prefil de formulario de perfil
  if (clientData) {
    document.getElementById("pName").value = clientData.name || "";
    document.getElementById("pEmail").value = clientData.email || "";
    document.getElementById("pPhone").value = clientData.phone || "";
    document.getElementById("pAddress").value = clientData.address || "";
    document.getElementById("pCUIT").value = clientData.cuit || "";
  } else {
    document.getElementById("pEmail").value = email;
  }

  document
    .getElementById("profileForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const update = {
        name: document.getElementById("pName").value,
        phone: document.getElementById("pPhone").value,
        address: document.getElementById("pAddress").value,
        cuit: document.getElementById("pCUIT").value,
      };
      try {
        const res = await fetch(`/api/clients/${encodeURIComponent(email)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });
        if (res.ok) alert("Perfil actualizado");
        else alert("No se pudo guardar el perfil");
      } catch (err) {
        alert("Error al actualizar perfil");
      }
    });

  // Métricas personales
  const metricsDiv = document.getElementById("metricsInfo");
  if (orders.length) {
    const highest = orders.reduce((m, o) => (o.total > m ? o.total : m), 0);
    metricsDiv.textContent = `Compra más cara: $${highest.toLocaleString(
      "es-AR",
    )}. Total de pedidos: ${orderCount}`;
  } else {
    metricsDiv.textContent = "Sin métricas todavía.";
  }
}

function addItemsToCart(items) {
  const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
  items.forEach((it) => {
    const existing = cart.find((c) => c.id === it.id);
    if (existing) existing.quantity += it.quantity;
    else
      cart.push({
        id: it.id,
        name: it.name,
        price: it.price,
        quantity: it.quantity,
      });
  });
  localStorage.setItem("nerinCart", JSON.stringify(cart));
  if (window.updateNav) window.updateNav();
}

async function renderOrders(orders, email, invoiceList) {
  const tbody = document.querySelector("#userOrdersTable tbody");
  tbody.innerHTML = "";
  invoiceList.innerHTML = "";
  if (orders.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8">No tienes pedidos registrados.</td></tr>';
    return;
  }
  for (const order of orders) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${order.id}</td>
      <td>${new Date(order.fecha).toLocaleString("es-AR")}</td>
      <td>${(order.productos || [])
        .map((it) => `${it.name} x${it.quantity}`)
        .join(", ")}</td>
      <td><span class="status-badge status-${order.estado_envio}">${
        order.estado_envio
      }</span></td>
      <td>${order.transportista || ""}</td>
      <td>$${order.total.toLocaleString("es-AR")}</td>
      <td><button class="invoice-btn">Factura</button></td>
      <td></td>`;
    const actionsTd = tr.lastElementChild;
    const invoiceBtn = tr.querySelector(".invoice-btn");
    invoiceBtn.addEventListener("click", async () => {
      try {
        const resp = await fetch(`/api/invoices/${order.id}`, {
          method: "POST",
        });
        if (resp.ok) {
          window.open(`/invoice.html?orderId=${order.id}`, "_blank");
        } else {
          const errData = await resp.json().catch(() => ({}));
          alert(errData.error || "Error al obtener factura");
        }
      } catch (_) {
        alert("Error al abrir factura");
      }
    });
    // Verificar si existe factura para listar en Archivos
    try {
      const resp = await fetch(`/api/invoices/${order.id}`);
      if (resp.ok) {
        invoiceBtn.textContent = "Ver factura";
        const { invoice } = await resp.json();
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = `/invoice.html?orderId=${order.id}`;
        link.textContent = `Factura ${invoice.id}`;
        link.target = "_blank";
        li.appendChild(link);
        invoiceList.appendChild(li);
      }
    } catch (_) {
      /* ignore */
    }

    if (order.tracking) {
      const trackBtn = document.createElement("button");
      trackBtn.textContent = "Ver seguimiento";
      trackBtn.addEventListener("click", () => {
        window.open(order.tracking, "_blank");
      });
      actionsTd.appendChild(trackBtn);
    }
    const repeatBtn = document.createElement("button");
    repeatBtn.textContent = "Repetir pedido";
    repeatBtn.addEventListener("click", () => {
      addItemsToCart(order.items);
      repeatBtn.textContent = "Añadido";
      setTimeout(() => (repeatBtn.textContent = "Repetir pedido"), 1500);
    });
    actionsTd.appendChild(repeatBtn);
    tbody.appendChild(tr);
  }
}

async function loadUserReturns(email) {
  const returnsTbody = document.querySelector("#userReturnsTable tbody");
  returnsTbody.innerHTML = "";
  try {
    const res = await fetch(`/api/returns?email=${encodeURIComponent(email)}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const returns = data.returns || [];
    if (returns.length === 0) {
      returnsTbody.innerHTML =
        '<tr><td colspan="6">No tienes devoluciones.</td></tr>';
      return;
    }
    returns.forEach((ret) => {
      const tr = document.createElement("tr");
      const reasonClass = ret.reason.toLowerCase().includes("falla")
        ? "reason-fallado"
        : "reason-error";
      tr.innerHTML = `
        <td>${ret.id}</td>
        <td>${ret.orderId}</td>
        <td>${new Date(ret.date).toLocaleString("es-AR")}</td>
        <td class="${reasonClass}">${ret.reason}</td>
        <td>${ret.status}</td>
        <td><button class="detail-btn">Ver detalles</button></td>`;
      tr.querySelector(".detail-btn").addEventListener("click", () => {
        alert(`Motivo: ${ret.reason}\nEstado: ${ret.status}`);
      });
      returnsTbody.appendChild(tr);
    });
  } catch (err) {
    returnsTbody.innerHTML =
      '<tr><td colspan="6">No se pudieron cargar tus devoluciones.</td></tr>';
  }
}

document.addEventListener("DOMContentLoaded", initAccount);
