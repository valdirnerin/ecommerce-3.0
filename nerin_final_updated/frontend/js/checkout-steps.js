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
    console.log('Validando email', email);
    const res = await fetch(`/api/validate-email?email=${encodeURIComponent(email)}`);
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
    const res = await fetch(`/api/shipping-cost?provincia=${encodeURIComponent(provincia)}`);
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
  const carrito = cart.map((it) => ({
    titulo: it.name,
    precio: it.price,
    cantidad: it.quantity,
  }));
  const usuario = { ...datos, ...envio };
  try {
    console.log('Creando preferencia MP', { carrito, usuario });
    const res = await fetch(`${API_BASE_URL}/api/mercado-pago/crear-preferencia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carrito, usuario }),
    });
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      console.log('Respuesta preferencia MP', { status: res.status, data });
      if (res.ok && data.init_point) {
        localStorage.setItem('nerinUserInfo', JSON.stringify(usuario));
        localStorage.removeItem('nerinCart');
        window.location.href = data.init_point;
      } else {
        alert(data.error || 'Hubo un error con el pago');
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
