const fs = require('fs');
const path = require('path');
const assert = require('assert');

const serverPath = path.join(__dirname, '..', 'backend', 'server.js');
const src = fs.readFileSync(serverPath, 'utf8');

assert(src.includes('function getCheckoutItemIdentifier(item = {})'), 'Debe existir helper getCheckoutItemIdentifier');
assert(src.includes('item?.id ||'), 'Caso 1: item con id');
assert(src.includes('item?.sku ||'), 'Caso 2: item con sku');
assert(src.includes('item?.productId ||'), 'Caso 3: item con productId');
assert(src.includes('item?.publicSlug ||'), 'Caso 4: item con publicSlug');
assert(src.includes('extractSlugFromCheckoutUrl(item?.url)'), 'Caso 5: item con url /p/slug');
assert(src.includes('El carrito contiene un producto sin identificador. Eliminá ese item y volvé a agregarlo desde el catálogo.'), 'Caso 6: error claro sin identificador');
assert(src.includes('[checkout-cart-item-invalid]'), 'Caso 6b: log item inválido');
assert(src.includes('El producto no tiene precio válido para Mercado Pago'), 'Caso 7: MP mantiene validación sin MEMORY_GUARD');
assert(src.includes('paymentMethod === "transferencia"'), 'Caso 8: transferencia mantiene flujo sin MEMORY_GUARD');
console.log('[test-checkout-cart-identifier-resolution] ok');
