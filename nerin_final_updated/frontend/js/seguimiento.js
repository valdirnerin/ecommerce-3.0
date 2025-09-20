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

const STEP_LABELS = [
  'Pedido recibido',
  'Pago acreditado',
  'Preparando el pedido',
  'Enviado',
  'Entregado',
];

const STEP_ICONS = {
  done:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"></circle><path d="M9 12.5l2 2 4-4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  current:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle><circle cx="12" cy="12" r="4" fill="currentColor"></circle></svg>',
  todo:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle></svg>',
};

function normalizeStatusValue(value) {
  if (!value && value !== 0) return '';
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function computeSteps(order = {}) {
  const steps = STEP_LABELS.map((label) => ({ label, state: 'todo' }));
  if (!steps.length) return steps;

  steps[0].state = 'done';

  const payValue = normalizeStatusValue(
    order.payment_status ||
      order.estado_pago ||
      order.payment_status_code ||
      order.status ||
      '',
  );
  const shipSource =
    order.shipping_status ||
    order.estado_envio ||
    order.shipping_status_label ||
    order.shipping_status_code ||
    '';
  const shipValue = normalizeStatusValue(shipSource);
  const payCode = getPaymentCode(order);
  const shipCode = getShippingCode(order);

  const isPaid =
    payCode === 'approved' ||
    payValue === 'pagado' ||
    payValue === 'approved' ||
    payValue === 'aprobado';

  const shipString = shipValue || '';
  const denyShipped = /\bno\s+enviado\b|\bsin\s+envi/.test(shipString);
  const denyDelivered = /\bno\s+entregado\b|\bsin\s+entreg/.test(
    shipString,
  );
  const denyPreparing = /\bno\s+prepar|\bsin\s+prepar/.test(shipString);
  const isPreparing =
    (shipCode === 'preparing' ||
      shipString === 'en preparacion' ||
      shipString === 'preparando' ||
      shipString.includes('prepar')) &&
    !denyPreparing;
  let isShipped =
    shipCode === 'shipped' ||
    shipString === 'enviado' ||
    shipString === 'envio' ||
    shipString === 'enviando' ||
    shipString.includes(' enviado');
  if (denyShipped) isShipped = false;
  let isDelivered =
    shipCode === 'delivered' ||
    shipString === 'entregado' ||
    shipString === 'entregada' ||
    shipString.includes('entregado');
  if (denyDelivered) isDelivered = false;

  if (isDelivered) {
    steps[1].state = 'done';
    steps[2].state = 'done';
    steps[3].state = 'done';
    steps[4].state = 'done';
    return steps;
  }

  if (isShipped) {
    steps[1].state = 'done';
    steps[2].state = 'done';
    steps[3].state = 'done';
    steps[4].state = 'current';
    return steps;
  }

  if (isPreparing) {
    steps[1].state = 'done';
    steps[2].state = 'current';
    return steps;
  }

  if (isPaid) {
    steps[1].state = 'done';
    return steps;
  }

  steps[1].state = 'current';
  return steps;
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
  const steps = computeSteps(order);
  if (!steps.length) {
    progressContainer.style.display = 'none';
    progressContainer.innerHTML = '';
    return;
  }
  const markup = `
    <ol class="order-progress" role="list" aria-label="Estado del pedido">
      ${steps
        .map(
          (step, index) => `
            <li class="step ${step.state}" data-step="${index + 1}">
              <span class="icon" aria-hidden="true">${
                STEP_ICONS[step.state] || STEP_ICONS.todo
              }</span>
              <span class="label">${step.label}</span>
            </li>
          `,
        )
        .join('')}
    </ol>
  `;
  progressContainer.innerHTML = markup;
  const list = progressContainer.querySelector('.order-progress');
  if (!list) return;
  const currentIndex = steps.findIndex((step) => step.state === 'current');
  const lastDoneIndex = steps.reduce(
    (acc, step, idx) => (step.state === 'done' ? idx : acc),
    -1,
  );
  const progressIndex = Math.max(currentIndex, lastDoneIndex, 0);
  const progressValue =
    steps.length > 1 ? (progressIndex / (steps.length - 1)) * 100 : 0;
  list.style.setProperty('--progress', `${progressValue}%`);
  list.querySelectorAll('.step').forEach((li, idx) => {
    const state = steps[idx]?.state || 'todo';
    li.dataset.state = state;
    li.classList.remove('done', 'current', 'todo');
    li.classList.add(state);
    if (state === 'current') li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });
  progressContainer.style.display = 'block';

  const shippingCode = getShippingCode(order);
  const paymentCode = getPaymentCode(order);
  let alertMessage = '';
  if (shippingCode === 'canceled') alertMessage = 'Pedido cancelado';
  if (PAYMENT_CANCEL_CODES.has(paymentCode)) {
    alertMessage = alertMessage ? `${alertMessage} / Pago revertido` : 'Pago revertido';
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
