/*
 * API helper functions para el frontend de NERIN.
 *
 * Permiten interactuar con el backend para obtener productos y realizar
 * autenticación. Además gestionan el almacenamiento de tokens y roles
 * en localStorage.
 */

// Base URL del backend. Permite ser configurada desde el servidor a través
// de `window.NERIN_CONFIG.apiBase` o por una variable global `API_BASE_URL`.
// Al evaluarse en tiempo de ejecución siempre reflejará la última
// configuración disponible, aun cuando config.js cargue después que este
// módulo.
export function getApiBase() {
  return (
    (window.NERIN_CONFIG && window.NERIN_CONFIG.apiBase) ||
    window.API_BASE_URL ||
    ""
  );
}

export function buildApiUrl(path = "") {
  if (!path) return getApiBase();
  const isAbsolute = /^https?:\/\//i.test(path);
  if (isAbsolute) return path;
  const safePath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBase();
  if (!base) return safePath;
  const trimmedBase = base.replace(/\/+$/, "");
  return `${trimmedBase}${safePath}`;
}

export function apiFetch(path, options) {
  return fetch(buildApiUrl(path), options);
}

// Obtener la lista de productos desde el backend
export async function fetchProducts() {
  try {
    const res = await apiFetch("/api/products");
    if (!res.ok) {
      throw new Error("No se pudieron obtener los productos");
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.products)) {
      throw new Error("Respuesta de productos inválida");
    }
    const priceAccess = getPriceVisibility();
    return enforcePriceVisibility(data.products, priceAccess);
  } catch (error) {
    console.warn("Fallo el endpoint de productos, usando datos locales", error);
    try {
      const fallbackResponse = await fetch("/mock-data/products.json", {
        cache: "no-store",
      });
      if (!fallbackResponse.ok) {
        throw new Error("No se pudo cargar el fallback de productos");
      }
      const fallbackData = await fallbackResponse.json();
      if (fallbackData && Array.isArray(fallbackData.products)) {
        const priceAccess = getPriceVisibility();
        return enforcePriceVisibility(fallbackData.products, priceAccess);
      }
      throw new Error("Fallback de productos inválido");
    } catch (fallbackError) {
      console.error("Error al obtener productos", fallbackError);
      throw fallbackError;
    }
  }
}

// Iniciar sesión. Devuelve objeto con success, token y role
export async function login(email, password) {
  const res = await apiFetch("/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) {
    const data = await res.json();
    // Guardar token y rol en localStorage
    localStorage.setItem("nerinToken", data.token);
    localStorage.setItem("nerinUserRole", data.role);
    // También guardamos el nombre y correo del usuario para futuras operaciones
    localStorage.setItem("nerinUserName", data.name);
    localStorage.setItem("nerinUserEmail", email);
    if (data.profile && typeof data.profile === "object") {
      try {
        localStorage.setItem("nerinUserProfile", JSON.stringify(data.profile));
      } catch (storageError) {
        console.warn("No se pudo guardar el perfil del usuario", storageError);
      }
    }
    // Registrar la fecha y hora del último inicio de sesión
    localStorage.setItem("nerinLastLogin", new Date().toISOString());
    return data;
  } else {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || "Error de autenticación");
  }
}

// Obtener rol de usuario almacenado
export function getUserRole() {
  return localStorage.getItem("nerinUserRole");
}

// Cerrar sesión
export function logout() {
  localStorage.removeItem("nerinToken");
  localStorage.removeItem("nerinUserRole");
  localStorage.removeItem("nerinUserName");
}

// Determinar si el usuario es mayorista (ver precios mayoristas)
const WHOLESALE_LOCKED_COPY =
  "Ingresá con tu cuenta mayorista verificada para ver tu tarifa";

function safeParseProfile(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (err) {
    console.warn("profile-parse", err);
    return null;
  }
}

function isWholesaleApproved(profile, role) {
  const roleWholesale =
    role === "mayorista" || role === "admin" || role === "vip";
  if (!profile) return roleWholesale;

  const status = profile.wholesaleStatus || profile.wholesale_status || profile.status;
  const explicitApproval =
    profile.wholesaleApproved === true || status === "approved" || status === "aprobada";
  const explicitDenial = status && !["approved", "aprobada"].includes(status);
  const profileRole =
    profile.account_type === "mayorista" || profile.role === "mayorista";

  if (explicitDenial) return false;
  if (explicitApproval) return true;
  return roleWholesale || profileRole;
}

export function getPriceVisibility(session) {
  const storedRole = getUserRole();
  const profile = safeParseProfile(localStorage.getItem("nerinUserProfile"));
  const role = session?.role ?? storedRole;
  const canSeeWholesale = isWholesaleApproved(session?.profile ?? profile, role);
  return {
    role: canSeeWholesale ? "wholesale" : role ? "retail" : "guest",
    canSeeWholesale,
    placeholder: WHOLESALE_LOCKED_COPY,
  };
}

export function isWholesale() {
  return getPriceVisibility().canSeeWholesale;
}

function stripWholesalePricing(product) {
  if (!product || typeof product !== "object") return product;
  const cleaned = { ...product };
  ["price_mayorista", "wholesalePrice", "techPrice", "precio_tecnico"].forEach(
    (field) => {
      if (field in cleaned) delete cleaned[field];
    },
  );
  if (cleaned.pricing && typeof cleaned.pricing === "object") {
    const pricing = { ...cleaned.pricing };
    delete pricing.wholesale;
    cleaned.pricing = pricing;
  }
  return cleaned;
}

export function enforcePriceVisibility(products, priceAccess = getPriceVisibility()) {
  if (priceAccess.canSeeWholesale) return products;
  if (Array.isArray(products)) {
    return products.map((item) => stripWholesalePricing(item));
  }
  return stripWholesalePricing(products);
}

export { WHOLESALE_LOCKED_COPY };

if (typeof window !== "undefined") {
  if (!window.NERIN_BUILD_API_URL) {
    window.NERIN_BUILD_API_URL = buildApiUrl;
  }
  if (!window.NERIN_API_FETCH) {
    window.NERIN_API_FETCH = apiFetch;
  }
}
