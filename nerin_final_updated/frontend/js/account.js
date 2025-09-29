/*
 * Panel de cuenta mayorista renovado.
 *
 * Este módulo arma un dashboard completo con métricas, recordatorios,
 * control documental y accesos rápidos para clientes mayoristas.
 */

const DOCUMENT_KEYS = ["afip", "iva", "bank", "agreement"];
const TOAST_STYLES = {
  success: "linear-gradient(135deg,#10b981,#22c55e)",
  info: "linear-gradient(135deg,#3b82f6,#6366f1)",
  warning: "linear-gradient(135deg,#f97316,#ea580c)",
  danger: "linear-gradient(135deg,#ef4444,#dc2626)",
};

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

function showToast(message, type = "info") {
  if (window.Toastify) {
    window.Toastify({
      text: message,
      duration: 3200,
      close: true,
      gravity: "top",
      position: "center",
      style: {
        background: TOAST_STYLES[type] || TOAST_STYLES.info,
      },
    }).showToast();
  } else {
    console.log(message);
  }
}

function safeParseJSON(value, fallback) {
  if (!value) {
    if (Array.isArray(fallback)) return [...fallback];
    if (fallback && typeof fallback === "object") return { ...fallback };
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return { ...parsed };
    return parsed;
  } catch (err) {
    if (Array.isArray(fallback)) return [...fallback];
    if (fallback && typeof fallback === "object") return { ...fallback };
    return fallback;
  }
}

function getFirstName(value, fallback) {
  if (value && typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed.split(/\s+/)[0];
  }
  return fallback;
}

function determineLoyalty(orderCount, totalSpent) {
  let level = "Nuevo";
  let progress = Math.min(100, (orderCount / 3) * 100);
  let nextMessage = "Estás a 1 compra de desbloquear 5% OFF permanente.";
  if (orderCount >= 10 || totalSpent >= 500000) {
    level = "Mayorista";
    progress = 100;
    nextMessage = "¡Tenés el máximo nivel activo!";
  } else if (orderCount >= 4 || totalSpent >= 180000) {
    level = "Frecuente";
    progress = Math.min(100, (orderCount / 10) * 100);
    nextMessage = "Realizá 1 compra más para subir a Mayorista.";
  }
  return { level, progress, nextMessage };
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
        name: item?.name || item?.product_name || item?.title || "Producto mayorista",
        quantity: Number(item?.quantity || item?.qty || item?.cantidad || 0) || 0,
        price: Number(item?.price || item?.unit_price || item?.precio || 0) || 0,
        image: item?.image || item?.image_url || item?.img || null,
      };
    })
    .filter((item) => item.quantity > 0);
}

