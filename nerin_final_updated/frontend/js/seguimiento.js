// Módulo para consultar el estado de un pedido

const form = document.getElementById('trackForm');
const emailInput = document.getElementById('email');
const orderInput = document.getElementById('orderId');
const summaryEl = document.getElementById('orderSummary');
const trackerEl = document.getElementById('tracker');
const contactBtn = document.getElementById('contactWhatsApp');
let invoiceInfo = null;

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
  try {
    const res = await fetch(`/api/invoice-files/${orderId}`);
    if (res.ok) {
      invoiceInfo = await res.json();
    } else {
      invoiceInfo = null;
    }
  } catch (_) {
    invoiceInfo = null;
  }
}

async function fetchOrder(email, id) {
  summaryEl.style.display = 'none';
  trackerEl.style.display = 'none';
  if (!email || !id) return;
  summaryEl.textContent = 'Buscando...';
  try {
    const res = await fetch('/api/track-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, id })
    });
    if (!res.ok) {
      summaryEl.textContent = 'No encontramos un pedido con esos datos.';
      return;
    }
    const data = await res.json();
    await fetchInvoice(data.order.id);
    renderOrder(data.order);
  } catch (e) {
    console.error(e);
    summaryEl.textContent = 'Error al buscar el pedido.';
  }
}

function renderOrder(o) {
  const items = (o.productos || []).map(p => `<li>${p.name} x${p.quantity} - $${p.price.toLocaleString('es-AR')}</li>`).join('');
  summaryEl.innerHTML = `
    <p><strong>Número de pedido:</strong> ${o.id}</p>
    <p><strong>Estado del pago:</strong> ${o.estado_pago}</p>
    <p><strong>Estado del envío:</strong> ${o.estado_envio}</p>
    <p><strong>Fecha:</strong> ${new Date(o.fecha).toLocaleDateString('es-AR')}</p>
    <ul>${items}</ul>
    <p><strong>Total:</strong> $${o.total.toLocaleString('es-AR')}</p>
    ${o.metodo_pago ? `<p><strong>Método de pago:</strong> ${o.metodo_pago}</p>` : ''}
    ${o.destino ? `<p><strong>Envío a:</strong> ${o.destino}</p>` : '<p><em>Coordinación de envío por WhatsApp</em></p>'}
    ${o.cliente && o.cliente.email ? `<p><strong>Email:</strong> ${o.cliente.email}</p>` : ''}
    ${o.seguimiento ? `<p><strong>Nº de seguimiento:</strong> ${o.seguimiento}${o.transportista ? ' (' + o.transportista + ')' : ''}</p>` : ''}
    ${invoiceInfo && invoiceInfo.url ? `<p><a href="${invoiceInfo.url}" target="_blank">Ver/Descargar factura</a></p>` : '<p><em>Factura pendiente</em></p>'}
  `;
  summaryEl.style.display = 'block';
  renderTracker(o);
}

function renderTracker(o) {
  const steps = [
    'Pedido recibido',
    'Pago acreditado',
    'Preparando el pedido',
    'Enviado',
    'Entregado'
  ];
  let current = 0;
  if (o.estado_pago === 'pagado') current = 1;
  if (o.estado_envio === 'en preparación') current = 2;
  if (o.estado_envio === 'enviado') current = 3;
  if (o.estado_envio === 'entregado') current = 4;
  trackerEl.innerHTML = steps.map((s, i) => {
    let cls = 'step todo';
    if (i < current) cls = 'step done';
    else if (i === current) cls = 'step current';
    return `<li class="${cls}">${s}</li>`;
  }).join('');
  trackerEl.style.display = 'block';
}

form.addEventListener('submit', ev => {
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
