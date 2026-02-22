import { apiFetch } from "./api.js";

function showToast(message, type = "info") {
  const backgrounds = {
    success: "linear-gradient(135deg,#10b981,#22c55e)",
    danger: "linear-gradient(135deg,#ef4444,#dc2626)",
    info: "linear-gradient(135deg,#2563eb,#4f46e5)",
  };
  if (window.Toastify) {
    window.Toastify({
      text: message,
      duration: 3200,
      close: true,
      gravity: "top",
      position: "center",
      style: { background: backgrounds[type] || backgrounds.info },
    }).showToast();
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

function getOrderId(order) {
  return order?.id || order?.order_number || order?.numero || "";
}

function getOrderDate(order) {
  return order?.created_at || order?.date || order?.fecha || order?.updated_at || null;
}

function getOrderStatus(order) {
  return (
    order?.estado_envio ||
    order?.shipping_status ||
    order?.status_envio ||
    order?.status ||
    "pendiente"
  );
}

function getCarrier(order) {
  return order?.transportista || order?.carrier || order?.shipping_carrier || "A coordinar";
}

function isDelivered(order) {
  return String(getOrderStatus(order)).toLowerCase() === "entregado";
}

function normalizeOrders(payload) {
  if (Array.isArray(payload?.orders)) return payload.orders;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function renderOrders(orders) {
  const tbody = document.querySelector("#salesHistoryTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="5">No hay ventas registradas.</td></tr>';
    return;
  }

  orders.forEach((order) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${getOrderId(order) || "—"}</td>
      <td>${formatDate(getOrderDate(order))}</td>
      <td><span class="status-pill">${getOrderStatus(order)}</span></td>
      <td>${getCarrier(order)}</td>
      <td>${formatMoney(order?.total_amount || order?.total || order?.amount)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function populateReturnOrders(orders) {
  const select = document.getElementById("returnOrderId");
  if (!select) return;
  const delivered = orders.filter((order) => isDelivered(order) && order?.id);
  select.innerHTML = "";

  if (!delivered.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No hay pedidos entregados para devolver";
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  delivered.forEach((order) => {
    const option = document.createElement("option");
    option.value = order.id;
    const label = getOrderId(order) || order.id;
    option.textContent = `${label} · ${formatDate(getOrderDate(order))}`;
    select.appendChild(option);
  });
}

async function loadReturns(email) {
  const tbody = document.querySelector("#returnsTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  try {
    const res = await apiFetch(`/api/returns?email=${encodeURIComponent(email)}`);
    if (!res.ok) throw new Error("returns-fetch-failed");
    const data = await res.json();
    const returns = Array.isArray(data?.returns) ? data.returns : [];

    if (!returns.length) {
      tbody.innerHTML = '<tr><td colspan="5">No hay devoluciones cargadas.</td></tr>';
      return;
    }

    returns
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .forEach((item) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${item.id || "—"}</td>
          <td>${item.orderId || "—"}</td>
          <td>${formatDate(item.date)}</td>
          <td>${item.reason || "—"}</td>
          <td><span class="status-pill">${item.status || "pendiente"}</span></td>
        `;
        tbody.appendChild(tr);
      });
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="5">No se pudieron cargar las devoluciones.</td></tr>';
  }
}

function initCarrierSelector() {
  const select = document.getElementById("preferredCarrier");
  if (!select) return;
  const saved = localStorage.getItem("nerinPreferredCarrier");
  if (saved) select.value = saved;
  select.addEventListener("change", () => {
    localStorage.setItem("nerinPreferredCarrier", select.value);
    showToast("Transportista guardado.", "success");
  });
}

function initPasswordForm(email) {
  const form = document.getElementById("passwordForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const newPassword = document.getElementById("newPassword")?.value?.trim() || "";
    const confirmPassword = document.getElementById("confirmPassword")?.value?.trim() || "";

    if (newPassword.length < 6) {
      showToast("La nueva contraseña debe tener al menos 6 caracteres.", "danger");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("Las contraseñas no coinciden.", "danger");
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const previousLabel = submitBtn?.textContent || "";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Guardando...";
    }

    try {
      const res = await apiFetch(`/api/clients/${encodeURIComponent(email)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data?.error || "No se pudo actualizar la contraseña.", "danger");
        return;
      }

      form.reset();
      showToast("Contraseña actualizada correctamente.", "success");
    } catch (error) {
      showToast("Error de red al actualizar contraseña.", "danger");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = previousLabel || "Guardar nueva contraseña";
      }
    }
  });
}

async function init() {
  const email = localStorage.getItem("nerinUserEmail");
  if (!email) {
    window.location.href = "/login.html";
    return;
  }

  initCarrierSelector();
  initPasswordForm(email);

  let orders = [];
  try {
    const res = await apiFetch(`/api/orders?email=${encodeURIComponent(email)}`);
    if (res.ok) {
      const data = await res.json();
      orders = normalizeOrders(data);
    }
  } catch (error) {
    showToast("No se pudo cargar el historial de ventas.", "danger");
  }

  renderOrders(orders);
  populateReturnOrders(orders);
  await loadReturns(email);

  const returnForm = document.getElementById("returnForm");
  returnForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const orderId = document.getElementById("returnOrderId")?.value;
    const reason = document.getElementById("returnReason")?.value?.trim();

    if (!orderId || !reason) {
      showToast("Completá pedido y motivo.", "danger");
      return;
    }

    const payload = {
      orderId,
      reason,
      customerEmail: email,
    };

    try {
      const res = await apiFetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data?.error || "No se pudo crear la devolución.", "danger");
        return;
      }
      showToast("Solicitud enviada. Queda pendiente hasta aprobación en Admin.", "success");
      document.getElementById("returnReason").value = "";
      await loadReturns(email);
    } catch (error) {
      showToast("Error de red al crear la devolución.", "danger");
    }
  });
}

init();
