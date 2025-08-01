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
  const productos = cart.map((it) => ({
    id: it.id,
    name: it.name,
    price: it.price,
    quantity: it.quantity,
  }));
  const cliente = {
    nombre: datos.nombre,
    apellido: datos.apellido,
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
  };
  try {
    if (metodo === 'mp') {
      const mpBody = {
        items: productos.map((p) => ({
          title: p.name,
          quantity: Number(p.quantity),
          unit_price: Number(p.price),
        })),
      };
      console.log('Enviando preferencia MP', { metodoPago: metodo, body: mpBody });
      const res = await fetch('/api/mercadopago/preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mpBody),
      });
      const data = await res.json();
      console.log('Respuesta preferencia MP', { status: res.status, data });
      const initPoint = data.init_point ||
        (data.preferenceId
          ? `https://www.mercadopago.com/checkout/v1/redirect?pref_id=${data.preferenceId}`
          : data.preference
            ? `https://www.mercadopago.com/checkout/v1/redirect?pref_id=${data.preference}`
            : null);
      if (res.ok && initPoint) {
        localStorage.setItem('nerinUserInfo', JSON.stringify({ ...datos, ...envio }));
        localStorage.removeItem('nerinCart');
        window.location.href = initPoint;
      } else if (!res.ok) {
        throw new Error(data.error || 'Error al crear preferencia');
      }
    } else {
      const orderBody = {
        cliente,
        productos,
        metodo_envio: envio.metodo,
        comentarios: '',
        metodo_pago: metodo,
      };
      console.log('Creando orden', { metodoPago: metodo, body: orderBody });
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBody),
      });
      const data = await res.json();
      console.log('Respuesta crear orden', { status: res.status, data });
      const orderId = data.orderId || data.numeroOrden;
      if (res.ok && orderId) {
        localStorage.setItem('nerinUserInfo', JSON.stringify({ ...datos, ...envio }));
        localStorage.removeItem('nerinCart');
        window.location.href = `/confirmacion/${orderId}`;
      } else if (!res.ok) {
        throw new Error(data.error || 'Error al crear orden');
      }
    }
  } catch (e) {
    console.error('Error procesando pedido', e);
    Toastify({ text: e.message || 'Error al procesar el pedido', duration: 3000, backgroundColor: '#ef4444' }).showToast();
  }
});
