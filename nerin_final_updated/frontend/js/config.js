import { apiFetch } from "./api.js";
import { startTracking, trackEvent } from "./tracker.js";

const CONFIG_CACHE_KEY = "nerin:config-cache";

function readCachedConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (err) {
    console.warn("config-cache-read", err);
  }
  return null;
}

function writeCachedConfig(cfg) {
  try {
    localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(cfg || {}));
  } catch (err) {
    console.warn("config-cache-write", err);
  }
}

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
  if (cfg.show && typeof cfg.show === "object") {
    window.NERIN_CONFIG = window.NERIN_CONFIG || {};
    window.NERIN_CONFIG.showPartners = cfg.show.partners !== false;
  }
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
  const cached = readCachedConfig();
  if (cached) {
    window.NERIN_CONFIG = cached;
    applySeoConfig(cached);
    dispatchConfigLoaded(cached);
  }
  try {
    const res = await apiFetch("/api/config");
    if (!res.ok) throw new Error("No se pudo obtener la configuración");
    cfg = await res.json();
    // Exponer a nivel global
    window.NERIN_CONFIG = cfg;
    writeCachedConfig(cfg);
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
      document.querySelectorAll("[data-whatsapp-link]").forEach((link) => {
        if (
          typeof HTMLAnchorElement !== "undefined" &&
          !(link instanceof HTMLAnchorElement)
        ) {
          return;
        }
        const template = link.dataset.whatsappMessage || "";
        let query = "";
        if (template) {
          const rendered = template
            .replace(/\{\{\s*(phone|numero|number)\s*\}\}/gi, cfg.whatsappNumber)
            .trim();
          if (rendered) {
            query = `?text=${encodeURIComponent(rendered)}`;
          }
        }
        const targetHref = `https://wa.me/${phone}${query}`;
        if (link.href !== targetHref) {
          link.href = targetHref;
        }
        if (!link.target) {
          link.target = "_blank";
        }
        const relValues = new Set((link.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
        relValues.add("noopener");
        relValues.add("noreferrer");
        link.setAttribute("rel", Array.from(relValues).join(" "));
        link.dataset.whatsappNumber = phone;
      });
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
      if (typeof window.fbq !== "function") {
        const fbScript = document.createElement("script");
        fbScript.innerHTML = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod? n.callMethod.apply(n, arguments):n.queue.push(arguments);}; if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s);}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js'); fbq('init', '${cfg.metaPixelId}'); fbq('track', 'PageView');`;
        document.head.appendChild(fbScript);
      }
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
  const text = typeof message === "string" ? message : String(message || "");
  if (typeof Toastify !== "undefined") {
    try {
      if (lastToastInstance && typeof lastToastInstance.hideToast === "function") {
        lastToastInstance.hideToast();
      }
    } catch (err) {
      console.warn("toast-hide-error", err);
    }
    lastToastInstance = Toastify({
      text,
      duration: 3200,
      gravity: "top",
      position: "center",
      style: { background: "var(--color-success)" },
    });
    lastToastInstance.showToast();
    return lastToastInstance;
  }
  if (typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(text);
  }
  return null;
}

let cartIndicatorTimer = null;
let cartIndicatorBubble = null;
let cartIndicatorTarget = null;
let cartIndicatorCleanup = null;
let lastToastInstance = null;
let cartPreviewHideTimer = null;

