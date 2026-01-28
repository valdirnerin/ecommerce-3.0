import { apiFetch } from "./api.js";
import { buildPixelContents, trackPixelOnce } from "./meta-pixel.js";

const API_BASE_URL = ''; // dejamos vacío para usar rutas relativas
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const formDatos = document.getElementById('formDatos');
const formEnvio = document.getElementById('formEnvio');
const costoEl = document.getElementById('costoEnvio');
const metodoSelect = document.getElementById('metodo');
const resumenEl = document.getElementById('resumen');
const resumenPaso2El = document.getElementById('resumenPaso2');
const confirmarBtn = document.getElementById('confirmar');
const emailInput = document.getElementById('email');
const emailError = document.getElementById('emailError');
const pagoRadios = document.getElementsByName('pago');
const protectionNote = document.getElementById('protectionNote');
const metodoInfo = document.getElementById('metodoInfo');

const cart = JSON.parse(localStorage.getItem('nerinCart') || '[]');
if (cart.length === 0) {
  window.location.href = '/cart.html';
}
const { contents: checkoutContents, value: checkoutValue } = buildPixelContents(cart);
const checkoutIds = checkoutContents.map((item) => item.id).filter(Boolean);
if (checkoutIds.length) {
  trackPixelOnce(
    "InitiateCheckout",
    {
      content_type: "product",
      content_ids: checkoutIds,
      contents: checkoutContents,
      value: checkoutValue,
      currency: "ARS",
    },
    checkoutIds.join("|"),
  );
}
if (typeof window.NERIN_TRACK_EVENT === "function") {
  window.NERIN_TRACK_EVENT("checkout_start", {
    step: "Checkout",
    value: checkoutValue,
    metadata: {
      items: cart.length,
    },
  });
}

let datos = {};
let envio = {};
let paymentSettings = null;
let allowedCashMethods = [];
let lastTrackedPaymentMethod = null;
function safeParseLocalStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn(`No se pudo leer ${key} desde localStorage`, error);
    return null;
  }
}

function setFieldValue(id, value) {
  if (value == null) return;
  const el = document.getElementById(id);
  if (el) {
    el.value = value;
  }
}

function getSelectedPaymentMethod() {
  const selected = Array.from(pagoRadios).find((r) => r.checked);
  return selected ? selected.value : 'mp';
}

async function loadPaymentSettings() {
  try {
    const res = await apiFetch('/api/payment-settings');
    if (!res.ok) return;
    const data = await res.json();
    paymentSettings = data;
    if (data?.cash_payment?.allowed_shipping_methods) {
      allowedCashMethods = data.cash_payment.allowed_shipping_methods.map((m) =>
        String(m).toLowerCase()
      );
    }
    updateMetodoInfo();
  } catch (error) {
    console.warn('No se pudo cargar la configuración de pagos', error);
  }
}

const storedCheckout = safeParseLocalStorage('nerinUserInfo');
const storedProfile = storedCheckout || safeParseLocalStorage('nerinUserProfile');
const fallbackName = (localStorage.getItem('nerinUserName') || '').trim();
const fallbackEmail = (localStorage.getItem('nerinUserEmail') || '').trim();
const initialData = storedProfile && typeof storedProfile === 'object' ? { ...storedProfile } : {};

if (!initialData.nombre && fallbackName) {
  const [first = '', ...rest] = fallbackName.split(/\s+/);
  initialData.nombre = first || fallbackName;
  initialData.apellido = initialData.apellido || rest.join(' ');
}

if (!initialData.email && fallbackEmail) {
  initialData.email = fallbackEmail;
}

const address =
  initialData.direccion ||
  initialData.address ||
  initialData.direccion_envio ||
  {};

