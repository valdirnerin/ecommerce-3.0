// Mercado Pago public key
// Read from environment variable or build-time config to avoid hardcoding secrets
globalThis.MP_PUBLIC_KEY =
  (typeof process !== 'undefined' && process.env.MP_PUBLIC_KEY) ||
  'APP_USR-c28b783a-54c0-4e39-80d3-f8c7dae2b645';

// URL del backend en Render (Web Service) — REEMPLAZAR con el URL real
globalThis.API_BASE_URL = "https://nerinparts.com.ar";
