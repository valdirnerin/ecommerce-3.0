import { apiFetch } from "./api.js";

// Módulo para consultar el estado de un pedido

const form = document.getElementById('trackForm');
const emailInput = document.getElementById('email');
const orderInput = document.getElementById('orderId');
const summaryEl = document.getElementById('orderSummary');
const progressContainer = document.getElementById('orderProgress');
const alertEl = document.getElementById('orderAlert');
const contactBtn = document.getElementById('contactWhatsApp');
const submitBtn = document.getElementById('trackSubmit');

let invoiceInfo = null;
let pollTimer = null;
let currentOrderId = null;
let lastEtag = null;

const PAYMENT_CANCEL_CODES = new Set(['rejected', 'charged_back', 'refunded']);
const POLL_INTERVAL_MS = 15000;

const ORDER_STEPS = [
  'Pedido recibido',
  'Pago acreditado',
  'Preparando el pedido',
  'Enviado',
  'Entregado',
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

function normalizeStep(label) {
  const normalized = normalizeStatusValue(label);
  if (!normalized) return 1;
  if (/entreg/.test(normalized)) return 5;
  if (/(enviad|shipp)/.test(normalized)) return 4;
  if (/(prepar(a|ando|cion)|alist|arm)/.test(normalized)) return 3;
  if (/(pagad|aprob|approv|paid)/.test(normalized)) return 2;
  return 1;
}

function buildOrderStepper() {
  const list = document.createElement('ol');
  list.className = 'order-steps';
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Progreso del pedido');
  list.style.setProperty('--total', String(ORDER_STEPS.length));

  ORDER_STEPS.forEach((step, index) => {
    const item = document.createElement('li');
    item.className = 'step';
    item.dataset.step = String(index + 1);

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'lbl';
    label.textContent = typeof step === 'string' ? step : step?.label ?? '';

    item.append(dot, label);
    list.appendChild(item);
  });

  return list;
}

function isDomContainer(value) {
  return value && typeof value === 'object' && typeof value.querySelector === 'function';
}

function ensureOrderStepper(target = progressContainer) {
  const container = target || document.getElementById('orderProgress');
  if (!container) return null;

  let list = container.classList?.contains('order-steps') ? container : null;
  if (!list && isDomContainer(container)) {
    list = container.querySelector('.order-steps');
  }

  if (!list) {
    list = buildOrderStepper();
    if (isDomContainer(container) && container !== list) {
      container.innerHTML = '';
      container.appendChild(list);
    }
  }

  if (list) {
    list.style.setProperty('--total', String(ORDER_STEPS.length));
  }

  if (isDomContainer(container) && container !== list && container.style) {
    container.style.display = 'block';
  }

  return list;
}

function pickStatusValue(values) {
  for (const value of values) {
    if (value == null) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return '';
}

function renderOrderSteps(rootOrStatuses = progressContainer, maybeStatuses) {
  let container = rootOrStatuses;
  let statuses = maybeStatuses;

  if (!isDomContainer(container)) {
    statuses = container || {};
    container = isDomContainer(maybeStatuses) ? maybeStatuses : progressContainer;
  }

  statuses = statuses || {};

  const list = ensureOrderStepper(container);
  if (!list) return null;

  const paymentValue = pickStatusValue([
    statuses.payment_status,
    statuses.estado_pago,
    statuses.paymentStatus,
    statuses.payment_status_code,
    statuses.paymentStatusCode,
    statuses.status,
  ]);
  const shippingValue = pickStatusValue([
    statuses.shipping_status,
    statuses.estado_envio,
    statuses.shippingStatus,
    statuses.shipping_status_label,
    statuses.shipping_status_code,
    statuses.shippingStatusCode,
  ]);

  const normalizedPayment = normalizeStep(paymentValue);
  const normalizedShipping = normalizeStep(shippingValue);
  const resolvedPayment = resolveStepFromStatus(paymentValue, 'payment') || 0;
  const resolvedShipping = resolveStepFromStatus(shippingValue, 'shipping') || 0;

  const paymentStep = Math.max(normalizedPayment, resolvedPayment, 1);
  const shippingStep = Math.max(normalizedShipping, resolvedShipping, 1);
  const activeStep = Math.min(
    Math.max(paymentStep, shippingStep, 1),
    ORDER_STEPS.length,
  );

  list.style.setProperty('--active', String(activeStep));

  const items = Array.from(list.querySelectorAll('.step'));
  items.forEach((item, index) => {
    const stepNumber = index + 1;
    const isDone = stepNumber < activeStep;
    const isCurrent = stepNumber === activeStep;
    item.classList.toggle('is-done', isDone);
    item.classList.toggle('is-current', isCurrent);
    if (isCurrent) {
      item.setAttribute('aria-current', 'step');
    } else {
      item.removeAttribute('aria-current');
    }
  });

  return {
    list,
    activeStep,
    paymentStep,
    shippingStep,
  };
}

function updateWhatsAppLink(maybeConfig) {
  const cfg = maybeConfig?.detail || maybeConfig || window.NERIN_CONFIG;
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
    const res = await apiFetch(
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

function showAlert(message, variant = 'error') {
  if (!alertEl) return;
  alertEl.className = `order-alert is-${variant}`;
  alertEl.textContent = message;
  alertEl.style.display = 'block';
}

function setLoading(isLoading) {
  if (!submitBtn) return;
  submitBtn.disabled = !!isLoading;
  submitBtn.classList.toggle('is-loading', !!isLoading);
  submitBtn.textContent = isLoading ? 'Consultando…' : 'Consultar pedido';
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

  const stepInfo = renderOrderSteps(progressContainer, {
    payment_status: order.payment_status,
    estado_pago: order.estado_pago,
    paymentStatus,
    payment_status_code: order.payment_status_code,
    paymentStatusCode: order.paymentStatusCode,
    status: order.status,
    shipping_status: order.shipping_status,
    estado_envio: order.estado_envio,
    shippingStatus,
    shipping_status_label: order.shipping_status_label,
    shipping_status_code: order.shipping_status_code,
    shippingStatusCode: order.shippingStatusCode,
  });

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
  if (alertMessage) showAlert(alertMessage, 'warning');
  else hideAlert();
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `$${number.toLocaleString('es-AR')}`;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function humanizeLabel(value, fallback = 'A confirmar') {
  const cleaned = normalizeStatusValue(value).replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return fallback;
  const map = {
    'mercado pago': 'Mercado Pago',
    approved: 'Aprobado',
    pending: 'Pendiente de pago',
    pending_payment: 'Pendiente de pago',
    rejected: 'Rechazado',
    refunded: 'Reintegrado',
    charged_back: 'Contracargo',
    received: 'Pedido recibido',
    preparing: 'Preparando el pedido',
    shipped: 'Enviado',
    delivered: 'Entregado',
    canceled: 'Cancelado',
  };
  return map[cleaned] || cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
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
  const paymentLabel = humanizeLabel(order.payment_status || order.estado_pago, 'Pendiente de pago');
  const shippingLabel = humanizeLabel(order.shipping_status || order.estado_envio, 'A confirmar');
  const rawDate = order.fecha || order.created_at || order.createdAt || order.date;
  const formattedDate = rawDate ? new Date(rawDate).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  const itemsHtml = formatItems(order);
  const totalValue = order.total ?? order.total_amount ?? order.totals?.grand_total ?? null;
  const totalLabel = formatCurrency(totalValue) || '$0';
  const shippingCost = typeof order.costo_envio === 'number' ? order.costo_envio : order.shipping_cost;
  const shippingCostLabel = formatCurrency(shippingCost);
  const trackingCode = order.seguimiento || order.tracking || '';
  const carrier = order.transportista || order.carrier || '';
  const paymentMethod = humanizeLabel(order.metodo_pago || order.payment_method, 'A confirmar');
  const destination = order.destino || order.address || order.shipping_address?.street || '';
  const province = order.provincia_envio || order.shipping_address?.province || '';
  const orderInvoices = Array.isArray(order.invoices) ? order.invoices : [];
  const activeInvoice = orderInvoices.find((inv) => inv && !inv.deleted_at && inv.url);
  const invoiceToShow =
    (invoiceInfo && invoiceInfo.url ? invoiceInfo : null) || activeInvoice || null;
  if (!invoiceInfo && invoiceToShow) {
    invoiceInfo = invoiceToShow;
  }

  summaryEl.innerHTML = `
    <div class="order-card__header order-card__header--strong">
      <div><p class="order-eyebrow">Resultado de seguimiento</p><h2>Pedido #${escapeHtml(orderId || '-')}</h2></div>
      <span class="status-chip status-chip--neutral"><span class="icon">${iconClock()}</span>Última actualización: ${escapeHtml(formattedDate)}</span>
    </div>
    <div class="order-card__grid order-card__grid--primary">
      <div class="order-data"><span class="icon">${iconBadge()}</span><span>Estado del pedido</span><strong>${escapeHtml(shippingLabel)}</strong></div>
      <div class="order-data"><span class="icon">${iconWallet()}</span><span>Estado del pago</span><strong>${escapeHtml(paymentLabel)}</strong></div>
      <div class="order-data"><span class="icon">${iconTruck()}</span><span>Estado del envío</span><strong>${escapeHtml(shippingLabel)}</strong></div>
      <div class="order-data"><span class="icon">${iconHash()}</span><span>Tracking</span><strong>${escapeHtml(trackingCode || 'A confirmar')}</strong></div>
      <div class="order-data"><span class="icon">${iconPackage()}</span><span>Empresa de envío</span><strong>${escapeHtml(carrier || 'A confirmar')}</strong></div>
      <div class="order-data"><span class="icon">${iconMapPin()}</span><span>Destino</span><strong>${escapeHtml(destination || 'Coordinación por WhatsApp')}${province ? ` (${escapeHtml(province)})` : ''}</strong></div>
    </div>
    <div class="order-card__grid">
      <div class="order-data order-data--muted"><span>Método de pago</span><strong>${escapeHtml(paymentMethod)}</strong></div>
      <div class="order-data order-data--muted"><span>Total</span><strong>${escapeHtml(totalLabel)}</strong></div>
    </div>
    ${itemsHtml ? `<div class="order-items"><h3>Productos del pedido</h3><ul>${itemsHtml}</ul></div>` : ''}
    <div class="order-card__footer">
      ${shippingCostLabel ? `<span class="status-chip">Envío: ${shippingCostLabel}</span>` : ''}
      ${invoiceToShow && invoiceToShow.url
      ? `<a class="status-chip status-chip--link" href="${invoiceToShow.url}" target="_blank" rel="noopener">Ver/Descargar factura</a>`
      : '<span class="status-chip status-chip--neutral">Factura pendiente</span>'}
    </div>
  `;
  summaryEl.style.display = 'block';
  renderOrderProgress(order);
}
function iconBase(path) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`; }
const iconClock = () => iconBase('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>');
const iconBadge = () => iconBase('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m9 14 2 2 4-4"/>');
const iconWallet = () => iconBase('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M16 12h.01"/><path d="M6 9h6"/>');
const iconTruck = () => iconBase('<path d="M10 17H3V7h11v10h-1"/><path d="M14 10h4l3 3v4h-2"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="17.5" cy="17.5" r="1.5"/>');
const iconHash = () => iconBase('<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>');
const iconPackage = () => iconBase('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 12 4 7.5M12 12l8-4.5"/>');
const iconMapPin = () => iconBase('<path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.3"/>');

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
    const res = await apiFetch(`/api/orders/${encodeURIComponent(currentOrderId)}`, {
      headers,
    });
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
  summaryEl.innerHTML = '<p class="summary-loading">Estamos buscando tu pedido…</p>';
  setLoading(true);
  summaryEl.style.display = 'block';
  stopPolling();
  currentOrderId = null;
  lastEtag = null;
  try {
    const res = await apiFetch('/api/track-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, id }),
    });
    if (!res.ok) {
      showAlert('No encontramos un pedido con esos datos. Revisá el email y número de pedido.', 'error');
      summaryEl.innerHTML = '<p class="summary-empty">No se encontró información para esta búsqueda.</p>' ;
      setLoading(false);
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
    showAlert('Pedido encontrado. Este es el estado más reciente de tu compra.', 'success');
    setLoading(false);
  } catch (e) {
    console.error(e);
    showAlert('Tuvimos un inconveniente al consultar el pedido. Intentá nuevamente.', 'error');
    summaryEl.innerHTML = '<p class="summary-empty">No pudimos completar la consulta.</p>' ;
    setLoading(false);
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
document.addEventListener('nerin:config-loaded', updateWhatsAppLink);
