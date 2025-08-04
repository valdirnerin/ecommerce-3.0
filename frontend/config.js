// Mercado Pago public key
// Read from environment variable or build-time config to avoid hardcoding secrets
globalThis.MP_PUBLIC_KEY =
  (typeof process !== 'undefined' && process.env.MP_PUBLIC_KEY) || '';

// Backend API base URL
globalThis.API_BASE_URL =
  (typeof process !== 'undefined' && process.env.API_BASE_URL) ||
  'https://ecommerce-3-0.onrender.com';
