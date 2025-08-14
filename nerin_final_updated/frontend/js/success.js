const card = document.getElementById('card');

function showToast(message) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1500);
}

function getIdentifier() {
  const params = new URLSearchParams(location.search);
  return (
    params.get('nrn') ||
    params.get('order') ||
    params.get('o') ||
    params.get('external_reference') ||
    localStorage.getItem('mp_last_nrn') ||
    localStorage.getItem('mp_last_pref')
  );
}

const fmt = (n) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(n ?? 0);

async function init() {
  const id = getIdentifier();
  if (!id) {
    card.innerHTML = '<p>No encontramos la orden.</p>';
    return;
  }
  let order;
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}`);
    if (res.ok) {
      const data = await res.json();
      order = data.order;
    }
  } catch (e) {}
  order = order || { numeroOrden: id, payment_status: 'aprobado', items: [], total: 0 };
  render(order);
  localStorage.removeItem('mp_last_pref');
  localStorage.removeItem('mp_last_nrn');
}

function render(order) {
  const fecha = new Date(order.created_at || order.fecha || Date.now());
  const estado = order.payment_status || order.estado_pago || 'aprobado';
  const tracking = order.tracking_number || order.seguimiento || '';
  const items = order.items || [];
  const itemsHtml = items
    .map((i) => `<li><span>${i.name} x${i.quantity}</span><span>$ ${fmt(i.price)}</span></li>`)
    .join('');
  const badge =
    estado === 'rechazado' ? 'rechazado' : estado === 'pendiente' ? 'pendiente' : 'aprobado';
  card.innerHTML = `
    <h1>Pago ${badge === 'aprobado' ? 'aprobado' : badge === 'pendiente' ? 'pendiente' : 'rechazado'}</h1>
    <p class="date" id="fecha"></p>
    <section class="section">
      <h2>Tu pedido</h2>
      <p class="order-number">Nº de pedido: <span id="orderNumber">${order.numeroOrden}</span><button id="copyBtn" class="copy-btn" aria-label="Copiar número de pedido">📋</button></p>
      <p>Estado de pago: <span class="badge ${badge}">${estado}</span></p>
      <ul class="items">
        ${itemsHtml}
        <li class="total-line"><span>Total</span><span id="total"></span></li>
      </ul>
    </section>
    <section class="section">
      <h2>Seguimiento</h2>
      ${
        tracking
          ? `<p class="order-number"><span id="track">${tracking}</span><button id="copyTrack" class="copy-btn" aria-label="Copiar número de seguimiento">📋</button></p>`
          : '<p>Aún sin número de envío</p>'
      }
    </section>
    <div class="actions">
      <a class="button primary" id="trackLink" href="/seguimiento.html?order=${encodeURIComponent(order.numeroOrden)}">Ver estado del pedido</a>
      <button class="button secondary" id="shareBtn" type="button">Compartir</button>
      <a class="button secondary" href="/index.html">Volver al inicio</a>
    </div>
  `;
  document.getElementById('fecha').textContent = fecha.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  document.getElementById('total').textContent = `$ ${fmt(order.total)}`;
  const copyBtn = document.getElementById('copyBtn');
  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(order.numeroOrden);
    showToast('Copiado');
  });
  const copyTrack = document.getElementById('copyTrack');
  if (copyTrack) {
    copyTrack.addEventListener('click', async () => {
      await navigator.clipboard.writeText(tracking);
      showToast('Copiado');
    });
  }
  const shareBtn = document.getElementById('shareBtn');
  shareBtn.addEventListener('click', async () => {
    const shareData = {
      title: `Pedido NERIN ${order.numeroOrden}`,
      text: `Estado: ${estado} – Total: $ ${fmt(order.total)}`,
      url: location.href
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
        showToast('Enlace copiado');
      }
    } catch (e) {}
  });
}

document.addEventListener('DOMContentLoaded', init);
