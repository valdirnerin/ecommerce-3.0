import { apiFetch } from "./api.js";

const TOAST_STYLES = {
  success: "linear-gradient(135deg,#10b981,#22c55e)",
  info: "linear-gradient(135deg,#3b82f6,#6366f1)",
  warning: "linear-gradient(135deg,#f97316,#ea580c)",
  danger: "linear-gradient(135deg,#ef4444,#dc2626)",
};

function showToast(message, type = "info") {
  if (window.Toastify) {
    window.Toastify({
      text: message,
      duration: 3200,
      close: true,
      gravity: "top",
      position: "center",
      style: { background: TOAST_STYLES[type] || TOAST_STYLES.info },
    }).showToast();
  } else {
    console.log(message);
  }
}

function formatCurrency(value) {
  const number = Number(value || 0);
  return number.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDate(value, options = { day: "2-digit", month: "short", year: "numeric" }) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-AR", options);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFirstName(value, fallback) {
  if (value && typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed.split(/\s+/)[0];
  }
  return fallback;
}

function computeOrderDate(order) {
  return (
    order?.created_at ||
    order?.date ||
    order?.fecha ||
    order?.createdAt ||
    order?.updated_at ||
    order?.fecha_creacion ||
    null
  );
}

function getOrderNumber(order) {
  return (
    order?.order_number ||
    order?.id ||
    order?.external_reference ||
    order?.numero ||
    order?.orderId ||
    ""
  );
}

function getShippingStatus(order) {
  return (
    order?.shipping_status ||
    order?.envio_estado ||
    order?.status_envio ||
    order?.estado_envio ||
    order?.shippingStatus ||
    "pendiente"
  );
}

function toStatusCode(value) {
  return value?.toString?.().toLowerCase().replace(/[^a-z0-9-]/g, "-") || "pendiente";
}

function formatStatusLabel(value) {
  const code = toStatusCode(value);
  return code.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeOrderItems(order) {
  const rawItems = Array.isArray(order?.productos)
    ? order.productos
    : Array.isArray(order?.items)
    ? order.items
    : [];
  return rawItems
    .map((item) => {
      const id =
        item?.id ||
        item?.product_id ||
        item?.sku ||
        item?.code ||
        (item?.name ? item.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-") : null);
      return {
        id,
        name: item?.name || item?.product_name || item?.title || "Producto",
        quantity: Number(item?.quantity || item?.qty || item?.cantidad || 0) || 0,
        price: Number(item?.price || item?.unit_price || item?.precio || 0) || 0,
        image: item?.image || item?.image_url || item?.img || null,
      };
    })
    .filter((item) => item.quantity > 0);
}

function addItemsToCart(items) {
  if (!Array.isArray(items) || !items.length) {
    showToast("No encontramos productos para repetir el pedido.", "warning");
    return;
  }
  let cart = [];
  try {
    cart = JSON.parse(localStorage.getItem("nerinCart")) || [];
    if (!Array.isArray(cart)) cart = [];
  } catch (err) {
    cart = [];
  }
  const updatedCart = [...cart];
  items.forEach((item) => {
    if (!item?.id) return;
    const existing = updatedCart.find((cartItem) => cartItem.id === item.id);
    if (existing) {
      existing.quantity += item.quantity || 1;
    } else {
      updatedCart.push({
        id: item.id,
        name: item.name || "Producto",
        price: item.price || 0,
        quantity: item.quantity || 1,
        image: item.image || null,
      });
    }
  });
  localStorage.setItem("nerinCart", JSON.stringify(updatedCart));
  if (window.updateNav) window.updateNav();
  showToast("Añadimos los productos al carrito.", "success");
  if (window.showCartIndicator) window.showCartIndicator();
}

function determineMinorLoyalty(orderCount, totalSpent) {
  let level = "Nuevo";
  let progress = Math.min(100, (orderCount / 2) * 100);
  let message = "Realizá tu primera compra para desbloquear envíos bonificados.";
  let nextLabel = "Frecuente";

  if (orderCount >= 8 || totalSpent >= 280000) {
    level = "Mayorista invitado";
    progress = 100;
    message = "¡Felicitaciones! Podés solicitar beneficios mayoristas con tu ejecutivo.";
    nextLabel = null;
  } else if (orderCount >= 3 || totalSpent >= 120000) {
    level = "Frecuente";
    progress = Math.min(100, ((orderCount - 2) / 6) * 100);
    message = "Mantené tu ritmo de compras para acceder a promos exclusivas.";
    nextLabel = "Mayorista invitado";
  }

  progress = Math.max(0, Math.min(100, Math.round(progress)));

  return { level, progress, message, nextLabel };
}

async function renderOrders(orders, email) {
  const table = document.getElementById("ordersTable");
  const tbody = table?.querySelector("tbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (!Array.isArray(orders) || !orders.length) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td colspan="5">Todavía no registramos pedidos. ¡Empezá tu primera compra en la tienda!</td>';
    tbody.appendChild(tr);
    return;
  }

  orders
    .map((order) => ({
      raw: order,
      dateValue: computeOrderDate(order),
    }))
    .sort((a, b) => (Date.parse(b.dateValue || 0) || 0) - (Date.parse(a.dateValue || 0) || 0))
    .forEach(({ raw }) => {
      const tr = document.createElement("tr");
      const numero = getOrderNumber(raw);
      const fechaValor = computeOrderDate(raw);
      const fecha = fechaValor ? new Date(fechaValor) : null;
      const statusRaw = getShippingStatus(raw) || "pendiente";
      const statusCode = toStatusCode(statusRaw);
      const statusLabel = formatStatusLabel(statusRaw);
      const totalVal =
        raw?.total_amount || raw?.total || raw?.total_amount_before_discount || raw?.amount || 0;

      tr.innerHTML = `
        <td>${numero || "—"}</td>
        <td>${fecha ? formatDateTime(fecha) : "—"}</td>
        <td><span class="status-badge status-${statusCode}">${statusLabel}</span></td>
        <td>${formatCurrency(totalVal)}</td>
        <td class="order-actions">
          <button type="button" class="button secondary small" data-action="invoice">Factura</button>
          <button type="button" class="button ghost small" data-action="repeat">Repetir</button>
        </td>
      `;

      const actions = tr.querySelector(".order-actions");
      const invoiceBtn = actions?.querySelector('[data-action="invoice"]');
      const repeatBtn = actions?.querySelector('[data-action="repeat"]');

      if (invoiceBtn) {
        invoiceBtn.addEventListener("click", async () => {
          try {
            const oid = numero;
            if (!oid) {
              showToast("No pudimos encontrar el número de pedido.", "warning");
              return;
            }
            const resp = await apiFetch(`/api/invoices/${encodeURIComponent(oid)}`, {
              method: "POST",
            });
            if (resp.ok) {
              window.open(`/invoice.html?orderId=${encodeURIComponent(oid)}`, "_blank");
            } else {
              const err = await resp.json().catch(() => ({}));
              showToast(err.error || "No pudimos generar la factura.", "danger");
            }
          } catch (error) {
            showToast("Ocurrió un error al solicitar la factura.", "danger");
          }
        });
      }

      if (repeatBtn) {
        repeatBtn.addEventListener("click", () => {
          const items = normalizeOrderItems(raw);
          addItemsToCart(items);
        });
      }

      tbody.appendChild(tr);
    });
}

function updateQuickActions(handlers) {
  const buttons = document.querySelectorAll(".action-tile");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      const handler = handlers[action];
      if (typeof handler === "function") handler();
    });
  });
}

