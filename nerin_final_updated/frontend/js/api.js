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
  const res = await apiFetch("/api/products");
  if (!res.ok) {
    throw new Error("No se pudieron obtener los productos");
  }
  const data = await res.json();
  return data.products;
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
export function isWholesale() {
  const role = getUserRole();
  // Los clientes VIP también acceden a precios mayoristas y descuentos
  return role === "mayorista" || role === "admin" || role === "vip";
}

if (typeof window !== "undefined") {
  if (!window.NERIN_BUILD_API_URL) {
    window.NERIN_BUILD_API_URL = buildApiUrl;
  }
  if (!window.NERIN_API_FETCH) {
    window.NERIN_API_FETCH = apiFetch;
  }
}
