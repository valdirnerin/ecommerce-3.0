// Mercado Pago public key
// Read from environment variable or build-time config to avoid hardcoding secrets
globalThis.MP_PUBLIC_KEY =
  (typeof process !== 'undefined' && process.env.MP_PUBLIC_KEY) ||
  'APP_USR-REPLACE_ME';

// URL del backend en Render (Web Service) — REEMPLAZAR con el URL real
globalThis.API_BASE_URL = "https://ecommerce-3-0.onrender.com";
