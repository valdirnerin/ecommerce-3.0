// Mercado Pago public key
// Read from environment variable or build-time config to avoid hardcoding secrets
globalThis.MP_PUBLIC_KEY =
  (typeof process !== 'undefined' && process.env.MP_PUBLIC_KEY) || '';

// URL del backend en Render (Web Service) — REEMPLAZAR con el URL real
globalThis.API_BASE_URL = "https://TU-BACKEND-WEBSERVICE.onrender.com";
