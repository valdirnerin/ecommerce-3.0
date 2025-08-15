const receipt = document.getElementById('card');

function showToast(message) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

function getNRN() {
  const p = new URLSearchParams(location.search);
  return (
    p.get('nrn') ||
    p.get('order') ||
    p.get('o') ||
    p.get('external_reference') ||
    localStorage.getItem('nerin.lastNRN') ||
    localStorage.getItem('mp_last_nrn') ||
    localStorage.getItem('mp_last_pref')
  );
}

function resolveTotal(order = {}, payment = {}, merchant = {}, items = []) {
  const sum = items.reduce(
    (s, i) => s + ((i.unit_price ?? i.price ?? 0) * (i.quantity ?? 1)),
    0
  );
  return (
    order.total ??
    order.totalAmount ??
    payment.transaction_amount ??
    merchant.paid_amount ??
    sum
  );
}

function mapData(data = {}, fallbackId) {
  const order = data.order || {};
  const payment = data.payment || {};
  const merchant = data.merchant_order || {};
  const preference = data.preference || {};
  const items = order.items || preference.items || [];
  const nrn =
    order.external_reference ||
    payment.external_reference ||
    order.numeroOrden ||
    fallbackId;
  const statusRaw = String(
    payment.status || order.paymentStatus || order.payment_status || ''
  ).toLowerCase();
  let status = 'pendiente';
  if (['approved', 'aprobado', 'pagado'].includes(statusRaw)) status = 'aprobado';
  else if (['rejected', 'rechazado'].includes(statusRaw)) status = 'rechazado';
  const total = resolveTotal(order, payment, merchant, items);
  const tracking =
    order.tracking_number || order.tracking || order.seguimiento || '';
  const email =
    order.cliente?.email || order.buyer?.email || order.email || null;
  const fecha = new Date(order.created_at || order.fecha || Date.now());
  return { nrn, items, status, total, tracking, email, fecha };
}

const currency = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS'
});

function render(info) {
  const { nrn, items, status, total, tracking, fecha } = info;
  const statusClass = status;
  const title =
    status === 'aprobado'
      ? 'Pago aprobado'
      : status === 'rechazado'
      ? 'Pago rechazado'
      : 'Pago en revisión';
  const guide =
    status === 'pendiente'
      ? '<p class="guide">Te avisamos por email. Podés seguir el estado con tu número de pedido.</p>'
      : '';
  const itemsHtml = items
    .map(
      (i) =>
        `<li class="receipt-row"><span>${
          i.title || i.name || ''
        } x${i.quantity || 1}</span><span>${currency.format(
          i.unit_price ?? i.price ?? 0
        )}</span></li>`
    )
    .join('');
  const totalDisplay =
    total > 0
      ? currency.format(total)
      : '<span class="badge pendiente">Total no disponible</span>';
  if (!(total > 0)) console.warn('Total no disponible para pedido', nrn);
  const trackingHtml = tracking
    ? `<p class="receipt-row"><span id="track">${tracking}</span><button class="copy-btn" data-copy="${tracking}" aria-label="Copiar número de seguimiento">📋</button></p>`
    : '<p>Aún sin número de envío</p>';
  receipt.innerHTML = `
    <div class="icon-hero ${statusClass}" aria-hidden="true">
      ${
        status === 'aprobado'
          ? '<svg viewBox="0 0 24 24"><path class="draw" d="M20 6L9 17l-5-5"/></svg>'
          : status === 'pendiente'
          ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2 2"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>'
      }
    </div>
    <h1>${title}</h1>
    <p class="date">${fecha.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}</p>
    ${guide}
    <div class="receipt-grid">
      <div class="receipt-card">
        <h2>Tu pedido</h2>
        <p class="receipt-row">Nº de pedido <span id="orderNumber">${nrn}</span><button class="copy-btn" data-copy="${nrn}" aria-label="Copiar número de pedido">📋</button></p>
        <p class="receipt-row">Estado de pago: <span class="badge ${statusClass}">${status}</span></p>
        <ul class="items">
          ${itemsHtml}
          <li class="receipt-row total-line"><span>Total</span><span id="total">${totalDisplay}</span></li>
        </ul>
      </div>
      <div class="receipt-card">
        <h2>Seguimiento</h2>
        ${trackingHtml}
      </div>
    </div>
    <div class="receipt-actions">
      <a class="button primary" id="trackLink" href="/seguimiento.html">Ver estado del pedido</a>
      <button class="button secondary" id="shareBtn" type="button">Compartir</button>
      <a class="button secondary" href="/index.html">Volver al inicio</a>
    </div>
  `;
  attachHandlers();
}

function attachHandlers() {
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy || '');
        showToast('Copiado');
      } catch (_) {}
    });
  });
  const shareBtn = document.getElementById('shareBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const url = location.href;
      try {
        if (navigator.share) {
          await navigator.share({ title: 'Mi pedido NERIN', url });
        } else {
          await navigator.clipboard.writeText(url);
          showToast('Enlace copiado');
        }
      } catch (_) {}
    });
  }
}

function persist(info) {
  if (info.nrn) localStorage.setItem('nerin.lastNRN', info.nrn);
  let email = info.email || localStorage.getItem('nerin.lastEmail');
  if (!email) {
    const tmp = prompt('Ingresá tu email para seguimiento');
    if (tmp) email = tmp.trim();
  }
  if (email) {
    localStorage.setItem('nerin.lastEmail', email);
  }
  const link = document.getElementById('trackLink');
  if (link && info.nrn) {
    const qs = new URLSearchParams();
    qs.set('order', info.nrn);
    if (email) qs.set('email', email);
    link.href = `/seguimiento.html?${qs.toString()}`;
  }
}

async function init() {
  const id = getNRN();
  if (!id) {
    receipt.innerHTML = '<p>No encontramos la orden.</p>';
    return;
  }
  let data = {};
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}`);
    if (res.ok) data = await res.json();
  } catch (_) {}
  const info = mapData(data, id);
  render(info);
  persist(info);
  localStorage.removeItem('mp_last_pref');
  localStorage.removeItem('mp_last_nrn');
}

document.addEventListener('DOMContentLoaded', init);
