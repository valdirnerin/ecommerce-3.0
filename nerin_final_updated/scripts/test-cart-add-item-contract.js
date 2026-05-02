const fs = require('fs');
const path = require('path');
const assert = require('assert');

const shop = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'shop.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'index.js'), 'utf8');
const product = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'product.js'), 'utf8');
const cart = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'cart.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'backend', 'server.js'), 'utf8');

assert(shop.includes('No se pudo agregar el producto porque falta identificador.'), 'shop addToCart bloquea sin identifier');
assert(index.includes('No se pudo agregar el producto porque falta identificador.'), 'home addToCart bloquea sin identifier');
assert(product.includes('No se pudo agregar el producto porque falta identificador.'), 'product detail addToCart bloquea sin identifier');
assert(index.includes('identifier,'), 'index guarda identifier en cart item');
assert(index.includes('sku: product.sku || ""'), 'index guarda sku');
assert(index.includes('publicSlug: product.publicSlug || product.public_slug || ""'), 'index guarda publicSlug');
assert(index.includes('name: product.name'), 'index guarda name');
assert(index.includes('price,'), 'index guarda price');
assert(index.includes('quantity: Math.min(qty, available)'), 'index guarda quantity');
assert(server.includes('const identifiers = cart.map((item) => getCheckoutItemIdentifier(item)).filter(Boolean);'), 'checkout usa identifiers no vacíos');
assert(cart.includes('Algunos productos viejos del carrito fueron removidos porque faltaba información. Volvé a agregarlos desde el catálogo.'), 'carrito viejo inválido se limpia con mensaje');
console.log('[test-cart-add-item-contract] ok');