function slugify(value) {
  if (!value) return "registro";
  return String(value).toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeCsv(value) {
  const text = value == null ? "" : String(value);
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

function downloadAccountStatement(email, clientData, orders, totalSpent) {
  const rows = [];
  rows.push(["Cliente", clientData?.name || email]);
  rows.push(["Correo", email]);
  rows.push(["CUIT/CUIL", clientData?.cuit || "No informado"]);
  rows.push(["Saldo actual", formatCurrency(clientData?.balance || 0)]);
  rows.push(["Límite de crédito", formatCurrency(clientData?.limit || 0)]);
  rows.push(["Total comprado", formatCurrency(totalSpent || 0)]);
  rows.push([]);
  rows.push(["Fecha", "Pedido", "Estado", "Transportista", "Importe"]);

  const sorted = [...orders].sort((a, b) => {
    const dateA = Date.parse(computeOrderDate(a) || 0) || 0;
    const dateB = Date.parse(computeOrderDate(b) || 0) || 0;
    return dateB - dateA;
  });

  sorted.forEach((order) => {
    const dateValue = computeOrderDate(order);
    const number = getOrderNumber(order);
    const status = getShippingStatus(order);
    const carrier = order?.transportista || order?.carrier || "A coordinar";
    const totalVal =
      order?.total_amount ||
      order?.total ||
      order?.total_amount_before_discount ||
      order?.amount ||
      0;
    rows.push([
      formatDate(dateValue),
      number ? String(number) : "Sin número",
      status ? String(status) : "—",
      carrier,
      formatCurrency(totalVal),
    ]);
  });

  const csvContent = rows.map((row) => row.map(escapeCsv).join(";")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `estado-cuenta-${slugify(email || "cliente")}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  showToast("Estado de cuenta descargado correctamente.", "success");
}

function renderBenefits(container, level, orderCount) {
  if (!container) return;
  const score = level === "Mayorista" ? 3 : level === "Frecuente" ? 2 : 1;
  const benefits = [
    {
      icon: "⚡️",
      title: "Soporte técnico prioritario",
      description: "Resolución en menos de 1 hora hábil para incidencias.",
      score: 1,
    },
    {
      icon: "📦",
      title: "Seguimiento personalizado",
      description: "Un asesor monitorea cada despacho y te avisa por WhatsApp.",
      score: 1,
    },
    {
      icon: "💳",
      title: "Financiación flexible",
      description: "Extensión de plazo a 30 días con pago parcial anticipado.",
      score: 2,
    },
    {
      icon: "🎯",
      title: "Precios preferenciales",
      description: "Listas especiales en compras mayores a $150.000.",
      score: 2,
    },
    {
      icon: "🚚",
      title: "Logística express",
      description: "Despacho prioritario con nuestras flotas aliadas.",
      score: 3,
    },
    {
      icon: "🧾",
      title: "Facturación automática",
      description: "Emisión AFIP dentro de las 2 horas posteriores al despacho.",
      score: 3,
    },
  ];

  const available = benefits.filter((benefit) => score >= benefit.score);
  if (!available.length) {
    container.innerHTML =
      '<p class="microcopy">Aún no tenés beneficios activos. Realizá tu primera compra para activarlos automáticamente.</p>';
    return;
  }

  container.innerHTML = available
    .map(
      (benefit) => `
        <article class="benefit-card">
          <span class="benefit-card__icon">${benefit.icon}</span>
          <div>
            <h4>${escapeHtml(benefit.title)}</h4>
            <p>${escapeHtml(benefit.description)}</p>
          </div>
        </article>
      `,
    )
    .join("");

  if (orderCount >= 6 && score >= 2) {
    container.innerHTML += `
      <article class="benefit-card">
        <span class="benefit-card__icon">🎁</span>
        <div>
          <h4>Acceso a lanzamientos</h4>
          <p>Probá repuestos exclusivos antes del lanzamiento oficial.</p>
        </div>
      </article>`;
  }
}

function renderTimeline(listEl, email, orders, clientData, reminders, lastLogin) {
  if (!listEl) return;
  const events = [];

  const createdKey = `nerinAccountCreatedAt:${email}`;
  let createdAt = localStorage.getItem(createdKey);
  if (!createdAt) {
    createdAt = new Date().toISOString();
    localStorage.setItem(createdKey, createdAt);
  }

  events.push({
    date: createdAt,
    title: "Cuenta mayorista activada",
    description: "Bienvenido al portal profesional de NERINParts.",
  });

  if (lastLogin) {
    events.push({
      date: lastLogin,
      title: "Último acceso",
      description: "Iniciaste sesión en el panel mayorista.",
    });
  }

  const sortedOrders = orders
    .map((order) => {
      const dateValue = computeOrderDate(order);
      return {
        date: dateValue || new Date().toISOString(),
        title: getOrderNumber(order)
          ? `Pedido ${getOrderNumber(order)}`
          : "Pedido registrado",
        description: `${getShippingStatus(order)} · ${formatCurrency(
          order?.total_amount || order?.total || order?.amount || 0,
        )}`,
      };
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  events.push(...sortedOrders.slice(0, 5));

  if (clientData?.balance > 0) {
    events.unshift({
      date: new Date().toISOString(),
      title: "Saldo pendiente",
      description: `Tenés ${formatCurrency(clientData.balance)} a regularizar.`,
    });
  }

  if (Array.isArray(reminders) && reminders.length) {
    const upcoming = reminders
      .filter((reminder) => !reminder.done)
      .sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0))[0];
    if (upcoming) {
      events.push({
        date: upcoming.date,
        title: "Recordatorio de pago",
        description: `${formatCurrency(upcoming.amount)} · ${upcoming.notes || "Pago programado"}`,
      });
    }
  }

  const uniqueEvents = events.filter((event) => event.date);
  uniqueEvents.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  if (!uniqueEvents.length) {
    listEl.innerHTML = '<li class="empty">Aún no registramos movimientos.</li>';
    return;
  }

  listEl.innerHTML = uniqueEvents
    .slice(0, 8)
    .map(
      (event) => `
        <li>
          <span class="timeline__date">${formatDate(event.date)}</span>
          <div class="timeline__content">
            <strong>${escapeHtml(event.title)}</strong>
            <span>${escapeHtml(event.description)}</span>
          </div>
        </li>
      `,
    )
    .join("");
}

function initDocumentChecklist(email, summaryEl, onChange) {
  const storageKey = `nerinWholesaleDocs:${email}`;
  let state = safeParseJSON(localStorage.getItem(storageKey), {});
  if (!state || typeof state !== "object") state = {};
  const checkboxes = document.querySelectorAll('[data-doc-check]');
  const total = checkboxes.length || DOCUMENT_KEYS.length;
  let completed = 0;

  function updateSummary() {
    completed = Object.values(state).filter(Boolean).length;
    if (summaryEl) {
      summaryEl.textContent = `${completed} de ${total} documentos recibidos.`;
    }
    if (typeof onChange === "function") {
      onChange(completed, total);
    }
  }

  function updateChip(docKey, checked) {
    const chip = document.querySelector(`[data-doc-status="${docKey}"]`);
    if (!chip) return;
    chip.textContent = checked ? "Recibido" : "Pendiente";
    if (checked) chip.dataset.state = "complete";
    else delete chip.dataset.state;
  }

  checkboxes.forEach((checkbox) => {
    const docKey = checkbox.getAttribute("data-doc-check");
    const isChecked = Boolean(state[docKey]);
    checkbox.checked = isChecked;
    updateChip(docKey, isChecked);
    checkbox.addEventListener("change", () => {
      state[docKey] = checkbox.checked;
      updateChip(docKey, checkbox.checked);
      localStorage.setItem(storageKey, JSON.stringify(state));
      showToast(
        checkbox.checked
          ? "Documento marcado como recibido."
          : "Documento marcado como pendiente.",
        checkbox.checked ? "success" : "info",
      );
      updateSummary();
    });
  });

  updateSummary();

  return {
    getCompleted: () => completed,
    getTotal: () => total,
  };
}

function initAuthorizedBuyers(email, listEl, formEl) {
  if (!listEl || !formEl) return;
  const storageKey = `nerinAuthorizedBuyers:${email}`;
  let buyers = safeParseJSON(localStorage.getItem(storageKey), []);
  if (!Array.isArray(buyers)) buyers = [];

  function render() {
    if (!buyers.length) {
      listEl.innerHTML = '<li class="empty">Todavía no agregaste compradores.</li>';
      return;
    }
    listEl.innerHTML = buyers
      .map(
        (buyer) => `
          <li>
            <span>${escapeHtml(buyer.name)} · <small>${escapeHtml(buyer.email)}</small></span>
            <button type="button" class="link-button link-button--danger" data-remove="${escapeHtml(
              buyer.id,
            )}">Quitar</button>
          </li>
        `,
      )
      .join("");
  }

  listEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    const id = button.getAttribute("data-remove");
    buyers = buyers.filter((buyer) => buyer.id !== id);
    localStorage.setItem(storageKey, JSON.stringify(buyers));
    render();
    showToast("Comprador eliminado.", "warning");
  });

  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const nameInput = formEl.querySelector("#buyerName");
    const emailInput = formEl.querySelector("#buyerEmail");
    const phoneInput = formEl.querySelector("#buyerPhone");
    const buyerName = nameInput?.value?.trim();
    const buyerEmail = emailInput?.value?.trim();
    const buyerPhone = phoneInput?.value?.trim();
    if (!buyerName || !buyerEmail) {
      showToast("Completá al menos nombre y correo del comprador.", "warning");
      return;
    }
    buyers.push({
      id: `buyer_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      name: buyerName,
      email: buyerEmail,
      phone: buyerPhone || "",
    });
    localStorage.setItem(storageKey, JSON.stringify(buyers));
    render();
    formEl.reset();
    showToast("Comprador autorizado agregado.", "success");
  });

  render();
}

