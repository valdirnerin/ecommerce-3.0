// Manejo del formulario de contacto en la página principal

import { fetchProducts, isWholesale } from "./api.js";

function buildProductUrl(product) {
  if (product && typeof product.slug === "string") {
    const slug = product.slug.trim();
    if (slug) return `/p/${encodeURIComponent(slug)}`;
  }
  const id = product?.id != null ? String(product.id) : "";
  return `/product.html?id=${encodeURIComponent(id)}`;
}

function getPrimaryImage(product) {
  if (Array.isArray(product.images) && product.images.length) {
    return product.images[0];
  }
  return product.image;
}

const PLACEHOLDER_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function addToCart(product) {
  const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
  const existing = cart.find((item) => item.id === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    const price = isWholesale()
      ? product.price_mayorista
      : product.price_minorista;
    cart.push({
      id: product.id,
      name: product.name,
      price,
      quantity: 1,
      image: getPrimaryImage(product) || PLACEHOLDER_IMAGE,
    });
  }
  localStorage.setItem("nerinCart", JSON.stringify(cart));
  if (window.updateNav) window.updateNav();
  if (window.showCartIndicator) {
    window.showCartIndicator();
  } else if (window.showToast) {
    window.showToast("✅ Producto agregado al carrito");
  }
}

function createFeaturedCard(product) {
  const card = document.createElement("div");
  card.className = "product-card";
  const img = document.createElement("img");
  const cover = getPrimaryImage(product);
  img.src = cover || PLACEHOLDER_IMAGE;
  img.alt = product.name;
  card.appendChild(img);
  const title = document.createElement("h3");
  title.textContent = product.name;
  card.appendChild(title);
  const price = document.createElement("p");
  price.className = "price";
  price.textContent = `$${product.price_minorista.toLocaleString("es-AR")}`;
  card.appendChild(price);
  const actions = document.createElement("div");
  actions.className = "product-actions";
  const more = document.createElement("a");
  more.href = buildProductUrl(product);
  more.className = "button secondary";
  more.textContent = "Ver más";
  actions.appendChild(more);
  const addBtn = document.createElement("button");
  addBtn.className = "button primary";
  addBtn.textContent = "Agregar al carrito";
  addBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    addToCart(product);
    addBtn.textContent = "Añadido";
    setTimeout(() => (addBtn.textContent = "Agregar al carrito"), 1500);
  });
  actions.appendChild(addBtn);
  const quote = document.createElement("a");
  quote.href = "/contact.html";
  quote.className = "button secondary";
  quote.textContent = "Pedir cotización";
  actions.appendChild(quote);
  card.appendChild(actions);
  return card;
}

async function loadFeatured() {
  const container = document.getElementById("featuredGrid");
  if (!container) return;
  try {
    const products = await fetchProducts();
    products.slice(0, 4).forEach((p) => {
      container.appendChild(createFeaturedCard(p));
    });
  } catch (err) {
    container.textContent = "No se pudieron cargar los productos.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contactForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = encodeURIComponent(
        document.getElementById("contactName").value.trim(),
      );
      const phone = encodeURIComponent(
        document.getElementById("contactPhone").value.trim(),
      );
      const model = encodeURIComponent(
        document.getElementById("contactModel").value.trim(),
      );
      const type = encodeURIComponent(
        document.getElementById("contactType").value,
      );
      const phoneCfg =
        window.NERIN_CONFIG && window.NERIN_CONFIG.whatsappNumber;
      const waPhone = phoneCfg
        ? phoneCfg.replace(/[^0-9]/g, "")
        : "541112345678";
      const message = `Hola, mi nombre es ${name}. Busco ${model}. Soy ${type}. Contacto: ${phone}`;
      const url = `https://api.whatsapp.com/send?phone=${waPhone}&text=${message}`;
      window.open(url, "_blank");
    });
  }
  loadFeatured();
});
