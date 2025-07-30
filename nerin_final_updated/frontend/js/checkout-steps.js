const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const formDatos = document.getElementById('formDatos');
const formEnvio = document.getElementById('formEnvio');
const costoEl = document.getElementById('costoEnvio');
const resumenEl = document.getElementById('resumen');
const confirmarBtn = document.getElementById('confirmar');

let datos = {};
let envio = {};

formDatos.addEventListener('submit', (ev) => {
  ev.preventDefault();
  datos = {
    nombre: document.getElementById('nombre').value.trim(),
    apellido: document.getElementById('apellido').value.trim(),
    email: document.getElementById('email').value.trim(),
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
    direccion: document.getElementById('direccion').value.trim(),
    cp: document.getElementById('cp').value.trim(),
    metodo: document.getElementById('metodo').value,
  };
  resumenEl.innerHTML = `
    <p><strong>Cliente:</strong> ${datos.nombre} ${datos.apellido}</p>
    <p><strong>Email:</strong> ${datos.email}</p>
    <p><strong>Envío:</strong> ${envio.metodo} - ${envio.provincia}</p>
    <p><strong>Costo envío:</strong> $${envio.costo}</p>
  `;
  step2.style.display = 'none';
  step3.style.display = 'block';
});

confirmarBtn.addEventListener('click', () => {
  // Aquí se integraría la creación del pedido y preferencia MP
  Toastify({ text: 'Pedido confirmado (demo)', duration: 3000 }).showToast();
});
