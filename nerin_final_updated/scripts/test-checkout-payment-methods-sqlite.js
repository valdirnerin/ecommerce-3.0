const fs = require('fs');
const path = require('path');
const assert = require('assert');

const serverPath = path.join(__dirname, '..', 'backend', 'server.js');
const src = fs.readFileSync(serverPath, 'utf8');

assert(src.includes('if (pathname === "/api/orders" && req.method === "POST")'), 'Debe existir endpoint /api/orders POST');
assert(src.includes('resolvedItems = await resolveCheckoutCartItems(items);'), 'Orders checkout debe usar SQLite para resolver productos');
assert(!src.includes('if (pathname === "/api/orders" && req.method === "POST")\n') || !src.includes('const products = getProducts();'), 'Orders checkout no debe usar getProducts');
assert(src.includes('paymentMethod === "transferencia"'), 'Debe mantener flujo transferencia');
assert(src.includes('paymentMethod === "mercado_pago"'), 'Debe mantener flujo mercado pago');
assert(src.includes('[checkout-payment:create-preference]'), 'Debe loguear creación de preferencia');
assert(src.includes('resolveCheckoutCartItems(cartItemsForLookup)'), 'Preferencia MP usa SQLite');
assert(src.includes('Producto no encontrado en catálogo rápido'), 'Debe devolver error claro para faltantes');
assert(src.includes('El producto no tiene precio válido para Mercado Pago'), 'Debe bloquear precio inválido');

console.log('[test-checkout-payment-methods-sqlite] ok');