async function initMinorAccount() {
  const role = localStorage.getItem("nerinUserRole");
  if (role && role !== "minorista") {
    window.location.replace("/account.html");
    return;
  }

  const email = localStorage.getItem("nerinUserEmail");
  if (!email) {
    window.location.href = "/login.html";
    return;
  }

  const name = localStorage.getItem("nerinUserName") || email;
  const heroNameEl = document.getElementById("heroName");
  const heroLevelEl = document.getElementById("heroLevel");
  const heroOrdersEl = document.getElementById("heroOrders");
  const heroTotalEl = document.getElementById("heroTotal");
  const heroLastOrderEl = document.getElementById("heroLastOrder");
  const heroLastStatusEl = document.getElementById("heroLastStatus");

  const loyaltyBadge = document.getElementById("loyaltyBadge");
  const totalSpentEl = document.getElementById("totalSpent");
  const avgTicketEl = document.getElementById("avgTicket");
  const ordersCountEl = document.getElementById("ordersCount");
  const ordersFrequencyEl = document.getElementById("ordersFrequency");
  const nextDeliveryEl = document.getElementById("nextDelivery");
  const deliveryMetaEl = document.getElementById("deliveryMeta");
  const progressLabelEl = document.getElementById("progressLabel");
  const progressFillEl = document.getElementById("loyaltyProgress");
  const progressMessageEl = document.getElementById("progressMessage");
  const supportBtn = document.getElementById("supportBtn");

  if (heroNameEl) heroNameEl.textContent = getFirstName(name, "Cliente NERIN");

  let orders = [];
  let clientProfile = null;
  try {
    const res = await apiFetch(`/api/orders?email=${encodeURIComponent(email)}`);
    if (res.ok) {
      const data = await res.json();
      orders = Array.isArray(data?.orders) ? data.orders : [];
    }
  } catch (error) {
    console.error(error);
  }

  try {
    const clientRes = await apiFetch(`/api/clients/${encodeURIComponent(email)}`);
    if (clientRes.ok) {
      const payload = await clientRes.json();
      clientProfile = payload?.client || null;
      if (payload?.profile && typeof payload.profile === "object") {
        try {
          localStorage.setItem("nerinUserProfile", JSON.stringify(payload.profile));
        } catch (storageError) {
          console.warn("No se pudo sincronizar el perfil minorista", storageError);
        }
      }
      if (clientProfile?.name) {
        try {
          localStorage.setItem("nerinUserName", clientProfile.name);
        } catch (storageError) {
          console.warn("No se pudo actualizar el nombre minorista", storageError);
        }
      }
    }
  } catch (error) {
    console.error("minor account profile", error);
  }

  const displayName = getFirstName(
    (clientProfile && clientProfile.name) || name,
    "Cliente NERIN",
  );
  if (heroNameEl) heroNameEl.textContent = displayName;

  const totalSpent = orders.reduce((total, order) => {
    const value =
      order?.total_amount || order?.total || order?.total_amount_before_discount || order?.amount || 0;
    return total + Number(value);
  }, 0);
  const orderCount = orders.length;
  const avgTicket = orderCount ? totalSpent / orderCount : 0;

  const ordered = orders
    .map((order) => ({
      raw: order,
      date: (() => {
        const val = computeOrderDate(order);
        return val ? new Date(val) : null;
      })(),
      status: getShippingStatus(order),
    }))
    .sort((a, b) => (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0));

  const lastOrder = ordered[0] || null;
  const pendingOrder = ordered.find((entry) => {
    const status = toStatusCode(entry.status);
    return status && !["entregado", "cancelado", "devuelto"].includes(status);
  });

  const loyalty = determineMinorLoyalty(orderCount, totalSpent);

  if (heroLevelEl) heroLevelEl.textContent = `Nivel ${loyalty.level}`;
  if (heroOrdersEl) heroOrdersEl.textContent = orderCount.toString();
  if (heroTotalEl) heroTotalEl.textContent = `${formatCurrency(totalSpent)} acumulado`;
  if (heroLastOrderEl)
    heroLastOrderEl.textContent = lastOrder?.date ? formatDate(lastOrder.date) : "—";
  if (heroLastStatusEl)
    heroLastStatusEl.textContent = lastOrder
      ? `Estado: ${formatStatusLabel(getShippingStatus(lastOrder.raw))}`
      : "Sin envíos";

  if (loyaltyBadge) loyaltyBadge.textContent = loyalty.level;
  if (totalSpentEl) totalSpentEl.textContent = formatCurrency(totalSpent);
  if (avgTicketEl) avgTicketEl.textContent = `Ticket promedio ${formatCurrency(avgTicket)}`;
  if (ordersCountEl) ordersCountEl.textContent = orderCount.toString();
  if (ordersFrequencyEl) {
    if (!orderCount) {
      ordersFrequencyEl.textContent = "Tu próxima compra desbloquea beneficios.";
    } else if (orderCount === 1) {
      ordersFrequencyEl.textContent = "Tu primera compra ya está registrada.";
    } else {
      ordersFrequencyEl.textContent = `Realizaste ${orderCount} compras con nosotros.`;
    }
  }

  if (pendingOrder) {
    const estimated = pendingOrder.raw?.estimated_delivery || pendingOrder.raw?.deliveryDate;
    if (nextDeliveryEl) nextDeliveryEl.textContent = formatDate(estimated || pendingOrder.date);
    if (deliveryMetaEl)
      deliveryMetaEl.textContent = `Estado actual: ${formatStatusLabel(pendingOrder.status)}.`;
  } else if (lastOrder) {
    if (nextDeliveryEl) nextDeliveryEl.textContent = formatDate(lastOrder.date);
    if (deliveryMetaEl)
      deliveryMetaEl.textContent = "Tu última compra ya fue entregada. ¡Gracias por confiar en NERIN!";
  } else {
    if (nextDeliveryEl) nextDeliveryEl.textContent = "—";
    if (deliveryMetaEl) deliveryMetaEl.textContent = "Aún no hay envíos en curso.";
  }

  if (progressLabelEl) {
    progressLabelEl.textContent = loyalty.nextLabel
      ? `${loyalty.progress}% hacia nivel ${loyalty.nextLabel}`
      : "Nivel máximo alcanzado";
  }
  if (progressFillEl) progressFillEl.style.width = `${loyalty.progress}%`;
  if (progressMessageEl) progressMessageEl.textContent = loyalty.message;

  await renderOrders(orders, email);

  if (supportBtn) {
    const phone = window.NERIN_CONFIG?.whatsappNumber;
    if (phone) {
      const sanitized = phone.replace(/[^0-9]/g, "");
      supportBtn.href = `https://wa.me/${sanitized}`;
    } else {
      supportBtn.href = "https://wa.me/541112345678";
    }
  }

  updateQuickActions({
    orders: () => {
      document.getElementById("ordersSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    track: () => {
      window.location.href = "/seguimiento.html";
    },
    profile: () => {
      window.location.href = "/contact.html#form";
    },
    support: () => {
      if (supportBtn?.href) {
        window.open(supportBtn.href, "_blank");
      } else {
        window.location.href = "mailto:hola@nerinparts.com.ar";
      }
    },
  });
}

document.addEventListener("DOMContentLoaded", initMinorAccount);
