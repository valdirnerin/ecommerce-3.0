import { trackSelectItem, trackViewItemList, trackWhatsappClick } from "./analytics.js";

const SEO_PATHS = new Set([
  "/stock-real",
  "/pantallas-en-stock",
  "/baterias-en-stock",
  "/repuestos-samsung",
  "/repuestos-iphone",
]);

function pageSource() {
  const path = window.location.pathname || "";
  if (path === "/" || path.endsWith("/index.html")) return "home";
  if (path.includes("checkout")) return "checkout";
  if (path.includes("cart")) return "cart";
  if (path.includes("shop")) return new URLSearchParams(window.location.search).get("stock") === "real" ? "shop_stock_real" : "shop";
  if (SEO_PATHS.has(path) || path.startsWith("/repuestos-samsung/") || path.startsWith("/repuestos-iphone/")) return path.replace(/^\//, "") || "seo";
  if (path.startsWith("/p/") || path.includes("product.html")) return "product_page";
  return "site";
}

function productFromElement(element) {
  const node = element?.closest?.("[data-product-id], [data-sku], .organic-product-card, .product-card");
  if (!node) return {};
  const title = node.dataset.productName || node.dataset.title || node.querySelector("h2,h3,.product-title,.organic-product-card__title")?.textContent || "";
  const priceText = node.dataset.price || node.querySelector("[data-price],.price,.price-final,.organic-product-card__price")?.textContent || "";
  const price = Number(String(priceText).replace(/[^0-9.,-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
  return {
    id: node.dataset.productId || node.dataset.id || "",
    sku: node.dataset.sku || "",
    slug: node.dataset.slug || node.querySelector("a[href^='/p/']")?.getAttribute("href")?.split("/p/")[1] || "",
    name: title.trim(),
    title: title.trim(),
    price,
    brand: node.dataset.brand || "",
    category: node.dataset.category || "",
    stock: Number(node.dataset.stock || node.dataset.stockQty || 0) || 0,
    availability: node.dataset.availability || node.dataset.stockStatus || "",
  };
}

function collectSeoProducts() {
  return Array.from(document.querySelectorAll("[data-product-id], [data-sku], .organic-product-card, .product-card"))
    .map(productFromElement)
    .filter((product) => product.name || product.id || product.sku)
    .slice(0, 100);
}

function bindWhatsappTracking() {
  document.addEventListener("click", (event) => {
    const link = event.target?.closest?.("a[href*='wa.me'], a[href*='api.whatsapp.com'], a[href*='whatsapp.com/send'], [data-whatsapp-link]");
    if (!link) return;
    const product = productFromElement(link);
    trackWhatsappClick({
      source: link.dataset.analyticsSource || pageSource(),
      product_id: product.id,
      sku: product.sku,
      product_name: product.name,
      stock_status: product.availability,
      is_stock_real: product.stock > 0 && product.availability !== "preorder" && product.availability !== "backorder",
      href: link.getAttribute("href") || "",
    });
  }, true);
}

function bindSeoListTracking() {
  const source = pageSource();
  const path = window.location.pathname || "";
  if (!(SEO_PATHS.has(path) || path.startsWith("/repuestos-samsung/") || path.startsWith("/repuestos-iphone/"))) return;
  const products = collectSeoProducts();
  if (products.length) {
    trackViewItemList(products, {
      source,
      page_path: path,
      item_list_id: source,
      item_list_name: document.querySelector("h1")?.textContent?.trim() || source,
    });
  }
  document.addEventListener("click", (event) => {
    const link = event.target?.closest?.("a[href^='/p/'], .organic-product-card a, .product-card a");
    if (!link) return;
    const product = productFromElement(link);
    if (product.name || product.id || product.sku) {
      trackSelectItem(product, { source, page_path: path });
    }
  }, true);
}

function init() {
  bindWhatsappTracking();
  bindSeoListTracking();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