setFieldValue('nombre', initialData.nombre || initialData.name || '');
setFieldValue('apellido', initialData.apellido || initialData.lastName || initialData.apellidos || '');
setFieldValue('email', initialData.email || initialData.mail || '');
setFieldValue('telefono', initialData.telefono || initialData.phone || initialData.celular || '');
setFieldValue(
  'provincia',
  initialData.provincia || address.provincia || address.estado || initialData.state || ''
);
setFieldValue('localidad', initialData.localidad || address.localidad || address.ciudad || '');
setFieldValue('calle', initialData.calle || address.calle || address.street || '');
setFieldValue('numero', initialData.numero || address.numero || address.number || '');
setFieldValue('piso', initialData.piso || address.piso || address.apartamento || '');
setFieldValue('cp', initialData.cp || address.cp || address.zip || address.codigo_postal || '');
const metodoPreferido =
  initialData.metodo || initialData.metodo_envio || initialData.shippingMethod || envio.metodo;
if (metodoPreferido) {
  setFieldValue('metodo', metodoPreferido);
}


// Inicializar los pasos: mostrar Paso 1 y ocultar los demás
step1.style.display = 'block';
step2.style.display = 'none';
step3.style.display = 'none';



async function validateEmail() {
  const email = emailInput.value.trim();
  if (!email) return false;
  const format = /[^@\s]+@[^@\s]+\.[^@\s]+/.test(email);
  if (!format) {
    emailError.textContent = 'Formato inválido';
    return false;
  }
  try {
    console.log('Validando email', email);
    const res = await apiFetch(`/api/validate-email?email=${encodeURIComponent(email)}`);
    const data = await res.json();
    console.log('Respuesta validar email', { status: res.status, data });
    if (!data.valid) {
      emailError.textContent = 'Email no válido';
      return false;
    }
  } catch (err) {
    console.log('Error validar email', err);
    emailError.textContent = 'Error al validar';
    return false;
  }
  emailError.textContent = '';
  return true;
}

emailInput.addEventListener('blur', validateEmail);

formDatos.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!(await validateEmail())) return;
  datos = {
    nombre: document.getElementById('nombre').value.trim(),
    apellido: document.getElementById('apellido').value.trim(),
    email: emailInput.value.trim(),
    telefono: document.getElementById('telefono').value.trim(),
  };
  step1.style.display = 'none';
  step2.style.display = 'block';
});

