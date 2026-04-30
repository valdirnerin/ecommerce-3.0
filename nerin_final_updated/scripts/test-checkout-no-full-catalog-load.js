const fs = require('fs');
const path = require('path');
const assert = require('assert');

const serverPath = path.join(__dirname, '..', 'backend', 'server.js');
const repoPath = path.join(__dirname, '..', 'backend', 'data', 'productsSqliteRepo.js');
const src = fs.readFileSync(serverPath, 'utf8');
const repoSrc = fs.readFileSync(repoPath, 'utf8');

assert(repoSrc.includes('async function getProductsByIdentifiers'), 'Debe existir getProductsByIdentifiers en SQLite repo');
assert(src.includes('[checkout-products-resolve:start]'), 'Falta log de inicio de resolución checkout');
assert(src.includes('[checkout-products-resolve:done]'), 'Falta log de fin de resolución checkout');
assert(src.includes('source: "sqlite"'), 'Checkout debe declarar source sqlite');

const checkoutSection = src.slice(src.indexOf('if (pathname === "/api/checkout"'), src.indexOf('// API: obtener costo de envío por provincia'));
assert(!checkoutSection.includes('getProducts('), 'Checkout no debe llamar getProducts()');
assert(checkoutSection.includes('resolveCheckoutCartItems'), 'Checkout debe resolver carrito usando sqlite');

const mpSection = src.slice(src.indexOf('/api/mercadopago/preference'), src.indexOf('if (pathname === "/api/payments/create-preference"'));
assert(!mpSection.includes('getProducts('), 'Preferencia MP no debe llamar getProducts()');
assert(mpSection.includes('currency_id: "ARS"'), 'MP debe enviar currency_id ARS');
assert(mpSection.includes('El producto no tiene precio válido para Mercado Pago'), 'Debe bloquear productos sin precio válido');

console.log('[test-checkout-no-full-catalog-load] ok');