function initReminders(email, listEl, formEl, onChange) {
  if (!listEl || !formEl) {
    return { getReminders: () => [] };
  }
  const storageKey = `nerinPaymentReminders:${email}`;
  let reminders = safeParseJSON(localStorage.getItem(storageKey), []);
  if (!Array.isArray(reminders)) reminders = [];

  function persist() {
    localStorage.setItem(storageKey, JSON.stringify(reminders));
    if (typeof onChange === "function") {
      onChange(reminders.slice());
    }
  }

  function render() {
    if (!reminders.length) {
      listEl.innerHTML = '<li class="empty">Sin recordatorios programados.</li>';
      return;
    }

    const ordered = reminders.slice().sort((a, b) => {
      return Date.parse(a.date || 0) - Date.parse(b.date || 0);
    });

    listEl.innerHTML = ordered
      .map((reminder) => {
        const classes = reminder.done ? "reminder-done" : "";
        return `
          <li class="${classes}">
            <span class="timeline__date">${formatDate(reminder.date)}</span>
            <div class="timeline__content">
              <strong>${formatCurrency(reminder.amount || 0)}</strong>
              <span>${escapeHtml(reminder.notes || "Pago programado")}</span>
            </div>
            <div class="timeline__actions">
              <button type="button" class="link-button" data-reminder-done="${escapeHtml(
                reminder.id,
              )}">${reminder.done ? "Reabrir" : "Marcar pagado"}</button>
              <button type="button" class="link-button link-button--danger" data-reminder-delete="${escapeHtml(
                reminder.id,
              )}">Eliminar</button>
            </div>
          </li>
        `;
      })
      .join("");
  }

  listEl.addEventListener("click", (event) => {
    const doneBtn = event.target.closest("[data-reminder-done]");
    const deleteBtn = event.target.closest("[data-reminder-delete]");
    if (doneBtn) {
      const id = doneBtn.getAttribute("data-reminder-done");
      reminders = reminders.map((reminder) =>
        reminder.id === id ? { ...reminder, done: !reminder.done } : reminder,
      );
      persist();
      render();
      showToast("Estado del recordatorio actualizado.", "info");
    } else if (deleteBtn) {
      const id = deleteBtn.getAttribute("data-reminder-delete");
      reminders = reminders.filter((reminder) => reminder.id !== id);
      persist();
      render();
      showToast("Recordatorio eliminado.", "warning");
    }
  });

  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const dateInput = formEl.querySelector("#reminderDate");
    const amountInput = formEl.querySelector("#reminderAmount");
    const notesInput = formEl.querySelector("#reminderNotes");
    const dateValue = dateInput?.value;
    const amountValue = Number(amountInput?.value || 0);
    if (!dateValue) {
      showToast("Elegí una fecha límite para el recordatorio.", "warning");
      return;
    }
    reminders.push({
      id: `rem_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      date: dateValue,
      amount: amountValue,
      notes: notesInput?.value?.trim() || "Pago programado",
      done: false,
      createdAt: new Date().toISOString(),
    });
    persist();
    render();
    formEl.reset();
    showToast("Recordatorio creado.", "success");
  });

  render();
  persist();

  return {
    getReminders: () => reminders.slice(),
  };
}

function renderMetrics(container, orders, totalSpent) {
  if (!container) return;
  if (!orders.length) {
    container.innerHTML = '<p class="microcopy">Sin métricas todavía.</p>';
    return;
  }
  const orderCount = orders.length;
  const average = totalSpent / orderCount || 0;
  const highest = orders.reduce((max, order) => {
    const value =
      order?.total_amount ||
      order?.total ||
      order?.total_amount_before_discount ||
      order?.amount ||
      0;
    return value > max ? value : max;
  }, 0);

  const carrierMap = {};
  const productMap = {};

  orders.forEach((order) => {
    const carrier = order?.transportista || order?.carrier;
    if (carrier) {
      carrierMap[carrier] = (carrierMap[carrier] || 0) + 1;
    }
    normalizeOrderItems(order).forEach((item) => {
      if (!item.name) return;
      productMap[item.name] = (productMap[item.name] || 0) + item.quantity;
    });
  });

  const topCarrier = Object.entries(carrierMap).sort((a, b) => b[1] - a[1])[0];
  const topProduct = Object.entries(productMap).sort((a, b) => b[1] - a[1])[0];

  container.innerHTML = `
    <div class="metric-card">
      <h4>Ticket promedio</h4>
      <strong>${formatCurrency(average)}</strong>
      <p>${orderCount} pedidos registrados</p>
    </div>
    <div class="metric-card">
      <h4>Compra más alta</h4>
      <strong>${formatCurrency(highest)}</strong>
      <p>Ideal para negociar un aumento de límite</p>
    </div>
    <div class="metric-card">
      <h4>Producto más pedido</h4>
      <strong>${escapeHtml(topProduct ? topProduct[0] : "Sin datos")}</strong>
      <p>${topProduct ? `${topProduct[1]} unidades` : "Comprá para ver estadísticas"}</p>
    </div>
    <div class="metric-card">
      <h4>Transportista habitual</h4>
      <strong>${escapeHtml(topCarrier ? topCarrier[0] : "A coordinar")}</strong>
      <p>${topCarrier ? `${topCarrier[1]} envíos confirmados` : "Definí tu transportista preferido"}</p>
    </div>
  `;
}

function updateHero(elements, context) {
  const {
    heroNameEl,
    heroSubtitleEl,
    heroBalanceEl,
    heroLimitEl,
    heroLastMovementEl,
    heroLastOrderEl,
    heroStatusEl,
  } = elements;
  const {
    displayName,
    email,
    clientData,
    lastOrder,
    level,
    documentCompletion,
  } = context;

  if (heroNameEl) {
    heroNameEl.textContent = getFirstName(displayName, email);
  }
  if (heroBalanceEl) {
    heroBalanceEl.textContent = formatCurrency(clientData?.balance || 0);
  }
  if (heroLimitEl) {
    heroLimitEl.textContent = clientData?.limit
      ? `Límite ${formatCurrency(clientData.limit)}`
      : "Límite a definir";
  }

  if (heroSubtitleEl) {
    const subtitle =
      level === "Mayorista"
        ? "Tenés acceso al máximo nivel de beneficios y soporte prioritario."
        : level === "Frecuente"
        ? "Estás muy cerca de desbloquear límites especiales y descuentos permanentes."
        : "Comenzá realizando tu primera compra y activá beneficios exclusivos.";
    heroSubtitleEl.textContent = subtitle;
  }

  if (heroLastMovementEl) {
    heroLastMovementEl.textContent = lastOrder?.date
      ? formatDateTime(lastOrder.date)
      : "—";
  }

  if (heroLastOrderEl) {
    heroLastOrderEl.textContent = lastOrder?.number
      ? `Pedido ${lastOrder.number}`
      : "Sin pedidos registrados";
  }

  if (heroStatusEl) {
    let status = "Cuenta activa";
    if (clientData?.blocked) status = "Cuenta bloqueada";
    else if (clientData?.blockedReturns) status = "Devoluciones restringidas";
    else if (
      documentCompletion &&
      documentCompletion.total > 0 &&
      documentCompletion.completed < documentCompletion.total
    ) {
      status = "Documentación pendiente";
    } else if (
      clientData?.limit &&
      Number(clientData.balance || 0) > Number(clientData.limit || 0)
    ) {
      status = "Límite excedido";
    }
    heroStatusEl.textContent = status;
  }
}

function updateCreditCard(elements, context) {
  const {
    creditBalanceEl,
    creditAvailableEl,
    creditUsageBar,
    creditUsageLabel,
    creditGauge,
    creditStatusBadge,
    nextReviewEl,
    paymentRecommendationEl,
  } = elements;
  const { clientData, lastOrder, totalSpent } = context;

  const balance = Number(clientData?.balance || 0);
  const limit = Number(clientData?.limit || 0);
  const usage = limit > 0 ? Math.min(balance / limit, 1) : 0;
  const usagePercent = Math.round(usage * 100);

  if (creditBalanceEl) creditBalanceEl.textContent = formatCurrency(balance);
  if (creditAvailableEl) {
    creditAvailableEl.textContent = limit
      ? formatCurrency(Math.max(limit - balance, 0))
      : "Definí tu límite con un asesor";
  }
  if (creditUsageBar) {
    creditUsageBar.style.width = `${Math.min(100, usagePercent)}%`;
  }
  if (creditUsageLabel) {
    creditUsageLabel.textContent = limit
      ? `${usagePercent}% del límite utilizado.`
      : "Aún no definiste un límite de crédito.";
  }
  if (creditGauge) {
    creditGauge.style.setProperty("--credit-usage", `${Math.min(usage * 360, 360)}`);
    creditGauge.setAttribute("data-usage", `${usagePercent}%`);
  }

  if (creditStatusBadge) {
    creditStatusBadge.textContent = "Al día";
    creditStatusBadge.classList.remove("badge--success", "badge--warning", "badge--danger");
    if (clientData?.blocked) {
      creditStatusBadge.textContent = "Bloqueada";
      creditStatusBadge.classList.add("badge--danger");
    } else if (usage >= 1) {
      creditStatusBadge.textContent = "Límite alcanzado";
      creditStatusBadge.classList.add("badge--danger");
    } else if (usage >= 0.85) {
      creditStatusBadge.textContent = "Revisar saldo";
      creditStatusBadge.classList.add("badge--warning");
    } else {
      creditStatusBadge.classList.add("badge--success");
    }
  }

  if (nextReviewEl) {
    const baseDate = lastOrder?.date ? new Date(lastOrder.date) : new Date();
    if (!Number.isNaN(baseDate.getTime())) {
      baseDate.setDate(baseDate.getDate() + 30);
      nextReviewEl.textContent = `Próxima revisión de cuenta: ${formatDate(baseDate)}`;
    } else {
      nextReviewEl.textContent = "Próxima revisión de cuenta: coordiná con tu ejecutivo.";
    }
  }

  if (paymentRecommendationEl) {
    if (balance > 0) {
      const recommended = Math.max(Math.round(balance * 0.35), 5000);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 5);
      paymentRecommendationEl.textContent = `Recomendamos cancelar ${formatCurrency(
        recommended,
      )} antes del ${formatDate(dueDate)} para liberar más crédito.`;
    } else {
      paymentRecommendationEl.textContent = "No hay pagos pendientes.";
    }
  }
}

function updateLoyaltyCard(level, progress, message, levelEl, progressEl, messageEl) {
  if (levelEl) levelEl.textContent = level;
  if (progressEl) progressEl.style.width = `${Math.min(100, Math.round(progress))}%`;
  if (messageEl) messageEl.textContent = message;
}

function updateQuickActions(buttons, handlers) {
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      const handler = handlers[action];
      if (typeof handler === "function") {
        handler();
      }
    });
  });
}

function addItemsToCart(items) {
  if (!Array.isArray(items) || !items.length) {
    showToast("No pudimos repetir el pedido porque no encontramos productos.", "warning");
    return;
  }
  const cart = safeParseJSON(localStorage.getItem("nerinCart"), []);
  const updatedCart = Array.isArray(cart) ? [...cart] : [];
  items.forEach((item) => {
    if (!item?.id) return;
    const existing = updatedCart.find((cartItem) => cartItem.id === item.id);
    if (existing) {
      existing.quantity += item.quantity || 1;
    } else {
      updatedCart.push({
        id: item.id,
        name: item.name || "Producto mayorista",
        price: item.price || 0,
        quantity: item.quantity || 1,
        image: item.image || null,
      });
    }
  });
  localStorage.setItem("nerinCart", JSON.stringify(updatedCart));
  if (window.updateNav) window.updateNav();
  showToast("Productos añadidos al carrito mayorista.", "success");
}

async function renderOrders(orders, email, invoiceList) {
  const tbody = document.querySelector("#userOrdersTable tbody");
  if (!tbody || !invoiceList) return;
  tbody.innerHTML = "";
  invoiceList.innerHTML = "";

  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="8">No tienes pedidos registrados.</td></tr>';
    return;
  }

  for (const order of orders) {
    const tr = document.createElement("tr");
    const numero = getOrderNumber(order);
    const fechaValor = computeOrderDate(order);
    const fecha = fechaValor ? new Date(fechaValor) : null;
    const items = normalizeOrderItems(order);
    const statusRaw = getShippingStatus(order) || "pendiente";
    const statusCode = statusRaw.toString().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const statusLabel = statusCode.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
    const transportista = order?.transportista || order?.carrier || "A coordinar";
    const totalVal =
      order?.total_amount ||
      order?.total ||
      order?.total_amount_before_discount ||
      order?.amount ||
      0;

    tr.innerHTML = `
      <td>${escapeHtml(numero || "—")}</td>
      <td>${fecha ? formatDateTime(fecha) : "—"}</td>
      <td>${items.length ? escapeHtml(items.map((it) => `${it.name} x${it.quantity}`).join(", ")) : "—"}</td>
      <td><span class="status-badge status-${escapeHtml(statusCode)}">${escapeHtml(statusLabel)}</span></td>
      <td>${escapeHtml(transportista)}</td>
      <td>${formatCurrency(totalVal)}</td>
      <td><button type="button" class="button secondary small invoice-btn">Factura</button></td>
      <td class="order-actions"></td>
    `;

    const actionsTd = tr.querySelector(".order-actions");
    const invoiceBtn = tr.querySelector(".invoice-btn");

    if (invoiceBtn) {
      invoiceBtn.addEventListener("click", async () => {
        const oid = numero;
        try {
          const resp = await fetch(`/api/invoices/${encodeURIComponent(oid)}`, {
            method: "POST",
          });
          if (resp.ok) {
            window.open(`/invoice.html?orderId=${encodeURIComponent(oid)}`, "_blank");
          } else {
            const errData = await resp.json().catch(() => ({}));
            showToast(errData.error || "No pudimos generar la factura.", "danger");
          }
        } catch (err) {
          showToast("Error al generar la factura.", "danger");
        }
      });
    }

    try {
      const oid = numero;
      const resp = await fetch(`/api/invoices/${encodeURIComponent(oid)}`);
      if (resp.ok) {
        if (invoiceBtn) invoiceBtn.textContent = "Ver factura";
        const { invoice } = await resp.json();
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = `/invoice.html?orderId=${encodeURIComponent(oid)}`;
        link.textContent = `Factura ${invoice?.id || numero}`;
        link.target = "_blank";
        li.appendChild(link);
        invoiceList.appendChild(li);
      }
    } catch (err) {
      /* ignorar errores de comprobación de factura */
    }

    if (order?.tracking) {
      const trackBtn = document.createElement("button");
      trackBtn.type = "button";
      trackBtn.className = "button secondary small";
      trackBtn.textContent = "Ver seguimiento";
      trackBtn.addEventListener("click", () => {
        window.open(order.tracking, "_blank");
      });
      actionsTd?.appendChild(trackBtn);
    }

    if (items.length) {
      const repeatBtn = document.createElement("button");
      repeatBtn.type = "button";
      repeatBtn.className = "button primary small";
      repeatBtn.textContent = "Repetir pedido";
      repeatBtn.addEventListener("click", () => {
        addItemsToCart(items);
        repeatBtn.textContent = "Añadido";
        setTimeout(() => {
          repeatBtn.textContent = "Repetir pedido";
        }, 1800);
      });
      actionsTd?.appendChild(repeatBtn);
    }

    tbody.appendChild(tr);
  }
}

async function loadUserReturns(email) {
  const returnsTbody = document.querySelector("#userReturnsTable tbody");
  if (!returnsTbody) return;
  returnsTbody.innerHTML = "";
  try {
    const res = await fetch(`/api/returns?email=${encodeURIComponent(email)}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const returns = data?.returns || [];
    if (!returns.length) {
      returnsTbody.innerHTML = '<tr><td colspan="6">No tienes devoluciones.</td></tr>';
      return;
    }
    returns.forEach((ret) => {
      const tr = document.createElement("tr");
      const reasonClass = ret?.reason?.toLowerCase().includes("falla")
        ? "reason-fallado"
        : "reason-error";
      tr.innerHTML = `
        <td>${escapeHtml(ret?.id || "—")}</td>
        <td>${escapeHtml(ret?.orderId || "—")}</td>
        <td>${formatDateTime(ret?.date)}</td>
        <td class="${reasonClass}">${escapeHtml(ret?.reason || "—")}</td>
        <td>${escapeHtml(ret?.status || "En revisión")}</td>
        <td><button class="button secondary small detail-btn">Ver detalles</button></td>
      `;
      tr.querySelector(".detail-btn")?.addEventListener("click", () => {
        showToast(`Motivo: ${ret?.reason || "Sin detalle"}`, "info");
      });
      returnsTbody.appendChild(tr);
    });
  } catch (err) {
    returnsTbody.innerHTML =
      '<tr><td colspan="6">No se pudieron cargar tus devoluciones.</td></tr>';
  }
}

async function initAccount() {
  const email = localStorage.getItem("nerinUserEmail");
  const name = localStorage.getItem("nerinUserName");
  if (!email) {
    window.location.href = "/login.html";
    return;
  }

  const heroNameEl = document.getElementById("heroName");
  const heroSubtitleEl = document.getElementById("heroSubtitle");
  const heroBalanceEl = document.getElementById("heroBalance");
  const heroLimitEl = document.getElementById("heroLimit");
  const heroLastMovementEl = document.getElementById("heroLastMovement");
  const heroLastOrderEl = document.getElementById("heroLastOrder");
  const heroStatusEl = document.getElementById("heroStatus");

  const creditBalanceEl = document.getElementById("creditBalance");
  const creditAvailableEl = document.getElementById("creditAvailable");
  const creditUsageBar = document.getElementById("creditUsageBar");
  const creditUsageLabel = document.getElementById("creditUsageLabel");
  const creditGauge = document.getElementById("creditGauge");
  const creditStatusBadge = document.getElementById("creditStatusBadge");
  const nextReviewEl = document.getElementById("nextReview");
  const paymentRecommendationEl = document.getElementById("paymentRecommendation");

  const loyaltyLevelEl = document.getElementById("loyaltyLevel");
  const loyaltyProgressEl = document.getElementById("loyaltyProgress");
  const loyaltyMessageEl = document.getElementById("loyaltyMessage");

  const benefitsContainer = document.getElementById("benefitsList");
  const invoiceList = document.getElementById("invoiceList");
  const supportBtn = document.getElementById("supportBtn");
  const metricsContainer = document.getElementById("metricsInfo");
  const documentSummaryEl = document.getElementById("documentSummary");
  const reminderList = document.getElementById("reminderList");
  const reminderForm = document.getElementById("reminderForm");
  const authorizedList = document.getElementById("authorizedBuyersList");
  const authorizedForm = document.getElementById("authorizedBuyerForm");
  const timelineList = document.getElementById("timelineList");
  const downloadStatementBtn = document.getElementById("downloadStatementBtn");
  const quickActionButtons = Array.from(document.querySelectorAll(".action-tile"));
  const downloadAllBtn = document.getElementById("downloadAll");

  let clientData = null;
  let orders = [];

  try {
    const [clientsRes, ordersRes] = await Promise.all([
      fetch("/api/clients"),
      fetch(`/api/orders?email=${encodeURIComponent(email)}`),
    ]);
    if (clientsRes.ok) {
      const { clients } = await clientsRes.json();
      clientData = Array.isArray(clients)
        ? clients.find((client) => client.email === email)
        : null;
    }
    if (ordersRes.ok) {
      const data = await ordersRes.json();
      orders = Array.isArray(data?.orders) ? data.orders : [];
    }
  } catch (err) {
    console.error(err);
  }

  const totalSpent = orders.reduce((total, order) => {
    const value =
      order?.total_amount ||
      order?.total ||
      order?.total_amount_before_discount ||
      order?.amount ||
      0;
    return total + Number(value);
  }, 0);

  const loyalty = determineLoyalty(orders.length, totalSpent);
  const ordered = orders
    .map((order) => {
      const dateValue = computeOrderDate(order);
      const date = dateValue ? new Date(dateValue) : null;
      return {
        raw: order,
        date,
        number: getOrderNumber(order),
      };
    })
    .sort((a, b) => (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0));
  const lastOrder = ordered[0] || null;

  let documentCompletion = { completed: 0, total: DOCUMENT_KEYS.length };
  const docsState = initDocumentChecklist(email, documentSummaryEl, (completed, total) => {
    documentCompletion = { completed, total };
    refreshHero();
  });
  documentCompletion = {
    completed: docsState.getCompleted(),
    total: docsState.getTotal(),
  };

  function refreshHero() {
    updateHero(
      {
        heroNameEl,
        heroSubtitleEl,
        heroBalanceEl,
        heroLimitEl,
        heroLastMovementEl,
        heroLastOrderEl,
        heroStatusEl,
      },
      {
        displayName: clientData?.name || name || email,
        email,
        clientData,
        lastOrder,
        level: loyalty.level,
        documentCompletion,
      },
    );
  }

  refreshHero();

  updateCreditCard(
    {
      creditBalanceEl,
      creditAvailableEl,
      creditUsageBar,
      creditUsageLabel,
      creditGauge,
      creditStatusBadge,
      nextReviewEl,
      paymentRecommendationEl,
    },
    { clientData, lastOrder, totalSpent },
  );

  updateLoyaltyCard(
    loyalty.level,
    loyalty.progress,
    loyalty.nextMessage,
    loyaltyLevelEl,
    loyaltyProgressEl,
    loyaltyMessageEl,
  );

  renderBenefits(benefitsContainer, loyalty.level, orders.length);

  const remindersState = initReminders(email, reminderList, reminderForm, (reminders) => {
    const lastLogin = localStorage.getItem("nerinLastLogin");
    renderTimeline(timelineList, email, orders, clientData, reminders, lastLogin);
  });

  initAuthorizedBuyers(email, authorizedList, authorizedForm);

  const quickHandlers = {
    limit: () => {
      document.getElementById("creditCard")?.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast(
        "Enviá tus estados contables y un ejecutivo revisará tu aumento en 24 horas.",
        "info",
      );
    },
    statement: () => {
      downloadAccountStatement(email, clientData, orders, totalSpent);
    },
    team: () => {
      document.getElementById("teamCard")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("buyerName")?.focus({ preventScroll: true });
    },
    reminder: () => {
      document
        .getElementById("remindersCard")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("reminderDate")?.focus({ preventScroll: true });
    },
  };
  updateQuickActions(quickActionButtons, quickHandlers);

  if (downloadStatementBtn) {
    downloadStatementBtn.addEventListener("click", () => {
      downloadAccountStatement(email, clientData, orders, totalSpent);
    });
  }

  const lastLogin = localStorage.getItem("nerinLastLogin");
  renderTimeline(
    timelineList,
    email,
    orders,
    clientData,
    remindersState.getReminders(),
    lastLogin,
  );

  await renderOrders(orders, email, invoiceList);
  await loadUserReturns(email);

  if (supportBtn) {
    const phone = window.NERIN_CONFIG?.whatsappNumber;
    if (phone) {
      const sanitized = phone.replace(/[^0-9]/g, "");
      supportBtn.href = `https://wa.me/${sanitized}`;
    } else {
      supportBtn.href = "https://wa.me/541112345678";
    }
  }

  if (clientData) {
    document.getElementById("pName").value = clientData.name || "";
    document.getElementById("pEmail").value = clientData.email || email;
    document.getElementById("pPhone").value = clientData.phone || "";
    document.getElementById("pAddress").value = clientData.address || "";
    document.getElementById("pCUIT").value = clientData.cuit || "";
  } else {
    document.getElementById("pEmail").value = email;
  }

  const profileForm = document.getElementById("profileForm");
  if (profileForm) {
    profileForm.addEventListener("submit", async (event) => {
      event.preventDefault();
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
        if (res.ok) {
          showToast("Perfil actualizado correctamente.", "success");
        } else {
          showToast("No se pudo guardar el perfil.", "danger");
        }
      } catch (err) {
        showToast("Error al actualizar el perfil.", "danger");
      }
    });
  }

  renderMetrics(metricsContainer, orders, totalSpent);

  if (downloadAllBtn) {
    downloadAllBtn.addEventListener("click", () => {
      showToast(
        "Estamos preparando un ZIP con tus comprobantes. Te enviaremos un enlace por correo.",
        "info",
      );
    });
  }
}

document.addEventListener("DOMContentLoaded", initAccount);
