#!/usr/bin/env node
"use strict";

const { classifyCatalogProduct, parseCatalogQuery } = require("../backend/utils/catalogClassifier");

const input = process.argv.slice(2).join(" ").trim();

if (!input) {
  console.error('Uso: node scripts/debug-classify-product.js "Display for Google Pixel 7 Pro Black"');
  process.exit(1);
}

const classification = classifyCatalogProduct({
  id: "debug",
  sku: "debug",
  name: input,
  title: input,
  description: input,
  stock: 1,
  price: 1,
});

console.log(JSON.stringify({
  input,
  classification,
  queryIntent: parseCatalogQuery(input),
}, null, 2));
