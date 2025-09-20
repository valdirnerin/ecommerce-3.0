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
    const res = await fetch(`/api/invoice-files/${encodeURIComponent(orderId)}`);
    if (res.ok) {
      invoiceInfo = await res.json();
    } else {
      invoiceInfo = null;
    }
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

function deriveStage(order = {}) {
  const pay = getPaymentCode(order);
  const ship = getShippingCode(order);
  if (ship === 'delivered') return 5;
  if (ship === 'shipped') return 4;
  if (ship === 'preparing') return 3;
  if (pay === 'approved') return 2;
  return 1;
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
  const markup = `
    <ol class="order-progress" role="list" aria-label="Estado del pedido">
      <li class="step" data-step="1"><span class="icon">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v10H4zM4 7l4-3h8l4 3"/></svg>
      </span><span class="label">Pedido recibido</span></li>
      <li class="step" data-step="2"><span class="icon">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v10H3zM3 10h18"/></svg>
      </span><span class="label">Pago acreditado</span></li>
      <li class="step" data-step="3"><span class="icon">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M6 17l12-12 3 3-12 12H6z"/></svg>
      </span><span class="label">Preparando el pedido</span></li>
      <li class="step" data-step="4"><span class="icon">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h12v10H3zM15 10h4l2 3v4h-6z"/></svg>
      </span><span class="label">Enviado</span></li>
      <li class="step" data-step="5"><span class="icon">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7l-9 9-5-5"/></svg>
      </span><span class="label">Entregado</span></li>
    </ol>
  `;
  progressContainer.innerHTML = markup;
  const list = progressContainer.querySelector('.order-progress');
  if (!list) return;
  const stage = deriveStage(order);
  list.style.setProperty('--progress', `${((stage - 1) / 4) * 100}%`);
  list.querySelectorAll('.step').forEach((li) => {
    const n = Number(li.dataset.step);
    const state = n < stage ? 'done' : n === stage ? 'current' : 'todo';
    li.dataset.state = state;
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
    ${invoiceInfo && invoiceInfo.url
      ? `<p><a href="${invoiceInfo.url}" target="_blank" rel="noopener">Ver/Descargar factura</a></p>`
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
