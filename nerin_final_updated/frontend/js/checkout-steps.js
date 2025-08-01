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
const saved = JSON.parse(localStorage.getItem('nerinUserInfo') || 'null');
if (saved) {
  document.getElementById('nombre').value = saved.nombre || '';
  document.getElementById('apellido').value = saved.apellido || '';
  document.getElementById('email').value = saved.email || '';
  document.getElementById('telefono').value = saved.telefono || '';
  document.getElementById('provincia').value = saved.provincia || '';
  document.getElementById('localidad').value = saved.localidad || '';
  document.getElementById('calle').value = saved.calle || '';
  document.getElementById('numero').value = saved.numero || '';
  document.getElementById('piso').value = saved.piso || '';
  document.getElementById('cp').value = saved.cp || '';
  if (saved.metodo) document.getElementById('metodo').value = saved.metodo;
}

async function validateEmail() {
  const email = emailInput.value.trim();
  if (!email) return false;
  const format = /[^@\s]+@[^@\s]+\.[^@\s]+/.test(email);
  if (!format) {
    emailError.textContent = 'Formato inválido';
    return false;
  }
  try {
    const res = await fetch(`/api/validate-email?email=${encodeURIComponent(email)}`);
    const data = await res.json();
    if (!data.valid) {
      emailError.textContent = 'Email no válido';
      return false;
    }
  } catch {
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
    const res = await fetch(`/api/shipping-cost?provincia=${encodeURIComponent(provincia)}`);
    if (res.ok) {
      const data = await res.json();
      costoEl.textContent = `Costo de envío: $${data.costo}`;
      envio.costo = data.costo;
    }
  } catch {}
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
  const body = {
    titulo: 'Carrito NERIN',
    precio: cart.reduce((t, it) => t + it.price * it.quantity, 0) + (envio.costo || 0),
    cantidad: 1,
    datos,
    envio,
  };
  try {
    if (metodo === 'mp') {
      const res = await fetch('/crear-preferencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.init_point) {
        localStorage.setItem('nerinUserInfo', JSON.stringify({ ...datos, ...envio }));
        localStorage.removeItem('nerinCart');
        window.location.href = data.init_point;
      } else if (!res.ok) {
        throw new Error(data.error || 'Error al crear preferencia');
      }
    } else {
      body.metodo = metodo;
      const res = await fetch('/orden-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.numeroOrden) {
        localStorage.setItem('nerinUserInfo', JSON.stringify({ ...datos, ...envio }));
        localStorage.removeItem('nerinCart');
        window.location.href = `/confirmacion/${data.numeroOrden}`;
      } else if (!res.ok) {
        throw new Error(data.error || 'Error al crear orden');
      }
    }
  } catch (e) {
    console.error(e);
    Toastify({ text: 'Error al procesar el pedido', duration: 3000, backgroundColor: '#ef4444' }).showToast();
  }
});
