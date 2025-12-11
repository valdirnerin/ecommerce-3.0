import { apiFetch } from './api.js';

const orderNumberEl = document.getElementById('orderNumber');
const orderTotalEl = document.getElementById('orderTotal');
const instructionEl = document.getElementById('instructions');
const itemsEl = document.getElementById('items');
const protectionEl = document.getElementById('protectionBlock');
const shippingEl = document.getElementById('shippingSummary');
const method = document.body.dataset.paymentMethod || 'transferencia';

const currency = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
});

function formatCurrency(value) {
  const num = Number(value);
  return currency.format(Number.isFinite(num) ? num : 0);
}

async function fetchPaymentSettings() {
  try {
    const res = await apiFetch('/api/payment-settings');
    if (!res.ok) return null;
    return res.json();
  } catch (error) {
    console.warn('payment-settings-load-failed', error);
    return null;
  }
}

async function fetchOrder(id) {
  const res = await apiFetch(`/api/orders/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('ORDER_NOT_FOUND');
  const data = await res.json();
  return data.order || data;
}

function renderItems(order) {
  const lines = order.productos || order.items || [];
  if (!Array.isArray(lines) || lines.length === 0) return '<li>No se encontraron ítems.</li>';
  return lines
    .map(
      (it) =>
        `<li><span>${it.name || it.titulo || it.title}</span><span>x${
          it.quantity || it.qty || it.cantidad || 1
        }</span><span>${formatCurrency(it.price || it.precio || it.unit_price)}</span></li>`
    )
    .join('');
}

function resolveTotals(order) {
  const totals = order.totals || {};
  const subtotal = totals.subtotal ?? order.subtotal ?? 0;
  const shipping = totals.shipping ?? order.costo_envio ?? order.shipping_cost ?? 0;
  const grand = totals.grand_total ?? order.total ?? order.total_amount ?? subtotal + shipping;
  return { subtotal, shipping, grand };
}

function renderShipping(order) {
  const cliente = order.cliente || order.customer || {};
  const dir = cliente.direccion || order.shipping_address || {};
  const parts = [dir.calle, dir.numero, dir.localidad, dir.provincia, dir.cp].filter(Boolean);
  const methodLabel = order.metodo_envio || order.shipping_status || order.shipping_method || '';
  const shippingParts = [];
  if (methodLabel) shippingParts.push(`<strong>Método:</strong> ${methodLabel}`);
  if (parts.length) shippingParts.push(`<strong>Dirección:</strong> ${parts.join(', ')}`);
  return shippingParts.join('<br>');
}

function renderProtection(method, settings) {
  const garantiaLink =
    '<a href="/garantia.html" class="trust-link">Garantía y devoluciones</a>';
  const terminosLink =
    '<a href="/pages/terminos.html" class="trust-link">Términos y condiciones</a>';
  if (method === 'efectivo') {
    return `
      <strong>Compra protegida NERINParts</strong>
      <ul>
        <li>Solo cobramos en sucursal o puntos acordados.</li>
        <li>No enviamos cobradores ni pedimos pagos adicionales.</li>
        <li>Revisá ${garantiaLink} y ${terminosLink} antes de abonar.</li>
      </ul>
    `;
  }
  if (method === 'transferencia') {
    return `
      <strong>Compra protegida NERINParts</strong>
      <ul>
        <li>Verificá que los datos bancarios coincidan con los publicados aquí.</li>
        <li>Usá el número de pedido en el concepto y conservá el comprobante.</li>
        <li>Consultá ${garantiaLink} y ${terminosLink} para más respaldo.</li>
      </ul>
    `;
  }
  return `
    <strong>Compra protegida NERINParts</strong>
    <ul>
      <li>El cobro se realiza mediante Mercado Pago con conexión segura.</li>
      <li>Tu pago queda asociado al número de pedido y podrás seguirlo.</li>
      <li>Revisá ${garantiaLink} y ${terminosLink} ante cualquier duda.</li>
    </ul>
  `;
}

function renderInstructions(order, settings) {
  const totals = resolveTotals(order);
  const totalHtml = `<p class="total">Total a abonar: <strong>${formatCurrency(
    totals.grand
  )}</strong></p>`;
  if (method === 'transferencia') {
    const bank = settings?.bank_transfer || {};
    return `
      ${totalHtml}
      <p>Hacé la transferencia únicamente a esta cuenta:</p>
      <ul class="bank-list">
        <li><strong>Titular:</strong> ${bank.account_holder_name || 'NERIN Parts'}</li>
        <li><strong>Banco:</strong> ${bank.bank_name || '—'} (${bank.account_type || 'cuenta'})</li>
        <li><strong>Alias:</strong> ${bank.alias || '—'}</li>
        <li><strong>CBU:</strong> ${bank.cbu || '—'}</li>
        <li><strong>CUIT:</strong> ${bank.cuit || '—'}</li>
      </ul>
      <p>En el concepto colocá tu número de pedido y enviá el comprobante por mail o WhatsApp.</p>
      ${
        bank.additional_instructions
          ? `<p>${bank.additional_instructions}</p>`
          : ''
      }
      <p>Tu módulo se reserva hasta que recibamos y validemos el comprobante.</p>
    `;
  }
  const pickupText =
    settings?.cash_payment?.instructions_pickup ||
    'Podés abonar en efectivo al retirar tu pedido. Traé tu DNI y número de pedido.';
  return `
    ${totalHtml}
    <p>${pickupText}</p>
    <p>Tu pedido se reserva hasta confirmar el pago en el punto de entrega.</p>
  `;
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order');
  if (!orderId) {
    instructionEl.innerHTML = '<p>No encontramos el número de pedido.</p>';
    return;
  }
  try {
    const [settings, order] = await Promise.all([
      fetchPaymentSettings(),
      fetchOrder(orderId),
    ]);
    const totals = resolveTotals(order);
    orderNumberEl.textContent = order.order_number || order.id || order.external_reference || orderId;
    orderTotalEl.textContent = formatCurrency(totals.grand);
    itemsEl.innerHTML = renderItems(order);
    instructionEl.innerHTML = renderInstructions(order, settings);
    protectionEl.innerHTML = renderProtection(method, settings);
    shippingEl.innerHTML = renderShipping(order);
  } catch (error) {
    console.error(error);
    instructionEl.innerHTML = '<p>No pudimos cargar la información del pedido.</p>';
  }
}

init();