async function updateCosto() {
  const provincia = document.getElementById('provincia').value.trim();
  const metodo = metodoSelect.value;
  if (!metodo) {
    costoEl.textContent = '';
    envio.costo = 0;
    envio.metodo = '';
    envio.metodoLabel = '';
    return;
  }
  if (!provincia && metodo !== 'retiro') {
    costoEl.textContent = 'Seleccioná una provincia para calcular el envío';
    envio.costo = 0;
    envio.metodo = metodo;
    envio.metodoLabel = SHIPPING_METHOD_LABELS[metodo] || '';
    return;
  }
  try {
    console.log('Calculando costo de envío', { provincia, metodo });
    const params = new URLSearchParams({
      provincia,
      metodo,
    });
    const res = await apiFetch(`/api/shipping-cost?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      console.log('Respuesta costo envío', { status: res.status, data });
      const costo = Number(data.costo) || 0;
      const label = data.metodoLabel || SHIPPING_METHOD_LABELS[data.metodo] || '';
      if (costo === 0) {
        const texto = label ? `${label}: sin costo` : 'Envío sin costo';
        costoEl.textContent = texto;
      } else {
        const texto = label ? `${label}: $${costo.toLocaleString('es-AR')}` : `Costo de envío: $${costo}`;
        costoEl.textContent = texto;
      }
      envio.costo = costo;
      envio.metodo = data.metodo || metodo;
      envio.metodoLabel = label;
    } else {
      console.log('Error costo envío', res.status);
      costoEl.textContent = 'No se pudo calcular el costo de envío';
      envio.costo = 0;
      envio.metodo = metodo;
      envio.metodoLabel = SHIPPING_METHOD_LABELS[metodo] || '';
    }
  } catch (err) {
    console.log('Error costo envío', err);
    costoEl.textContent = 'No se pudo calcular el costo de envío';
    envio.costo = 0;
    envio.metodo = metodo;
    envio.metodoLabel = SHIPPING_METHOD_LABELS[metodo] || '';
  }
  buildResumen();
  updateMetodoInfo();
}

document.getElementById('provincia').addEventListener('change', updateCosto);
metodoSelect.addEventListener('change', updateCosto);

const SHIPPING_METHOD_LABELS = {
  retiro: 'Retiro en local',
  estandar: 'Envío estándar',
  express: 'Envío express',
};

envio.costo = 0;
envio.metodo = metodoSelect.value || '';
envio.metodoLabel = SHIPPING_METHOD_LABELS[envio.metodo] || '';

updateCosto();
loadPaymentSettings();

formEnvio.addEventListener('submit', (ev) => {
  ev.preventDefault();
  envio = {
    ...envio,
    provincia: document.getElementById('provincia').value.trim(),
    localidad: document.getElementById('localidad').value.trim(),
    calle: document.getElementById('calle').value.trim(),
    numero: document.getElementById('numero').value.trim(),
    piso: document.getElementById('piso').value.trim(),
    cp: document.getElementById('cp').value.trim(),
    metodo: metodoSelect.value,
  };
  buildResumen();
  step2.style.display = 'none';
  step3.style.display = 'block';
  updateMetodoInfo();
});

Array.from(pagoRadios).forEach((radio) =>
  radio.addEventListener('change', updateMetodoInfo)
);

function buildResumen() {
  const subtotal = cart.reduce((t, it) => t + it.price * it.quantity, 0);
  const itemsHtml = cart
    .map(
      (i) =>
        `<li>${i.name} x${i.quantity} - $${(i.price * i.quantity).toLocaleString('es-AR')}</li>`
    )
    .join('');
  const total = subtotal + (envio.costo || 0);
  const metodoLabel =
    envio.metodoLabel || SHIPPING_METHOD_LABELS[envio.metodo] || '';
  const resumenHtml = `
    <ul>${itemsHtml}</ul>
    <p>Subtotal: $${subtotal.toLocaleString('es-AR')}</p>
    <p>Costo estimado de envío: $${(envio.costo || 0).toLocaleString('es-AR')}</p>
    ${
      metodoLabel
        ? `<p>Método de envío: ${metodoLabel}</p>`
        : ''
    }
    <p><strong>Total estimado: $${total.toLocaleString('es-AR')}</strong></p>
  `;
  resumenEl.innerHTML = resumenHtml;
  if (resumenPaso2El) resumenPaso2El.innerHTML = resumenHtml;
}

function shippingLabel(id) {
  return SHIPPING_METHOD_LABELS[id] || envio.metodoLabel || id || '';
}

function isCashAllowedForShipping() {
  if (!allowedCashMethods || allowedCashMethods.length === 0) return true;
  if (!envio.metodo) return true;
  return allowedCashMethods.includes(String(envio.metodo).toLowerCase());
}

function renderProtectionNote(method) {
  if (!protectionNote) return;
  const garantiaLink =
    '<a href="/garantia.html" class="trust-link">Garantía y devoluciones</a>';
  const terminosLink =
    '<a href="/pages/terminos.html" class="trust-link">Términos y condiciones</a>';
  if (method === 'transferencia') {
    protectionNote.innerHTML = `
      <strong>Compra protegida NERINParts</strong>
      <ul>
        <li>Los datos bancarios se muestran solo en nerinparts.com.ar.</li>
        <li>Verificá el dominio antes de pagar y usá el número de pedido en el concepto.</li>
        <li>Consultá ${garantiaLink} y ${terminosLink} para más respaldo.</li>
      </ul>
    `;
    return;
  }
  if (method === 'efectivo') {
    protectionNote.innerHTML = `
      <strong>Compra protegida NERINParts</strong>
      <ul>
        <li>Solo cobramos en sucursal o puntos autorizados.</li>
        <li>No solicitamos cobros en domicilios no acordados.</li>
        <li>Revisá ${garantiaLink} y ${terminosLink} antes de pagar.</li>
      </ul>
    `;
    return;
  }
  protectionNote.innerHTML = `
    <strong>Compra protegida NERINParts</strong>
    <ul>
      <li>Pagás a través de la pasarela segura de Mercado Pago (HTTPS y tokenización).</li>
      <li>Tu comprobante queda asociado al número de pedido.</li>
      <li>Consultá ${garantiaLink} y ${terminosLink} cuando lo necesites.</li>
    </ul>
  `;
}

function updateMetodoInfo() {
  const metodo = getSelectedPaymentMethod();
  let html = '';
  if (metodo === 'transferencia') {
    const bank = paymentSettings?.bank_transfer || {};
    if (paymentSettings && bank.enabled === false) {
      html = '<p>El pago por transferencia está deshabilitado temporalmente.</p>';
    } else {
      html = `
        <p>Transferí el total a nombre de <strong>${bank.account_holder_name || 'NERIN Parts'}</strong></p>
        <p>Banco: ${bank.bank_name || '—'} (${bank.account_type || 'cuenta'})</p>
        <p>Alias: <strong>${bank.alias || '—'}</strong></p>
        <p>CBU: <strong>${bank.cbu || '—'}</strong></p>
        <p>CUIT: ${bank.cuit || '—'}</p>
        ${bank.additional_instructions ? `<p>${bank.additional_instructions}</p>` : ''}
      `;
    }
  } else if (metodo === 'efectivo') {
    const allowed =
      allowedCashMethods && allowedCashMethods.length
        ? allowedCashMethods.map((m) => shippingLabel(m)).join(', ')
        : 'Retiro en sucursal';
    const pickupMsg =
      paymentSettings?.cash_payment?.instructions_pickup ||
      'Podés abonar al retirar en sucursal con tu DNI y número de pedido.';
    html = `<p>Disponible para: ${allowed}</p><p>${pickupMsg}</p>`;
    if (!isCashAllowedForShipping()) {
      html +=
        '<p style="color:#c53030">El pago en efectivo solo está disponible con el método de envío seleccionado.</p>';
    }
  } else {
    html = '<p>Serás redirigido a la pasarela segura de Mercado Pago.</p>';
  }
  if (metodoInfo) metodoInfo.innerHTML = html;
  renderProtectionNote(metodo);
  toggleCashValidation();
  if (typeof window.NERIN_TRACK_EVENT === "function" && metodo !== lastTrackedPaymentMethod) {
    window.NERIN_TRACK_EVENT("checkout_payment", {
      step: "Pago",
      metadata: {
        method: metodo,
      },
    });
    lastTrackedPaymentMethod = metodo;
  }
}

function toggleCashValidation() {
  if (!confirmarBtn) return;
  const metodo = getSelectedPaymentMethod();
  if (metodo !== 'efectivo') {
    confirmarBtn.disabled = false;
    return;
  }
  confirmarBtn.disabled = !isCashAllowedForShipping();
}

async function submitMercadoPago() {
  const customer = { ...datos, ...envio };
  const originalText = confirmarBtn.textContent;
  confirmarBtn.disabled = true;
  confirmarBtn.textContent = 'Procesando...';
  try {
    console.log('Creando preferencia MP', { cart, customer });
    const carritoBackend = cart.map(({ name, price, quantity }) => ({
      titulo: name,
      precio: price,
      cantidad: quantity,
    }));
    const res = await apiFetch('/api/mercado-pago/crear-preferencia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carrito: carritoBackend, usuario: customer }),
    });
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      console.log('Respuesta preferencia MP', { status: res.status, data });
      if (res.ok && data.init_point) {
        localStorage.setItem('mp_last_pref', data.preferenceId || '');
        localStorage.setItem('mp_last_nrn', data.nrn || data.orderId || '');
        localStorage.setItem('nerinUserInfo', JSON.stringify(customer));
        try {
          localStorage.setItem('nerinUserProfile', JSON.stringify(customer));
        } catch (profileError) {
          console.warn('No se pudieron guardar los datos del cliente', profileError);
        }
        localStorage.removeItem('nerinCart');
        window.location.href = data.init_point;
      } else {
        const msg =
          data.error ||
          'Error al generar el pago. Revisá los datos del carrito o intentá más tarde.';
        alert(msg);
        console.error('init_point no recibido', data);
      }
    } catch (e) {
      console.error('Respuesta NO JSON:', text.slice(0, 300));
      alert('Error al procesar el pago (respuesta no válida del servidor)');
      return;
    }
  } catch (e) {
    alert('Hubo un error con el pago');
    console.error('Error al procesar el pago', e);
  } finally {
    confirmarBtn.disabled = false;
    confirmarBtn.textContent = originalText;
  }
}

async function submitOfflineOrder(paymentMethod) {
  if (paymentMethod === 'efectivo' && !isCashAllowedForShipping()) {
    alert('El pago en efectivo solo está disponible con el método de envío habilitado.');
    return;
  }
  const customer = { ...datos, ...envio };
  const productos = cart.map(({ id, name, price, quantity, sku }) => ({
    id,
    sku,
    name,
    price,
    quantity,
  }));
  const payload = {
    productos,
    cliente: {
      ...datos,
      email: datos.email,
      telefono: datos.telefono,
      direccion: {
        provincia: envio.provincia,
        localidad: envio.localidad,
        calle: envio.calle,
        numero: envio.numero,
        piso: envio.piso,
        cp: envio.cp,
      },
      provincia: envio.provincia,
      localidad: envio.localidad,
      calle: envio.calle,
      numero: envio.numero,
      piso: envio.piso,
      cp: envio.cp,
      metodo: envio.metodo,
      metodo_envio: envio.metodo,
      costo_envio: envio.costo,
    },
    metodo: envio.metodo,
    metodo_envio: envio.metodo,
    payment_method: paymentMethod,
    payment_details:
      paymentMethod === 'transferencia'
        ? { reference: 'Pendiente de comprobante' }
        : {},
  };
  const originalText = confirmarBtn.textContent;
  confirmarBtn.disabled = true;
  confirmarBtn.textContent = 'Generando pedido...';
  try {
    const res = await apiFetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error || 'No se pudo crear el pedido.';
      alert(msg);
      return;
    }
    const orderId = data.orderId || data.id;
    const totalValue = cart.reduce((acc, item) => acc + item.price * item.quantity, 0) +
      (envio.costo || 0);
    if (typeof window.NERIN_TRACK_EVENT === "function") {
      window.NERIN_TRACK_EVENT("purchase", {
        orderId,
        value: totalValue,
        metadata: {
          paymentMethod,
        },
      });
    }
    localStorage.setItem('nerinUserInfo', JSON.stringify(customer));
    try {
      localStorage.setItem('nerinUserProfile', JSON.stringify(customer));
    } catch (profileError) {
      console.warn('No se pudieron guardar los datos del cliente', profileError);
    }
    localStorage.removeItem('nerinCart');
    const target =
      paymentMethod === 'transferencia'
        ? '/checkout/confirmacion-transferencia.html'
        : '/checkout/confirmacion-efectivo.html';
    window.location.href = `${target}?order=${encodeURIComponent(orderId)}`;
  } catch (error) {
    console.error('Error al generar pedido offline', error);
    alert('No pudimos registrar tu pedido. Intentalo nuevamente.');
  } finally {
    confirmarBtn.disabled = false;
    confirmarBtn.textContent = originalText;
  }
}

confirmarBtn.addEventListener('click', async () => {
  const metodo = getSelectedPaymentMethod();
  if (metodo === 'transferencia' || metodo === 'efectivo') {
    await submitOfflineOrder(metodo);
    return;
  }
  await submitMercadoPago();
});
