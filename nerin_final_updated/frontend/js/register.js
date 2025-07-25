/*
 * Módulo para registro de nuevos usuarios.
 * Envía los datos al backend para crear un nuevo cliente y usuario.
 * Si el registro es exitoso, inicia sesión automáticamente y redirige a la tienda.
 */

import { login } from './api.js';

const form = document.getElementById('registerForm');
const errorEl = document.getElementById('regError');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.style.display = 'none';
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regConfirm').value;
  if (pass !== confirm) {
    errorEl.textContent = 'Las contraseñas no coinciden';
    errorEl.style.display = 'block';
    return;
  }
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass, name })
    });
    if (res.ok) {
      const data = await res.json();
      // Guardar datos de sesión
      localStorage.setItem('nerinToken', data.token);
      localStorage.setItem('nerinUserRole', data.role);
      localStorage.setItem('nerinUserName', name || 'Cliente');
      localStorage.setItem('nerinUserEmail', email);
      // Redirigir a la tienda
      window.location.href = '/shop.html';
    } else {
      const err = await res.json().catch(() => ({}));
      errorEl.textContent = err.error || 'Error al registrarse';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = 'No se pudo conectar con el servidor';
    errorEl.style.display = 'block';
  }
});