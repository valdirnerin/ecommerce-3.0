const optCuenta = document.getElementById('optCuenta');
const optInvitado = document.getElementById('optInvitado');
const guestFields = document.getElementById('guestFields');
const continue1 = document.getElementById('continue1');
const continue2 = document.getElementById('continue2');
const confirmar = document.getElementById('confirmar');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const provincia = document.getElementById('provincia');
const costoEnvioEl = document.getElementById('costoEnvio');
const resumenEl = document.getElementById('resumen');
const metodoInfo = document.getElementById('metodoInfo');
const pagoRadios = document.getElementsByName('pago');
const API_BASE_URL = globalThis.API_BASE_URL || '';
let costoEnvio = 0;
let datos = {};
let envio = {};
// Obtenemos el producto seleccionado previamente o usamos uno de ejemplo
const producto = JSON.parse(
  localStorage.getItem('producto') ||
    '{"titulo":"Producto de ejemplo","precio":100,"cantidad":1}'
);

function showGuest(show){
  guestFields.style.display = show ? 'block' : 'none';
}

optCuenta.addEventListener('change',()=>showGuest(false));
optInvitado.addEventListener('change',()=>showGuest(true));

const saved = JSON.parse(localStorage.getItem('userInfo')||'null');
if(saved){
  document.getElementById('nombre').value = saved.nombre||'';
  document.getElementById('apellido').value = saved.apellido||'';
  document.getElementById('email').value = saved.email||'';
  document.getElementById('telefono').value = saved.telefono||'';
}

continue1.addEventListener('click',()=>{
  if(optInvitado.checked){
    if(!validateFields(['nombre','apellido','email','telefono'])) return;
    datos = {
      nombre: document.getElementById('nombre').value.trim(),
      apellido: document.getElementById('apellido').value.trim(),
      email: document.getElementById('email').value.trim(),
      telefono: document.getElementById('telefono').value.trim(),
    };
  }
  step1.classList.remove('active');
  step2.classList.add('active');
});

function validateFields(ids){
  for(const id of ids){
    const el = document.getElementById(id);
    const value = el.value.trim();
    if(!value){ el.focus(); return false; }
    if(id === 'email'){
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if(!emailRegex.test(value)){ alert('Email inválido'); el.focus(); return false; }
    }
  }
  return true;
}

provincia.addEventListener('change',async()=>{
  const prov = provincia.value;
  if(!prov) return;
  try{
    const res = await fetch(`${API_BASE_URL}/api/shipping-cost?provincia=${encodeURIComponent(prov)}`, {
      mode: 'cors'
    });
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      console.log('Respuesta API:', data);
      costoEnvio = data.costo||0;
      costoEnvioEl.textContent = `Costo envío: $${costoEnvio}`;
    } catch (e) {
      console.error('Respuesta NO JSON:', text.slice(0, 300));
      alert('Error al obtener costo de envío (respuesta no válida del servidor)');
    }
  }catch{}
});

continue2.addEventListener('click',()=>{
  if(!validateFields(['provincia','localidad','direccion','cp','metodo'])) return;
  envio = {
    provincia: provincia.value,
    localidad: document.getElementById('localidad').value.trim(),
    direccion: document.getElementById('direccion').value.trim(),
    cp: document.getElementById('cp').value.trim(),
    metodo: document.getElementById('metodo').value,
    costo: costoEnvio
  };
  step2.classList.remove('active');
  buildResumen();
  updateMetodoInfo();
  step3.classList.add('active');
});

function buildResumen(){
  const total = producto.precio * producto.cantidad + costoEnvio;
  const datosHtml = datos.nombre
    ? `<p><strong>Cliente:</strong> ${datos.nombre} ${datos.apellido} - ${datos.email}</p>`
    : '';
  const envioHtml = `<p><strong>Envío a:</strong> ${envio.direccion}, ${envio.localidad}, ${envio.provincia} (${envio.cp})</p>`+
    `<p><strong>Método:</strong> ${envio.metodo}</p>`+
    `<p><strong>Costo envío:</strong> $${costoEnvio}</p>`;
  resumenEl.innerHTML =
    `<p><strong>Producto:</strong> ${producto.titulo} x${producto.cantidad} - $${producto.precio}</p>`+
    datosHtml +
    envioHtml +
    `<p><strong>Total:</strong> $${total}</p>`;
}

function updateMetodoInfo(){
  const val = Array.from(pagoRadios).find(r=>r.checked).value;
  if(val==='transferencia'){
    metodoInfo.innerHTML = '<p><strong>Banco:</strong> Banco Ejemplo<br>Alias: MI.ALIAS.BANCO<br>CBU: 0000000000000000000000<br>CUIT: 30-12345678-9</p>';
    confirmar.textContent = 'Ya realicé la transferencia';
  }else if(val==='efectivo'){
    metodoInfo.textContent = 'Pagará en efectivo al momento de retirar su pedido.';
    confirmar.textContent = 'Finalizar pedido';
  }else{
    metodoInfo.textContent = '';
    confirmar.textContent = 'Confirmar y pagar';
  }
}
pagoRadios.forEach(r=>r.addEventListener('change', updateMetodoInfo));

confirmar.addEventListener('click', async () => {
  const metodo = Array.from(pagoRadios).find(r=>r.checked)?.value;
  if(metodo !== 'mp') return;
  try {
    const customer = { ...datos, ...envio };
    const carritoBackend = [{
      titulo: producto.titulo,
      precio: Number(producto.precio),
      cantidad: Number(producto.cantidad)
    }];
    const item = carritoBackend[0];
    if(!item.titulo || item.precio <= 0 || item.cantidad <= 0){
      console.error('Producto inválido', item);
      return alert('Producto inválido');
    }
    console.log('→ creando preferencia', { carrito: carritoBackend, usuario: customer });
    const res = await fetch(`${API_BASE_URL}/api/mercado-pago/crear-preferencia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carrito: carritoBackend, usuario: customer })
    });
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      console.log('Respuesta API:', data);
      if(res.ok && data.init_point){
        localStorage.setItem('userInfo', JSON.stringify(customer));
        window.location.href = data.init_point;
      }else{
        console.error('Error al crear preferencia', data);
        alert(data.error || 'Hubo un error con el pago');
      }
    } catch (e) {
      console.error('Respuesta NO JSON:', text.slice(0, 300));
      alert('Error al procesar el pago (respuesta no válida del servidor)');
    }
  } catch(err){
    console.error('Error al crear preferencia', err);
    alert('Hubo un error con el pago');
  }
});
