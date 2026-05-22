#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const files = {
  analytics: "frontend/js/analytics.js",
  autotrack: "frontend/js/analytics-autotrack.js",
  shop: "frontend/js/shop.js",
  product: "frontend/js/product.js",
  cart: "frontend/js/cart.js",
  checkout: "frontend/js/checkout-steps.js",
  success: "frontend/js/success.js",
};

const sources = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, exists(file) ? read(file) : ""]),
);

function hasAll(source, patterns) {
  return patterns.every((pattern) => source.includes(pattern));
}

const requiredExports = [
  "trackViewItem",
  "trackViewItemList",
  "trackSelectItem",
  "trackSearch",
  "trackAddToCart",
  "trackViewCart",
  "trackBeginCheckout",
  "trackAddShippingInfo",
  "trackAddPaymentInfo",
  "trackPurchase",
  "trackWhatsappClick",
  "trackStockRealProductView",
  "trackStockRealAddToCart",
  "trackStockRealPurchase",
  "normalizeAnalyticsItem",
];

const hookChecks = [
  { event: "view_item", ok: hasAll(sources.product, ["trackViewItem(product)", "trackStockRealProductView(product)"]) },
  { event: "view_item_list", ok: sources.shop.includes("trackViewItemList(") && sources.autotrack.includes("trackViewItemList(") },
  { event: "select_item", ok: sources.shop.includes("trackSelectItem(") && sources.autotrack.includes("trackSelectItem(") },
  { event: "search", ok: sources.shop.includes("trackSearch(") },
  { event: "add_to_cart", ok: sources.shop.includes("trackAddToCart(") && sources.product.includes("trackAddToCart(") },
  { event: "remove_from_cart", ok: sources.cart.includes("trackRemoveFromCart(") },
  { event: "view_cart", ok: sources.cart.includes("trackViewCart(cart)") },
  { event: "begin_checkout", ok: sources.cart.includes("trackBeginCheckout(cart)") && sources.checkout.includes("trackBeginCheckout(cart)") },
  { event: "add_shipping_info", ok: sources.checkout.includes("trackAddShippingInfo(") },
  { event: "add_payment_info", ok: sources.checkout.includes("trackAddPaymentInfo(") },
  { event: "purchase", ok: sources.success.includes("trackPurchase(") && sources.checkout.includes("trackPurchase(") },
  { event: "whatsapp_click", ok: sources.autotrack.includes("trackWhatsappClick(") && sources.cart.includes("trackWhatsappClick(") },
];

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

const htmlFiles = fs.readdirSync(path.join(root, "frontend"))
  .filter((name) => name.endsWith(".html"))
  .map((name) => `frontend/${name}`);

const duplicateTags = [];
for (const file of htmlFiles) {
  const html = read(file);
  const gaLoaders = countMatches(html, /googletagmanager\.com\/gtag\/js\?id=/g);
  const gaConfigs = countMatches(html, /gtag\(['"]config['"]/g);
  const metaInits = countMatches(html, /fbq\(['"]init['"]/g);
  const metaScripts = countMatches(html, /connect\.facebook\.net\/[^"']+\/fbevents\.js/g);
  if (gaLoaders > 1 || gaConfigs > 1 || metaInits > 1 || metaScripts > 1) {
    duplicateTags.push({ file, gaLoaders, gaConfigs, metaInits, metaScripts });
  }
}

const exportChecks = requiredExports.map((name) => ({
  name,
  ok: sources.analytics.includes(`export function ${name}`),
}));

const coreChecks = [
  {
    name: "normalizeAnalyticsItem genera item_id, item_name, price y currency ARS",
    ok: hasAll(sources.analytics, ["item_id:", "item_name:", "price:", 'currency: ANALYTICS_CURRENCY']),
  },
  {
    name: "purchase requiere transaction_id",
    ok: hasAll(sources.analytics, ["function orderTransactionId", "if (!transactionId)"]),
  },
  {
    name: "purchase se deduplica con localStorage/sessionStorage",
    ok: hasAll(sources.analytics, ["PURCHASE_DEDUPE_PREFIX", "localStorage", "sessionStorage", "storageHas", "storageSet"]),
  },
  {
    name: "stock real agrega is_stock_real=true",
    ok: hasAll(sources.analytics, ["is_stock_real:", "isStockRealProduct"]),
  },
  {
    name: "preorder agrega is_preorder=true",
    ok: hasAll(sources.analytics, ["is_preorder:", "isPreorderProduct"]),
  },
  {
    name: "whatsapp_click incluye source",
    ok: hasAll(sources.analytics, ['"whatsapp_click"', "source:"]),
  },
  {
    name: "no rompe si gtag/fbq no existen",
    ok: hasAll(sources.analytics, ['typeof window.gtag === "function"', 'typeof window.fbq === "function"']),
  },
  {
    name: "eventos ecommerce usan items array y ARS",
    ok: hasAll(sources.analytics, ["items:", 'const ANALYTICS_CURRENCY = "ARS"']),
  },
];

const htmlAutotrack = [
  "frontend/index.html",
  "frontend/shop.html",
  "frontend/product.html",
  "frontend/cart.html",
  "frontend/checkout-steps.html",
  "frontend/success.html",
].map((file) => ({ file, ok: read(file).includes("/js/analytics-autotrack.js") }));

const failures = [
  ...exportChecks.filter((check) => !check.ok).map((check) => `export faltante: ${check.name}`),
  ...hookChecks.filter((check) => !check.ok).map((check) => `hook faltante: ${check.event}`),
  ...coreChecks.filter((check) => !check.ok).map((check) => `check fallido: ${check.name}`),
  ...htmlAutotrack.filter((check) => !check.ok).map((check) => `autotrack no incluido: ${check.file}`),
  ...duplicateTags.map((entry) => `tag duplicado: ${entry.file}`),
];

const report = {
  totalChecks: exportChecks.length + hookChecks.length + coreChecks.length + htmlAutotrack.length,
  requiredExports: exportChecks,
  hooks: hookChecks,
  coreChecks,
  htmlAutotrack,
  duplicateTags,
  purchaseDeduplication: {
    requiresTransactionId: coreChecks[1].ok,
    usesLocalStorage: sources.analytics.includes("localStorage"),
    usesSessionStorage: sources.analytics.includes("sessionStorage"),
  },
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
