import { apiFetch } from "./api.js";

/*
 * Carga la configuración global desde el backend y aplica ajustes en la
 * interfaz (número de WhatsApp, Google Analytics, Meta Pixel). Esta
 * función se ejecuta al cargar cada página y expone la configuración
 * en `window.NERIN_CONFIG` para que otros módulos puedan consultarla.
 */

function getPublicBaseUrl(cfg = {}) {
  const raw = typeof cfg.publicUrl === "string" ? cfg.publicUrl.trim() : "";
  if (raw) {
    try {
      const normalized = new URL(raw).toString();
      return normalized.replace(/\/+$/, "");
    } catch (err) {
      console.warn("URL pública inválida en configuración", err);
    }
  }
  if (typeof window !== "undefined" && window.location) {
    return window.location.origin;
  }
  return "";
}

function resolveAbsoluteUrl(value, baseUrl) {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const base = baseUrl || getPublicBaseUrl(window.NERIN_CONFIG || {});
  try {
    return new URL(value, base || window.location.href).toString();
  } catch (err) {
    try {
      return new URL(value, window.location.href).toString();
    } catch (innerErr) {
      return value;
    }
  }
}

function hydrateJsonLd(baseUrl) {
  const base = (baseUrl || getPublicBaseUrl(window.NERIN_CONFIG || {})).replace(
    /\/+$/,
    "",
  );
  const selector = "[data-seo-jsonld],[data-product-breadcrumbs]";
  document.querySelectorAll(selector).forEach((script) => {
    const template =
      script.dataset.seoJsonldTemplate ||
      script.dataset.productBreadcrumbsTemplate ||
      script.textContent;
    if (!template) return;
    if (script.dataset.seoJsonld && !script.dataset.seoJsonldTemplate) {
      script.dataset.seoJsonldTemplate = template;
    }
    if (script.dataset.productBreadcrumbs && !script.dataset.productBreadcrumbsTemplate) {
      script.dataset.productBreadcrumbsTemplate = template;
    }
    const hydrated = template.replace(/__BASE_URL__/g, base);
    if (hydrated !== script.textContent) {
      script.textContent = hydrated;
    }
  });
}

function applySeoConfig(cfg = {}) {
  const baseUrl = getPublicBaseUrl(cfg);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    const raw = canonical.getAttribute("href") || window.location.pathname || "/";
    canonical.setAttribute("href", resolveAbsoluteUrl(raw, baseUrl));
  }
  document.querySelectorAll("[data-seo-absolute]").forEach((node) => {
    const attr = node.dataset.seoAbsolute || (node.tagName === "LINK" ? "href" : "content");
    const value = node.getAttribute(attr);
    if (!value) return;
    node.setAttribute(attr, resolveAbsoluteUrl(value, baseUrl));
  });
  hydrateJsonLd(baseUrl);
}

function dispatchConfigLoaded(cfg) {
  try {
    const event = new CustomEvent("nerin:config-loaded", { detail: cfg || {} });
    document.dispatchEvent(event);
  } catch (err) {
    console.error("No se pudo notificar la carga de configuración", err);
  }
}

async function loadConfig() {
  let cfg = {};
  try {
    const res = await apiFetch("/api/config");
    if (!res.ok) throw new Error("No se pudo obtener la configuración");
    cfg = await res.json();
    // Exponer a nivel global
    window.NERIN_CONFIG = cfg;
    // Permitir que otros módulos conozcan la URL base del backend si está definida
    if (cfg.apiBase) {
      window.API_BASE_URL = cfg.apiBase;
    }
    // Actualizar enlace de WhatsApp flotante si existe
    if (cfg.whatsappNumber) {
      const phone = cfg.whatsappNumber.replace(/[^0-9]/g, "");
      window.NERIN_CONFIG.whatsappNumberSanitized = phone;
      const waBtn = document.querySelector("#whatsapp-button a");
      if (waBtn) {
        waBtn.href = `https://wa.me/${phone}`;
      }
      const cartWABtn = document.getElementById("whatsappBtn");
      if (cartWABtn) {
        cartWABtn.dataset.whatsappNumber = phone;
      }
    }
    // Insertar Google Analytics
    if (cfg.googleAnalyticsId) {
      const gaScript1 = document.createElement("script");
      gaScript1.async = true;
      gaScript1.src = `https://www.googletagmanager.com/gtag/js?id=${cfg.googleAnalyticsId}`;
      document.head.appendChild(gaScript1);
      const gaScript2 = document.createElement("script");
      gaScript2.innerHTML = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);} ;
gtag('js', new Date());
gtag('config', '${cfg.googleAnalyticsId}');`;
      document.head.appendChild(gaScript2);
    }
    // Insertar Meta/Facebook Pixel
    if (cfg.metaPixelId) {
      const fbScript = document.createElement("script");
      fbScript.innerHTML = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod? n.callMethod.apply(n, arguments):n.queue.push(arguments);}; if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s);}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js'); fbq('init', '${cfg.metaPixelId}'); fbq('track', 'PageView');`;
      document.head.appendChild(fbScript);
    }
  } catch (err) {
    console.error(err);
    if (!window.NERIN_CONFIG) {
      window.NERIN_CONFIG = {};
    }
  } finally {
    applySeoConfig(window.NERIN_CONFIG || cfg || {});
  }
  // Actualizar navegación según sesión y carrito
  updateNav();
  dispatchConfigLoaded(window.NERIN_CONFIG || cfg || {});
}