function readCartItems() {
  try {
    const parsed = JSON.parse(localStorage.getItem("nerinCart") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function saveCartItems(items) {
  localStorage.setItem("nerinCart", JSON.stringify(items));
  updateNav();
}

function trackCartPreviewEvent(action, metadata = {}) {
  try {
    trackEvent("cart_preview_interaction", {
      status: "active",
      step: "Carrito",
      metadata: {
        action,
        ...metadata,
      },
    });
  } catch (err) {
    console.warn("tracker:cart_preview_interaction", err);
  }
}

function clearCartIndicator(immediate = false) {
  if (cartIndicatorTimer) {
    clearTimeout(cartIndicatorTimer);
    cartIndicatorTimer = null;
  }
  if (typeof cartIndicatorCleanup === "function") {
    cartIndicatorCleanup();
    cartIndicatorCleanup = null;
  }
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.remove("cart-indicator-visible");
  }
  if (cartIndicatorBubble) {
    const panel = cartIndicatorBubble;
    cartIndicatorBubble = null;
    if (!immediate) {
      panel.classList.remove("show");
      setTimeout(() => panel.remove(), 180);
    } else {
      panel.remove();
    }
  }
  if (cartIndicatorTarget) {
    cartIndicatorTarget.classList.remove("cart-link--highlight", "menu-toggle--highlight");
    cartIndicatorTarget = null;
  }
}

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString("es-AR")}`;
}

function showCartIndicator(options = {}) {
  const opts =
    typeof options === "string"
      ? { message: options }
      : options && typeof options === "object"
        ? { ...options }
        : {};

  const messageText = (opts.message && String(opts.message).trim()) || "Producto agregado al carrito";
  const duration = Number.isFinite(opts.duration) ? Math.max(Number(opts.duration), 3800) : 7000;
  const allowFallbackToast = opts.fallbackToast !== false;

  try {
    trackEvent("add_to_cart", {
      status: "active",
      step: "Carrito",
      productId: opts.productId,
      productName: opts.productName,
      metadata:
        opts && (opts.productSku || opts.source)
          ? {
              sku: opts.productSku,
              source: opts.source,
            }
          : undefined,
    });
  } catch (err) {
    console.warn("tracker:add_to_cart", err);
  }

  const runFallback = () => {
    if (!allowFallbackToast) return false;
    if (typeof showToast === "function") {
      showToast(`✅ ${messageText}`);
    } else if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(`✅ ${messageText}`);
    }
    return false;
  };

  if (!document || !document.body) {
    return runFallback();
  }

  const cart = readCartItems();
  const addedItem =
    cart.find((item) => String(item.id) === String(opts.productId || "")) ||
    cart.find((item) => item.name === opts.productName) ||
    cart[cart.length - 1] ||
    null;

  const cartTotals = cart.reduce(
    (acc, item) => {
      const qty = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      if (qty > 0) {
        acc.items += qty;
        acc.value += qty * price;
      }
      return acc;
    },
    { items: 0, value: 0 },
  );

  clearCartIndicator(true);

  const popup = document.createElement("aside");
  popup.className = "cart-indicator-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-modal", "false");
  popup.setAttribute("aria-label", "Producto agregado al carrito");

  popup.innerHTML = `
    <button type="button" class="cart-indicator-close" aria-label="Cerrar">✕</button>
    <h3 class="cart-indicator-title">¡Agregado al carrito!</h3>
    <div class="cart-indicator-layout">
      <div class="cart-indicator-product">
        <div class="cart-indicator-thumb-wrap">
          <img class="cart-indicator-thumb" src="${addedItem?.image || "/assets/placeholder-product.png"}" alt="${addedItem?.name || "Producto"}" loading="lazy" />
        </div>
        <div class="cart-indicator-product-copy">
          <strong>${addedItem?.name || messageText}</strong>
          <span>Cantidad: ${Number(addedItem?.quantity || 1)}</span>
          <span>Precio unitario: ${formatMoney(addedItem?.price || 0)}</span>
        </div>
      </div>
      <div class="cart-indicator-summary">
        <span>${cartTotals.items} ${cartTotals.items === 1 ? "producto" : "productos"} en carrito</span>
        <span>Subtotal</span>
        <strong>${formatMoney(cartTotals.value)}</strong>
        <small>Envío se calcula en checkout</small>
      </div>
    </div>
    <div class="cart-indicator-actions">
      <a href="/cart.html" class="cart-indicator-btn cart-indicator-btn--primary" data-action="view_cart">Ver carrito</a>
      <a href="/checkout-steps.html" class="cart-indicator-btn" data-action="checkout">Finalizar compra</a>
      <button type="button" class="cart-indicator-btn cart-indicator-btn--ghost" data-action="keep_shopping">Seguir comprando</button>
    </div>
  `;

  document.body.appendChild(popup);
  cartIndicatorBubble = popup;
  document.body.classList.add("cart-indicator-visible");

  const closePopup = (reason) => {
    if (reason) {
      trackCartPreviewEvent("popup_close", { reason });
    }
    clearCartIndicator();
  };

  const closeButton = popup.querySelector(".cart-indicator-close");
  if (closeButton) {
    closeButton.addEventListener("click", () => closePopup("close_button"));
  }

  popup.querySelectorAll("[data-action]").forEach((node) => {
    node.addEventListener("click", () => {
      const action = node.getAttribute("data-action") || "unknown";
      trackCartPreviewEvent("popup_action", { action });
      if (action === "keep_shopping") {
        closePopup("keep_shopping");
      }
    });
  });

  const onKeydown = (event) => {
    if (event.key === "Escape") {
      closePopup("escape");
    }
  };
  document.addEventListener("keydown", onKeydown);

  cartIndicatorCleanup = () => {
    document.removeEventListener("keydown", onKeydown);
  };

  requestAnimationFrame(() => popup.classList.add("show"));

  cartIndicatorTimer = setTimeout(() => {
    closePopup("timeout");
  }, duration);

  return true;
}

function renderCartPreview(container) {
  const cart = readCartItems();
  if (cart.length === 0) {
    container.innerHTML = `
      <div class="cart-preview__panel cart-preview__panel--empty">
        <p class="cart-preview__empty-title">Tu carrito está vacío</p>
        <p class="cart-preview__empty-text">Agregá productos para ver un resumen rápido acá.</p>
        <a class="cart-preview__cta" href="/shop.html">Explorar productos</a>
      </div>
    `;
    return;
  }

  const items = cart
    .slice(0, 4)
    .map(
      (item, index) => `
      <div class="prev-item" data-index="${index}">
        <div class="prev-item__content">
          <div class="prev-item__name">${item.name || "Producto"}</div>
          <div class="prev-item__meta">$${Number(item.price || 0).toLocaleString("es-AR")} c/u</div>
        </div>
        <div class="prev-item__actions">
          <button type="button" class="preview-qty-btn" data-preview-action="decrease" data-index="${index}" aria-label="Quitar una unidad">−</button>
          <span class="prev-item__qty">${Number(item.quantity || 0)}</span>
          <button type="button" class="preview-qty-btn" data-preview-action="increase" data-index="${index}" aria-label="Sumar una unidad">+</button>
        </div>
      </div>`,
    )
    .join("");

  const totals = cart.reduce(
    (acc, item) => {
      const qty = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      if (qty > 0) {
        acc.items += qty;
        acc.value += qty * price;
      }
      return acc;
    },
    { items: 0, value: 0 },
  );

  container.innerHTML = `
    <div class="cart-preview__panel">
      <div class="cart-preview__header">
        <strong>Tu carrito</strong>
        <span>${totals.items} ${totals.items === 1 ? "producto" : "productos"}</span>
      </div>
      <div class="cart-preview__items">${items}</div>
      <div class="prev-total">Total: <strong>$${totals.value.toLocaleString("es-AR")}</strong></div>
      <div class="cart-preview__actions">
        <a class="cart-preview__cta cart-preview__cta--ghost" href="/shop.html">Seguir comprando</a>
        <a class="cart-preview__cta" href="/cart.html">Ir al carrito</a>
      </div>
    </div>`;
}

function updatePreviewItemQuantity(index, delta) {
  const cart = readCartItems();
  const item = cart[index];
  if (!item) return;

  const nextQty = Number(item.quantity || 0) + delta;
  if (nextQty <= 0) {
    cart.splice(index, 1);
    trackCartPreviewEvent("remove_item", { itemName: item.name });
  } else {
    item.quantity = nextQty;
    cart[index] = item;
    trackCartPreviewEvent(delta > 0 ? "increase_qty" : "decrease_qty", {
      itemName: item.name,
      quantity: nextQty,
    });
  }
  saveCartItems(cart);
}

function attachCartPreview(a) {
  if (a.dataset.previewAttached) return;
  const preview = document.createElement("div");
  preview.className = "cart-preview";
  preview.setAttribute("role", "dialog");
  preview.setAttribute("aria-label", "Vista previa del carrito");
  a.appendChild(preview);

  const openPreview = () => {
    if (cartPreviewHideTimer) {
      clearTimeout(cartPreviewHideTimer);
      cartPreviewHideTimer = null;
    }
    renderCartPreview(preview);
    preview.classList.add("is-visible");
    trackCartPreviewEvent("open_preview", {
      trigger: window.matchMedia("(hover: hover)").matches ? "hover" : "tap",
    });
  };

  const hidePreview = () => {
    preview.classList.remove("is-visible");
  };

  const closePreview = () => {
    if (cartPreviewHideTimer) clearTimeout(cartPreviewHideTimer);
    cartPreviewHideTimer = setTimeout(hidePreview, 140);
  };

  const onDocumentClick = (event) => {
    if (!preview.classList.contains("is-visible")) return;
    if (a.contains(event.target)) return;
    hidePreview();
  };

  const onDocumentKeydown = (event) => {
    if (event.key === "Escape") {
      hidePreview();
    }
  };

  a.addEventListener("mouseenter", openPreview);
  a.addEventListener("focus", openPreview);
  a.addEventListener("mouseleave", closePreview);
  a.addEventListener("blur", closePreview);
  a.addEventListener("click", (event) => {
    if (window.matchMedia("(hover: none)").matches) {
      const willOpen = !preview.classList.contains("is-visible");
      if (willOpen) {
        event.preventDefault();
        openPreview();
      }
    }
  });

  preview.addEventListener("mouseenter", () => {
    if (cartPreviewHideTimer) {
      clearTimeout(cartPreviewHideTimer);
      cartPreviewHideTimer = null;
    }
  });
  preview.addEventListener("mouseleave", closePreview);
  preview.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-preview-action]");
    if (!btn) return;
    event.preventDefault();
    const index = Number(btn.dataset.index);
    const action = btn.dataset.previewAction;
    updatePreviewItemQuantity(index, action === "increase" ? 1 : -1);
    renderCartPreview(preview);
  });

  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown);

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
  const config = window.NERIN_CONFIG || {};
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
    if (href && href.includes("/partners.html")) {
      const shouldShow = config.showPartners !== false;
      li.style.display = shouldShow ? "" : "none";
      return;
    }
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
  startTracking();
  loadConfig();
  setupMobileMenu();
}

document.addEventListener("DOMContentLoaded", init);
