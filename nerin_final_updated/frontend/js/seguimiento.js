// Módulo para consultar el estado de un pedido

const form = document.getElementById('trackForm');
const emailInput = document.getElementById('email');
const orderInput = document.getElementById('orderId');
const summaryEl = document.getElementById('orderSummary');
const progressContainer = document.getElementById('orderProgress');
const alertEl = document.getElementById('orderAlert');
const contactBtn = document.getElementById('contactWhatsApp');

let invoiceInfo = null;
let pollTimer = null;
let currentOrderId = null;
let lastEtag = null;

const PAYMENT_CANCEL_CODES = new Set(['rejected', 'charged_back', 'refunded']);
const POLL_INTERVAL_MS = 15000;

const ORDER_STEPS = [
  {
    label: 'Pedido recibido',
    icon:
      '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M9 3.5h6"/><path d="M9.5 3h5a1.5 1.5 0 0 1 1.5 1.5V6h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1V4.5A1.5 1.5 0 0 1 9.5 3z"/><path d="M9 11h6"/><path d="M9 15h4"/></svg>',
  },
  {
    label: 'Pago acreditado',
    icon:
      '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><path d="M9.5 12.5l2.1 2.3 4.4-5.3"/></svg>',
  },
  {
    label: 'Preparando el pedido',
    icon:
      '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M6 8.5 12 5l6 3.5v7l-6 3.5-6-3.5z"/><path d="M12 5v14"/><path d="M6 8.5l6 3.5 6-3.5"/></svg>',
  },
  {
    label: 'Enviado',
    icon:
      '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M3 8h9v6H5.75"/><path d="M12 11h4.2l2.8 3v4h-3"/><circle cx="7.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/><path d="M9.5 17.5h5"/></svg>',
  },
  {
    label: 'Entregado',
    icon:
      '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M7 4v16"/><path d="M7 5.5h9l-2 3 2 3H7"/></svg>',
  },
];

const STATUS_PATTERNS = [
  { step: 5, tests: [/entreg/, /deliv/, /finaliz/, /complet/] },
  { step: 4, tests: [/enviad/, /despach/, /shipp/, /camino/, /parti/, /salio/] },
  { step: 3, tests: [/prepar/, /alist/, /armand/, /process/, /ready/, /listo/] },
  { step: 2, tests: [/aprob/, /pagad/, /acred/, /approv/, /paid/, /cobrad/, /credit/] },
  { step: 1, tests: [/recib/, /pendi/, /pedido/, /orden/, /received/, /generad/, /cread/, /cancel/] },
];

const SHIPPING_NEGATIONS = {
  3: /\b(?:no|sin)\s+(?:prepar|alist|arm)/,
  4: /\b(?:no|sin)\s+(?:envi|despach)/,
  5: /\b(?:no|sin)\s+(?:entreg|recib)/,
};