function showToast(message) {
  if (typeof Toastify !== "undefined") {
    Toastify({
      text: message,
      duration: 3000,
      gravity: "top",
      position: "center",
      style: { background: "var(--color-success)" },
    }).showToast();
  } else {
    alert(message);
  }
}

let cartIndicatorTimer = null;
let cartIndicatorBubble = null;
let cartIndicatorTarget = null;

function clearCartIndicator(immediate = false) {
  if (cartIndicatorTimer) {
    clearTimeout(cartIndicatorTimer);
    cartIndicatorTimer = null;
  }
  if (cartIndicatorBubble) {
    const bubble = cartIndicatorBubble;
    cartIndicatorBubble = null;
    if (!immediate) {
      bubble.classList.remove("show");
      setTimeout(() => bubble.remove(), 220);
    } else {
      bubble.remove();
    }
  }
  if (cartIndicatorTarget) {
    cartIndicatorTarget.classList.remove("cart-link--highlight", "menu-toggle--highlight");
    cartIndicatorTarget = null;
  }
}

function positionCartIndicator(bubble, target) {
  const rect = target.getBoundingClientRect();
  const margin = 16;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const bubbleWidth = bubble.offsetWidth;
  const bubbleHeight = bubble.offsetHeight;

  let left = rect.left + rect.width / 2 - bubbleWidth / 2;
  if (left < margin) {
    left = margin;
  }
  const maxLeft = viewportWidth - margin - bubbleWidth;
  if (left > maxLeft) {
    left = maxLeft;
  }
  const arrowLeft = rect.left + rect.width / 2 - left;
  bubble.style.left = `${left}px`;
  bubble.style.setProperty("--indicator-arrow-left", `${arrowLeft}px`);

  let top = rect.bottom + 14;
  let flipped = false;
  const maxTop = viewportHeight - margin - bubbleHeight;
  if (top > maxTop && rect.top - bubbleHeight - 14 >= margin) {
    top = rect.top - bubbleHeight - 14;
    flipped = true;
  }
  if (top < margin) {
    top = margin;
  }
  bubble.style.top = `${top}px`;
  if (flipped) {
    bubble.classList.add("cart-indicator-bubble--flipped");
  } else {
    bubble.classList.remove("cart-indicator-bubble--flipped");
  }
}

function showCartIndicator() {
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  let target = null;
  if (isMobile) {
    target = document.getElementById("navToggle") || document.querySelector(".menu-toggle");
  } else {
    target = document.querySelector('header nav a[href*="/cart.html"]');
  }
  if (!target) return;

  clearCartIndicator(true);

  cartIndicatorTarget = target;
  if (isMobile) {
    target.classList.add("menu-toggle--highlight");
  } else {
    target.classList.add("cart-link--highlight");
  }

  const bubble = document.createElement("div");
  bubble.className = `cart-indicator-bubble ${isMobile ? "cart-indicator-bubble--mobile" : "cart-indicator-bubble--desktop"}`;
  bubble.innerHTML = `
    <span class="cart-indicator-icon">${isMobile ? "📍" : "🛒"}</span>
    <span class="cart-indicator-text">${
      isMobile ? "Abrí el menú para ver tu carrito" : "Acá está tu carrito"
    }</span>
  `.trim();
  document.body.appendChild(bubble);
  cartIndicatorBubble = bubble;

  positionCartIndicator(bubble, target);
  requestAnimationFrame(() => {
    bubble.classList.add("show");
  });

  cartIndicatorTimer = setTimeout(() => {
    clearCartIndicator();
  }, 3000);
}

function renderCartPreview(container) {
  const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
  if (cart.length === 0) {
    container.innerHTML = "<p>Carrito vacío</p>";
    return;
  }
  const items = cart
    .slice(0, 3)
    .map((i) => `<div class="prev-item">${i.name} x${i.quantity}</div>`)
    .join("");
  const total = cart.reduce(
    (sum, i) => sum + (i.price || 0) * (i.quantity || 0),
    0,
  );
  container.innerHTML =
    items +
    `<div class="prev-total">Total: $${total.toLocaleString("es-AR")}</div>`;
}

function attachCartPreview(a) {
  if (a.dataset.previewAttached) return;
  const preview = document.createElement("div");
  preview.className = "cart-preview";
  a.appendChild(preview);
  a.addEventListener("mouseenter", () => renderCartPreview(preview));
  a.addEventListener("focus", () => renderCartPreview(preview));
  a.dataset.previewAttached = "true";
}

/**
 * Actualiza el menú de navegación según el estado de autenticación y el carrito.
 * Muestra enlaces a "Mi cuenta" o "Admin" en lugar de "Acceder" si el usuario
 * está logueado, añade un contador de artículos al carrito y permite cerrar sesión.
 */
