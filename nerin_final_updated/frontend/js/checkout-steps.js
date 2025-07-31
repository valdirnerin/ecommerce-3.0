const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const step4 = document.getElementById('step4');
const progress = document.getElementById('progress');
const formDatos = document.getElementById('formDatos');
const formEnvio = document.getElementById('formEnvio');
const costoEl = document.getElementById('costoEnvio');
const resumenEl = document.getElementById('resumen');
const finalSummary = document.getElementById('finalSummary');
const trackBtn = document.getElementById('trackOrder');
const confirmarBtn = document.getElementById('confirmar');
const emailInput = document.getElementById('email');
const emailExists = document.getElementById('emailExists');
const seguirInvitado = document.getElementById('seguirInvitado');

let datos = {};
let envio = {};

function setStep(n) {
  const steps = [step1, step2, step3, step4];
  steps.forEach((s, i) => {
    if (s) s.style.display = i === n ? 'block' : 'none';
  });
  if (progress) {
    const items = progress.querySelectorAll('.step');
    items.forEach((el, i) => {
      el.classList.remove('current', 'done', 'todo');
      if (i < n) el.classList.add('done');
      else if (i === n) el.classList.add('current');
      else el.classList.add('todo');
    });
  }
}

async function checkEmailExists(email) {
  if (!email) return false;
  try {
    const res = await fetch(`/api/user-exists?email=${encodeURIComponent(email)}`);
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.exists;
  } catch {
    return false;
  }
}

emailInput.addEventListener('blur', async () => {
  const exists = await checkEmailExists(emailInput.value.trim());
  if (exists && emailExists) {
    emailExists.style.display = 'block';
  }
});

if (seguirInvitado) {
  seguirInvitado.addEventListener('click', (e) => {
    e.preventDefault();
    emailExists.style.display = 'none';
  });
}

formDatos.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const exists = await checkEmailExists(emailInput.value.trim());
  if (exists && emailExists.style.display !== 'none') {
    return;
  }
  datos = {
    nombre: document.getElementById('nombre').value.trim(),
    apellido: document.getElementById('apellido').value.trim(),
    email: emailInput.value.trim(),
    telefono: document.getElementById('telefono').value.trim(),
  };
  setStep(1);
  updateCosto();
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
    direccion: document.getElementById('direccion').value.trim(),
    cp: document.getElementById('cp').value.trim(),
    metodo: document.getElementById('metodo').value,
  };
  const cart = JSON.parse(localStorage.getItem('nerinCart') || '[]');
  const subtotal = cart.reduce((t, it) => t + it.price * it.quantity, 0);
  const total = subtotal + (envio.costo || 0);
  const itemsHtml = cart
    .map((i) => `<li>${i.name} x${i.quantity} - $${i.price.toLocaleString('es-AR')}</li>`) 
    .join('');
  resumenEl.innerHTML = `
    <ul>${itemsHtml}</ul>
    <p><strong>Subtotal:</strong> $${subtotal.toLocaleString('es-AR')}</p>
    <p><strong>Costo envío:</strong> $${(envio.costo || 0).toLocaleString('es-AR')}</p>
    <p><strong>Total:</strong> $${total.toLocaleString('es-AR')}</p>
  `;
  setStep(2);
});

confirmarBtn.addEventListener('click', async () => {
  confirmarBtn.disabled = true;
  try {
    const cart = JSON.parse(localStorage.getItem('nerinCart') || '[]');
    if (cart.length === 0) {
      Toastify({ text: 'Carrito vacío', duration: 3000 }).showToast();
      return;
    }
    const payload = {
      cliente: {
        nombre: datos.nombre,
        email: datos.email,
        telefono: datos.telefono,
        direccion: {
          calle: envio.direccion,
          numero: '',
          piso: '',
          localidad: envio.localidad,
          provincia: envio.provincia,
          cp: envio.cp,
        },
      },
      productos: cart,
      metodo_envio: envio.metodo,
      comentarios: '',
    };
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.orderId) {
      finalSummary.innerHTML = `Pedido <strong>${data.orderId}</strong> creado.`;
      trackBtn.href = `/seguimiento?order=${encodeURIComponent(data.orderId)}&email=${encodeURIComponent(datos.email)}`;
      localStorage.removeItem('nerinCart');
      setStep(3);
    } else {
      Toastify({ text: data && data.error ? data.error : 'Error', duration: 3000 }).showToast();
    }
  } catch (e) {
    Toastify({ text: 'Error de red', duration: 3000 }).showToast();
  } finally {
    confirmarBtn.disabled = false;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  setStep(0);
});