function normalizeStatusValue(value) {
  if (!value && value !== 0) return '';
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function resolveStepFromStatus(value, type = 'generic') {
  const normalized = normalizeStatusValue(value);
  if (!normalized) return 0;
  const cleaned = normalized.replace(/\s+/g, ' ');
  if (!cleaned) return 0;

  const negations = type === 'shipping' ? SHIPPING_NEGATIONS : null;
  for (const { step, tests } of STATUS_PATTERNS) {
    if (negations && negations[step] && negations[step].test(cleaned)) {
      continue;
    }
    if (tests.some((pattern) => pattern.test(cleaned))) {
      return step;
    }
  }
  return 0;
}

function buildOrderStepper() {
  const list = document.createElement('ol');
  list.className = 'order-progress';
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Progreso del pedido');
  ORDER_STEPS.forEach((step, index) => {
    const item = document.createElement('li');
    item.className = 'order-step';
    item.dataset.step = String(index + 1);

    const icon = document.createElement('span');
    icon.className = 'order-step__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = step.icon;

    const label = document.createElement('span');
    label.className = 'order-step__label';
    label.textContent = step.label;

    item.append(icon, label);
    list.appendChild(item);
  });
  return list;
}

function renderOrderSteps(statuses = {}, target = progressContainer) {
  const container = target || document.getElementById('orderProgress');
  if (!container) return null;

  let list = container.classList?.contains('order-progress')
    ? container
    : container.querySelector('.order-progress');

  if (!list) {
    list = buildOrderStepper();
    if (container !== list) {
      container.innerHTML = '';
      container.appendChild(list);
    }
  }

  const paymentStep = resolveStepFromStatus(statuses.paymentStatus, 'payment');
  const shippingStep = resolveStepFromStatus(statuses.shippingStatus, 'shipping');
  const activeStep = Math.max(paymentStep, shippingStep, 1);
  const total = ORDER_STEPS.length;
  const clampedStep = Math.min(Math.max(activeStep, 1), total);
  const activeIndex = clampedStep - 1;
  const progressRatio = total > 1 ? activeIndex / (total - 1) : 0;

  list.style.setProperty('--progress', progressRatio.toFixed(4));
  list.dataset.activeStep = String(clampedStep);
  list.dataset.steps = String(total);

  Array.from(list.children).forEach((item, index) => {
    item.classList.toggle('is-done', index < activeIndex);
    item.classList.toggle('is-current', index === activeIndex);
    if (index === activeIndex) {
      item.setAttribute('aria-current', 'step');
    } else {
      item.removeAttribute('aria-current');
    }
  });

  if (container !== list) {
    container.style.display = 'block';
  }

  return {
    list,
    activeStep: clampedStep,
    paymentStep,
    shippingStep,
    progress: progressRatio,
  };
}

function updateWhatsAppLink() {
  const cfg = window.NERIN_CONFIG;
  if (cfg && cfg.whatsappNumber && contactBtn) {
    const phone = cfg.whatsappNumber.replace(/[^0-9]/g, '');
    contactBtn.href = `https://wa.me/${phone}`;
    const navWA = document.getElementById('navWhatsApp');
    if (navWA) navWA.href = `https://wa.me/${phone}`;
  }
}

async function fetchInvoice(orderId) {
  if (!orderId) {
    invoiceInfo = null;
    return;
  }
  try {
    const res = await fetch(
      `/api/orders/${encodeURIComponent(orderId)}/invoices`,
    );
    if (!res.ok) {
      invoiceInfo = null;
      return;
    }
    const data = await res.json();
    const list = Array.isArray(data.invoices) ? data.invoices : [];
    invoiceInfo =
      list.find((inv) => !inv.deleted_at) ||
      list.find((inv) => inv && inv.url) ||
      null;
  } catch (_) {
    invoiceInfo = null;
  }
}

function normalizeShippingStatus(value = '') {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const key = raw.toLowerCase().normalize('NFKD');
  if (key.includes('prepar')) return 'preparing';
  if (key.includes('enviado')) return 'shipped';
  if (key.includes('entregado')) return 'delivered';
  if (key.includes('cancel')) return 'canceled';
  if (key.includes('recibi')) return 'received';
  if (key === 'received' || key === 'preparing' || key === 'shipped' || key === 'delivered' || key === 'canceled') {
    return key;
  }
  return null;
}

function getShippingCode(order = {}) {
  const candidates = [
    order.shipping_status_code,
    order.shippingStatusCode,
    order.shipping_status,
    order.shippingStatus,
    order.estado_envio,
  ];
  for (const value of candidates) {
    const normalized = normalizeShippingStatus(value);
    if (normalized) return normalized;
  }
  return 'received';
}

function getPaymentCode(order = {}) {
  const candidates = [
    order.payment_status_code,
    order.paymentStatusCode,
    order.payment_status,
    order.estado_pago,
    order.status,
  ];
  for (const value of candidates) {
    if (!value && value !== 0) continue;
    const key = String(value).toLowerCase();
    if (key === 'approved' || key === 'pending' || key === 'rejected' || key === 'refunded' || key === 'charged_back') {
      return key;
    }
    if (key === 'pagado' || key === 'aprobado' || key === 'paid') return 'approved';
    if (key === 'pendiente' || key === 'pending_payment') return 'pending';
    if (key === 'rechazado' || key === 'cancelado' || key === 'cancelled') return 'rejected';
  }
  return 'pending';
}

function hideAlert() {
  if (!alertEl) return;
  alertEl.style.display = 'none';
  alertEl.textContent = '';
}

function showAlert(message) {
  if (!alertEl) return;
  alertEl.textContent = message;
  alertEl.style.display = 'block';
}

function renderOrderProgress(order = {}) {
  if (!progressContainer) return;

  const paymentStatus =
    order.payment_status ||
    order.estado_pago ||
    order.payment_status_code ||
    order.status ||
    '';
  const shippingStatus =
    order.shipping_status ||
    order.estado_envio ||
    order.shipping_status_label ||
    order.shipping_status_code ||
    '';

  const stepInfo = renderOrderSteps(
    { paymentStatus, shippingStatus },
    progressContainer,
  );

  if (!stepInfo) {
    progressContainer.style.display = 'none';
    progressContainer.innerHTML = '';
    hideAlert();
    return;
  }

  const shippingCode = getShippingCode(order);
  const paymentCode = getPaymentCode(order);
  let alertMessage = '';
  if (shippingCode === 'canceled' || shippingCode === 'cancelled') {
    alertMessage = 'Pedido cancelado';
  }
  if (PAYMENT_CANCEL_CODES.has(paymentCode)) {
    alertMessage = alertMessage
      ? `${alertMessage} / Pago revertido`
      : 'Pago revertido';
  }
  if (alertMessage) showAlert(alertMessage);
  else hideAlert();
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `$${number.toLocaleString('es-AR')}`;
}

function formatItems(order = {}) {
  const source = Array.isArray(order.productos) && order.productos.length
    ? order.productos
    : Array.isArray(order.items) ? order.items : [];
  if (!source.length) return '';
  return source
    .map((item) => {
      const name = item?.name || item?.title || item?.titulo || 'Producto';
      const qty = Number(item?.quantity ?? item?.qty ?? item?.cantidad ?? 0) || 0;
      const price = Number(item?.price ?? item?.unit_price ?? item?.total ?? 0);
      const priceLabel = Number.isFinite(price) && price > 0
        ? ` - ${formatCurrency(price)}`
        : '';
      return `<li>${name} x${qty}${priceLabel}</li>`;
    })
    .join('');
}

function renderOrder(order = {}) {
  const orderId = order.id || order.order_number || order.external_reference || '';
  const paymentLabel = order.payment_status || order.estado_pago || 'Pendiente';
  const shippingLabel = order.shipping_status || order.estado_envio || 'Pendiente';
  const rawDate = order.fecha || order.created_at || order.createdAt || order.date;
  const formattedDate = rawDate ? new Date(rawDate).toLocaleDateString('es-AR') : '-';
  const itemsHtml = formatItems(order);
  const totalValue = order.total ?? order.total_amount ?? order.totals?.grand_total ?? null;
  const totalLabel = formatCurrency(totalValue) || '$0';
  const shippingCost = typeof order.costo_envio === 'number' ? order.costo_envio : order.shipping_cost;
  const shippingCostLabel = formatCurrency(shippingCost);
  const trackingCode = order.seguimiento || order.tracking || '';
  const carrier = order.transportista || order.carrier || '';
  const paymentMethod = order.metodo_pago || order.payment_method || '';
  const destination = order.destino || order.address || order.shipping_address?.street || '';
  const province = order.provincia_envio || order.shipping_address?.province || '';
  const customerEmail = order.cliente?.email || order.customer?.email || order.user_email || '';
  const orderInvoices = Array.isArray(order.invoices) ? order.invoices : [];
  const activeInvoice = orderInvoices.find((inv) => inv && !inv.deleted_at && inv.url);
  const invoiceToShow =
    (invoiceInfo && invoiceInfo.url ? invoiceInfo : null) || activeInvoice || null;
  if (!invoiceInfo && invoiceToShow) {
    invoiceInfo = invoiceToShow;
  }

  summaryEl.innerHTML = `
    <p><strong>Número de pedido:</strong> ${orderId}</p>
    <p><strong>Estado del pago:</strong> ${paymentLabel}</p>
    <p><strong>Estado del envío:</strong> ${shippingLabel}</p>
    <p><strong>Fecha:</strong> ${formattedDate}</p>
    ${itemsHtml ? `<ul>${itemsHtml}</ul>` : ''}
    <p><strong>Total:</strong> ${totalLabel}</p>
    ${paymentMethod ? `<p><strong>Método de pago:</strong> ${paymentMethod}</p>` : ''}
    ${destination ? `<p><strong>Envío a:</strong> ${destination}</p>` : '<p><em>Coordinación de envío por WhatsApp</em></p>'}
    ${province ? `<p><strong>Provincia de envío:</strong> ${province}</p>` : ''}
    ${shippingCostLabel ? `<p><strong>Costo de envío:</strong> ${shippingCostLabel}</p>` : ''}
    ${customerEmail ? `<p><strong>Email:</strong> ${customerEmail}</p>` : ''}
    ${trackingCode ? `<p><strong>Nº de seguimiento:</strong> ${trackingCode}${carrier ? ` (${carrier})` : ''}</p>` : ''}
    ${invoiceToShow && invoiceToShow.url
      ? `<p><a href="${invoiceToShow.url}" target="_blank" rel="noopener">Ver/Descargar factura</a></p>`
      : '<p><em>Factura pendiente</em></p>'}
  `;
  summaryEl.style.display = 'block';
  renderOrderProgress(order);
}

function resetView() {
  summaryEl.style.display = 'none';
  if (progressContainer) {
    progressContainer.style.display = 'none';
    progressContainer.innerHTML = '';
  }
  hideAlert();
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function pollOrder() {
  if (!currentOrderId) return;
  try {
    const headers = lastEtag ? { 'If-None-Match': lastEtag } : {};
    const res = await fetch(`/api/orders/${encodeURIComponent(currentOrderId)}`, { headers });
    if (res.status === 304) return;
    if (res.status === 404) {
      stopPolling();
      summaryEl.textContent = 'Pedido no encontrado o eliminado.';
      summaryEl.style.display = 'block';
      if (progressContainer) {
        progressContainer.style.display = 'none';
        progressContainer.innerHTML = '';
      }
      hideAlert();
      return;
    }
    if (!res.ok) throw new Error('No se pudo actualizar el pedido');
    const etag = res.headers.get('ETag');
    if (etag) lastEtag = etag;
    const data = await res.json();
    if (data && data.order) {
      await fetchInvoice(data.order.id || currentOrderId);
      renderOrder(data.order);
    }
  } catch (err) {
    console.error(err);
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollOrder, POLL_INTERVAL_MS);
}

async function fetchOrder(email, id) {
  resetView();
  if (!email || !id) return;
  summaryEl.textContent = 'Buscando...';
  summaryEl.style.display = 'block';
  stopPolling();
  currentOrderId = null;
  lastEtag = null;
  try {
    const res = await fetch('/api/track-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, id }),
    });
    if (!res.ok) {
      summaryEl.textContent = 'No encontramos un pedido con esos datos.';
      return;
    }
    const data = await res.json();
    const order = data.order || {};
    currentOrderId = order.id || order.order_number || id;
    await fetchInvoice(currentOrderId);
    renderOrder(order);
    lastEtag = null;
    await pollOrder();
    startPolling();
  } catch (e) {
    console.error(e);
    summaryEl.textContent = 'Error al buscar el pedido.';
  }
}

if (typeof window !== 'undefined') {
  window.renderOrderSteps = renderOrderSteps;
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  fetchOrder(emailInput.value.trim(), orderInput.value.trim());
});

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('email')) emailInput.value = params.get('email');
  if (params.get('order')) orderInput.value = params.get('order');
  if (emailInput.value && orderInput.value) {
    fetchOrder(emailInput.value.trim(), orderInput.value.trim());
  }
  updateWhatsAppLink();
  if (window.updateNav) window.updateNav();
});

window.addEventListener('load', updateWhatsAppLink);
