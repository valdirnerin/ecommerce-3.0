import { apiFetch } from "./api.js";

const API_BASE_URL = ''; // dejamos vacío para usar rutas relativas
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const formDatos = document.getElementById('formDatos');
const formEnvio = document.getElementById('formEnvio');
const costoEl = document.getElementById('costoEnvio');
const resumenEl = document.getElementById('resumen');
const confirmarBtn = document.getElementById('confirmar');
const emailInput = document.getElementById('email');
const emailError = document.getElementById('emailError');
const pagoRadios = document.getElementsByName('pago');

const cart = JSON.parse(localStorage.getItem('nerinCart') || '[]');
if (cart.length === 0) {
  window.location.href = '/cart.html';
}

let datos = {};
let envio = {};
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
  if (!provincia) return;
  try {
    console.log('Calculando costo de envío', provincia);
    const res = await apiFetch(`/api/shipping-cost?provincia=${encodeURIComponent(provincia)}`);
    if (res.ok) {
      const data = await res.json();
      console.log('Respuesta costo envío', { status: res.status, data });
      costoEl.textContent = `Costo de envío: $${data.costo}`;
      envio.costo = data.costo;
    } else {
      console.log('Error costo envío', res.status);
    }
  } catch (err) {
    console.log('Error costo envío', err);
  }
}

document.getElementById('provincia').addEventListener('change', updateCosto);

envio.costo = 0;

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
    metodo: document.getElementById('metodo').value,
  };
  buildResumen();
  step2.style.display = 'none';
  step3.style.display = 'block';
});

function buildResumen() {
  const subtotal = cart.reduce((t, it) => t + it.price * it.quantity, 0);
  const itemsHtml = cart
    .map(
      (i) =>
        `<li>${i.name} x${i.quantity} - $${(i.price * i.quantity).toLocaleString('es-AR')}</li>`
    )
    .join('');
  const total = subtotal + (envio.costo || 0);
  resumenEl.innerHTML = `
    <ul>${itemsHtml}</ul>
    <p>Subtotal: $${subtotal.toLocaleString('es-AR')}</p>
    <p>Envío: $${(envio.costo || 0).toLocaleString('es-AR')}</p>
    <p><strong>Total: $${total.toLocaleString('es-AR')}</strong></p>
  `;
}

confirmarBtn.addEventListener('click', async () => {
  const metodo = Array.from(pagoRadios).find((r) => r.checked).value;
  if (metodo !== 'mp') return;
  const customer = { ...datos, ...envio };
  try {
    console.log('Creando preferencia MP', { cart, customer });
    const carritoBackend = cart.map(({ name, price, quantity }) => ({
      titulo: name,
      precio: price,
      cantidad: quantity,
    }));
    console.log('carritoBackend', carritoBackend);
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
  }
});
