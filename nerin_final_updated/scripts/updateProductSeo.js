#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { applyProductSeo } = require("../backend/utils/productSeo");

function loadProductsFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ Archivo no encontrado: ${filePath}`);
    return { products: [], wrapped: true };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw || "{}", null, 2);
  const wrapped = Array.isArray(json?.products) || json?.products === undefined;
  const products = Array.isArray(json?.products) ? json.products : Array.isArray(json) ? json : [];
  return { products, wrapped };
}

function saveProductsFile(filePath, products, wrapped = true) {
  const payload = wrapped ? { products } : products;
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function updateFile(targetPath) {
  const { products, wrapped } = loadProductsFile(targetPath);
  let touched = 0;
  let copiedLegacy = 0;
  const updated = products.map((product) => {
    const beforeTitle = product.seoTitle;
    const beforeDesc = product.seoDescription;
    const { product: withSeo, updated: changed } = applyProductSeo(product);
    const after = { ...withSeo };
    if (!after.meta_title && after.seoTitle) after.meta_title = after.seoTitle;
    if (!after.meta_description && after.seoDescription) after.meta_description = after.seoDescription;
    if (changed) touched += 1;
    if (!beforeTitle && withSeo.seoTitle) copiedLegacy += 1;
    return after;
  });
  saveProductsFile(targetPath, updated, wrapped);
  console.log(
    `✅ ${path.relative(process.cwd(), targetPath)} actualizado. ${touched} productos optimizados, ${copiedLegacy} recibieron SEO desde valores existentes.`,
  );
}

function main() {
  const targets = [
    path.join(__dirname, "../data/products.json"),
    path.join(__dirname, "../frontend/mock-data/products.json"),
  ];
  console.log("Generando títulos y descripciones SEO para los productos existentes…\n");
  targets.forEach(updateFile);
  console.log("\nListo. Ejecutá este script con `node scripts/updateProductSeo.js` siempre que quieras rellenar SEO faltante.");
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("❌ Error actualizando SEO de productos", err);
    process.exit(1);
  }
}