function updateNav() {
  const navUl = document.querySelector("header nav ul");
  if (!navUl) return;
  const role = localStorage.getItem("nerinUserRole");
  const token = localStorage.getItem("nerinToken");
  const loggedIn = Boolean(role && token);
  const name = localStorage.getItem("nerinUserName");
  const email = localStorage.getItem("nerinUserEmail");
  // Eliminar botones duplicados de Admin si existieran
  const adminLinks = navUl.querySelectorAll('a[href="/admin.html"]');
  if (adminLinks.length > 1) {
    adminLinks.forEach((link, idx) => {
      if (idx > 0 && link.parentElement) {
        link.parentElement.remove();
      }
    });
  }
  // Calcular cantidad total en el carrito
  let cartCount = 0;
  try {
    const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
    cartCount = cart.reduce((sum, item) => sum + (item.quantity || 0), 0);
  } catch (e) {
    cartCount = 0;
  }
  // Recorrer elementos <li> para encontrar enlaces
  const liItems = navUl.querySelectorAll("li");
  liItems.forEach((li) => {
    const a = li.querySelector("a");
    if (!a) return;
    const href = a.getAttribute("href");
    // Actualizar carrito
    if (href && href.includes("/cart.html")) {
      a.classList.add("cart-link");
      let icon = a.querySelector(".cart-icon");
      if (!icon) {
        icon = document.createElement("span");
        icon.className = "cart-icon";
        icon.textContent = "🛒";
        a.prepend(icon);
      }
      let countSpan = a.querySelector(".cart-count-badge");
      if (!countSpan) {
        countSpan = document.createElement("span");
        countSpan.className = "cart-count-badge";
        a.appendChild(countSpan);
      }
      countSpan.textContent = cartCount;
      countSpan.style.display = cartCount > 0 ? "inline-block" : "none";
      a.classList.remove("shake");
      void a.offsetWidth;
      if (cartCount > 0) a.classList.add("shake");
      attachCartPreview(a);
    }
    // Actualizar enlace de acceso
    if (href && href.includes("/login.html")) {
      if (loggedIn) {
        // Usuario autenticado: cambiar enlace a Admin o Mi cuenta
        if (role === "admin" || role === "vendedor") {
          a.textContent = "Admin";
          a.setAttribute("href", "/admin.html");
        } else if (role === "minorista") {
          a.textContent = "Mi cuenta";
          a.setAttribute("href", "/account-minorista.html");
        } else {
          a.textContent = "Mi cuenta";
          a.setAttribute("href", "/account.html");
        }
      } else {
        a.textContent = "Acceder";
        a.setAttribute("href", "/login.html");
      }
    }
  });
  // Añadir enlace de cierre de sesión si no existe y el usuario está autenticado
  if (loggedIn) {
    let logoutLi = navUl.querySelector("li.logout-item");
    if (!logoutLi) {
      logoutLi = document.createElement("li");
      logoutLi.className = "logout-item";
      const logoutLink = document.createElement("a");
      logoutLink.href = "#";
      logoutLink.textContent = "Cerrar sesión";
      logoutLink.addEventListener("click", (e) => {
        e.preventDefault();
        // Limpiar datos de sesión
        localStorage.removeItem("nerinToken");
        localStorage.removeItem("nerinUserRole");
        localStorage.removeItem("nerinUserName");
        localStorage.removeItem("nerinUserEmail");
        // Recargar página para reflejar cambios
        window.location.href = "/index.html";
      });
      logoutLi.appendChild(logoutLink);
      navUl.appendChild(logoutLi);
    }
    // Ocultar enlace de registro si existe
    const signupLi = navUl.querySelector("li.signup-item");
    if (signupLi) {
      signupLi.remove();
    }
  } else {
    // Si no hay sesión y existe botón de logout, eliminarlo
    const logoutLi = navUl.querySelector("li.logout-item");
    if (logoutLi) {
      logoutLi.remove();
    }
    // Asegurar que exista enlace de registro cuando no hay sesión
    let signupLi = navUl.querySelector("li.signup-item");
    if (!signupLi) {
      signupLi = document.createElement("li");
      signupLi.className = "signup-item";
      const signupLink = document.createElement("a");
      signupLink.href = "/register.html";
      signupLink.textContent = "Registrarse";
      signupLi.appendChild(signupLink);
      navUl.appendChild(signupLi);
    }
  }
}

// Exponer función globalmente para que otros módulos puedan actualizar la navegación
window.updateNav = updateNav;
window.showToast = showToast;
window.showCartIndicator = showCartIndicator;

// Escuchar cambios en almacenamiento para actualizar la navegación (p.ej. cuando
// se actualiza el carrito en otra pestaña)
window.addEventListener("storage", () => {
  updateNav();
});

function setupMobileMenu() {
  const toggle = document.getElementById("navToggle");
  const nav = document.querySelector("header nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => {
    nav.classList.toggle("open");
  });
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => nav.classList.remove("open"));
  });
}

function init() {
  loadConfig();
  setupMobileMenu();
}

document.addEventListener("DOMContentLoaded", init);
