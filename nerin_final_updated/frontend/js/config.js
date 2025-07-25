/*
 * Carga la configuración global desde el backend y aplica ajustes en la
 * interfaz (número de WhatsApp, Google Analytics, Meta Pixel). Esta
 * función se ejecuta al cargar cada página y expone la configuración
 * en `window.NERIN_CONFIG` para que otros módulos puedan consultarla.
 */

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('No se pudo obtener la configuración');
    const cfg = await res.json();
    // Exponer a nivel global
    window.NERIN_CONFIG = cfg;
    // Actualizar enlace de WhatsApp flotante si existe
    if (cfg.whatsappNumber) {
      const waBtn = document.querySelector('#whatsapp-button a');
      if (waBtn) {
        const phone = cfg.whatsappNumber.replace(/[^0-9]/g, '');
        waBtn.href = `https://wa.me/${phone}`;
      }
    }
    // Insertar Google Analytics
    if (cfg.googleAnalyticsId) {
      const gaScript1 = document.createElement('script');
      gaScript1.async = true;
      gaScript1.src = `https://www.googletagmanager.com/gtag/js?id=${cfg.googleAnalyticsId}`;
      document.head.appendChild(gaScript1);
      const gaScript2 = document.createElement('script');
      gaScript2.innerHTML =
        `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);} ;
gtag('js', new Date());
gtag('config', '${cfg.googleAnalyticsId}');`;
      document.head.appendChild(gaScript2);
    }
    // Insertar Meta/Facebook Pixel
    if (cfg.metaPixelId) {
      const fbScript = document.createElement('script');
      fbScript.innerHTML =
        `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod? n.callMethod.apply(n, arguments):n.queue.push(arguments);}; if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s);}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js'); fbq('init', '${cfg.metaPixelId}'); fbq('track', 'PageView');`;
      document.head.appendChild(fbScript);
    }
  } catch (err) {
    console.error(err);
  }
  // Actualizar navegación según sesión y carrito
  updateNav();
}

/**
 * Actualiza el menú de navegación según el estado de autenticación y el carrito.
 * Muestra enlaces a "Mi cuenta" o "Admin" en lugar de "Acceder" si el usuario
 * está logueado, añade un contador de artículos al carrito y permite cerrar sesión.
 */
function updateNav() {
  const navUl = document.querySelector('header nav ul');
  if (!navUl) return;
  const role = localStorage.getItem('nerinUserRole');
  const name = localStorage.getItem('nerinUserName');
  const email = localStorage.getItem('nerinUserEmail');
  // Calcular cantidad total en el carrito
  let cartCount = 0;
  try {
    const cart = JSON.parse(localStorage.getItem('nerinCart') || '[]');
    cartCount = cart.reduce((sum, item) => sum + (item.quantity || 0), 0);
  } catch (e) {
    cartCount = 0;
  }
  // Recorrer elementos <li> para encontrar enlaces
  const liItems = navUl.querySelectorAll('li');
  liItems.forEach((li) => {
    const a = li.querySelector('a');
    if (!a) return;
    const href = a.getAttribute('href');
    // Actualizar carrito
    if (href && href.includes('/cart.html')) {
      // Mostrar contador de carrito
      let countSpan = a.querySelector('.cart-count');
      if (!countSpan) {
        countSpan = document.createElement('span');
        countSpan.className = 'cart-count';
        a.appendChild(countSpan);
      }
      countSpan.textContent = cartCount > 0 ? ` (${cartCount})` : '';
    }
    // Actualizar enlace de acceso
    if (href && href.includes('/login.html')) {
      if (role) {
        // Usuario autenticado: cambiar enlace a Admin o Mi cuenta
        if (role === 'admin' || role === 'vendedor') {
          a.textContent = 'Admin';
          a.setAttribute('href', '/admin.html');
        } else {
          a.textContent = 'Mi cuenta';
          a.setAttribute('href', '/account.html');
        }
      } else {
        a.textContent = 'Acceder';
        a.setAttribute('href', '/login.html');
      }
    }
  });
  // Añadir enlace de cierre de sesión si no existe y el usuario está autenticado
  if (role) {
    let logoutLi = navUl.querySelector('li.logout-item');
    if (!logoutLi) {
      logoutLi = document.createElement('li');
      logoutLi.className = 'logout-item';
      const logoutLink = document.createElement('a');
      logoutLink.href = '#';
      logoutLink.textContent = 'Cerrar sesión';
      logoutLink.addEventListener('click', (e) => {
        e.preventDefault();
        // Limpiar datos de sesión
        localStorage.removeItem('nerinToken');
        localStorage.removeItem('nerinUserRole');
        localStorage.removeItem('nerinUserName');
        localStorage.removeItem('nerinUserEmail');
        // Recargar página para reflejar cambios
        window.location.href = '/index.html';
      });
      logoutLi.appendChild(logoutLink);
      navUl.appendChild(logoutLi);
    }
    // Ocultar enlace de registro si existe
    const signupLi = navUl.querySelector('li.signup-item');
    if (signupLi) {
      signupLi.remove();
    }
  } else {
    // Si no hay sesión y existe botón de logout, eliminarlo
    const logoutLi = navUl.querySelector('li.logout-item');
    if (logoutLi) {
      logoutLi.remove();
    }
    // Asegurar que exista enlace de registro cuando no hay sesión
    let signupLi = navUl.querySelector('li.signup-item');
    if (!signupLi) {
      signupLi = document.createElement('li');
      signupLi.className = 'signup-item';
      const signupLink = document.createElement('a');
      signupLink.href = '/register.html';
      signupLink.textContent = 'Registrarse';
      signupLi.appendChild(signupLink);
      navUl.appendChild(signupLi);
    }
  }
}

// Exponer función globalmente para que otros módulos puedan actualizar la navegación
window.updateNav = updateNav;

// Escuchar cambios en almacenamiento para actualizar la navegación (p.ej. cuando
// se actualiza el carrito en otra pestaña)
window.addEventListener('storage', () => {
  updateNav();
});

document.addEventListener('DOMContentLoaded', loadConfig);