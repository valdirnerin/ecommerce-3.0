/*
 * Página de detalle de producto.
 *
 * Lee el identificador del producto desde el parámetro de la URL (id) y
 * obtiene los productos desde el backend. Muestra la información
 * detallada del producto seleccionado (nombre, descripción, atributos,
 * precio y opciones de compra). Permite añadir el artículo al carrito
 * respetando el stock disponible y actualiza el contador del carrito en
 * la navegación.
 */

import { fetchProducts, isWholesale } from "./api.js";

// Obtenemos la referencia al contenedor donde se mostrará el producto
const detailContainer = document.getElementById("productDetail");

// Función principal de inicialización
async function initProduct() {
  // Obtener id de la URL
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) {
    detailContainer.innerHTML = "<p>Producto no especificado.</p>";
    return;
  }
  try {
    const products = await fetchProducts();
    const product = products.find((p) => p.id === id);
    if (!product) {
      detailContainer.innerHTML = "<p>Producto no encontrado.</p>";
      return;
    }
    renderProduct(product);
  } catch (err) {
    detailContainer.innerHTML = `<p>Error al cargar producto: ${err.message}</p>`;
  }
}

// Renderiza la información de un producto
function renderProduct(product) {
  // Limpiar contenedor
  detailContainer.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "product-detail";
  // Imagen principal
  const img = document.createElement("img");
  img.src = product.image;
  img.alt = product.name;
  img.className = "product-detail-image";
  wrapper.appendChild(img);
  // Título
  const title = document.createElement("h2");
  title.textContent = product.name;
  wrapper.appendChild(title);
  // Descripción
  if (product.description) {
    const desc = document.createElement("p");
    desc.className = "product-detail-desc";
    desc.textContent = product.description;
    wrapper.appendChild(desc);
  }
  // Atributos adicionales
  const attrs = document.createElement("ul");
  attrs.className = "product-detail-attrs";
  const attrList = [
    { label: "SKU", value: product.sku },
    { label: "Marca", value: product.brand },
    { label: "Modelo", value: product.model },
    { label: "Categoría", value: product.category },
    {
      label: "Peso",
      value: product.weight != null ? `${product.weight} g` : null,
    },
    { label: "Dimensiones", value: product.dimensions },
    { label: "Color", value: product.color },
  ];
  attrList.forEach((attr) => {
    if (attr.value) {
      const li = document.createElement("li");
      li.textContent = `${attr.label}: ${attr.value}`;
      attrs.appendChild(li);
    }
  });
  wrapper.appendChild(attrs);
  // Información de stock
  const stockInfo = document.createElement("p");
  stockInfo.className = "product-stock-info";
  if (typeof product.stock === "number") {
    if (product.stock <= 0) {
      stockInfo.textContent = "Sin stock disponible";
      stockInfo.style.color = "var(--color-danger, #d9534f)";
    } else if (product.min_stock != null && product.stock < product.min_stock) {
      stockInfo.textContent = `Poco stock (quedan ${product.stock} unidades)`;
      stockInfo.style.color = "var(--color-warning, #f0ad4e)";
    } else {
      stockInfo.textContent = `Stock disponible: ${product.stock} unidades`;
    }
  }
  wrapper.appendChild(stockInfo);
  // Precios
  const priceDiv = document.createElement("div");
  priceDiv.className = "product-detail-price";
  const minorP = document.createElement("p");
  minorP.textContent = `Precio minorista: $${product.price_minorista.toLocaleString("es-AR")}`;
  priceDiv.appendChild(minorP);
  if (isWholesale()) {
    const majorP = document.createElement("p");
    majorP.textContent = `Precio mayorista: $${product.price_mayorista.toLocaleString("es-AR")}`;
    priceDiv.appendChild(majorP);
  }
  wrapper.appendChild(priceDiv);
  // Sección de compra
  if (typeof product.stock === "number" && product.stock > 0) {
    const buyDiv = document.createElement("div");
    buyDiv.className = "product-detail-buy";
    if (isWholesale()) {
      // Mayorista: seleccionar cantidad y precio con descuento
      const qtyInput = document.createElement("input");
      qtyInput.type = "number";
      qtyInput.min = 1;
      qtyInput.value = 1;
      qtyInput.max = product.stock;
      const priceLabel = document.createElement("span");
      priceLabel.className = "product-detail-unit-price";
      const updatePrice = () => {
        const qty = parseInt(qtyInput.value, 10) || 1;
        if (qty > product.stock) qtyInput.value = product.stock;
        if (qty < 1) qtyInput.value = 1;
        let discount = 0;
        if (qty >= 20) discount = 0.15;
        else if (qty >= 10) discount = 0.1;
        else if (qty >= 5) discount = 0.05;
        const unit = Math.round(product.price_mayorista * (1 - discount));
        priceLabel.textContent = `Precio c/u: $${unit.toLocaleString("es-AR")} (x${qty})`;
      };
      qtyInput.addEventListener("input", updatePrice);
      updatePrice();
      const addBtn = document.createElement("button");
      addBtn.className = "button primary";
      addBtn.textContent = "Agregar al carrito";
      addBtn.addEventListener("click", () => {
        const qty = parseInt(qtyInput.value, 10) || 1;
        if (qty > product.stock) {
          alert(`No hay stock suficiente. Disponibles: ${product.stock}`);
          return;
        }
        const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
        const existing = cart.find((item) => item.id === product.id);
        if (existing) {
          if (existing.quantity + qty > product.stock) {
            alert(
              `Ya tienes ${existing.quantity} unidades en el carrito. Disponibles: ${product.stock}`,
            );
            return;
          }
          existing.quantity += qty;
        } else {
          cart.push({
            id: product.id,
            name: product.name,
            price: product.price_mayorista,
            quantity: qty,
            image: product.image,
          });
        }
        localStorage.setItem("nerinCart", JSON.stringify(cart));
        if (window.updateNav) window.updateNav();
        addBtn.textContent = "Añadido";
        setTimeout(() => {
          addBtn.textContent = "Agregar al carrito";
        }, 2000);
      });
      buyDiv.appendChild(qtyInput);
      buyDiv.appendChild(addBtn);
      buyDiv.appendChild(priceLabel);
    } else {
      // Minorista/invitado: añadir una unidad con precio minorista
      const addBtn = document.createElement("button");
      addBtn.className = "button primary";
      addBtn.textContent = "Agregar al carrito";
      addBtn.addEventListener("click", () => {
        const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
        const existing = cart.find((item) => item.id === product.id);
        const available = product.stock;
        if (existing) {
          if (existing.quantity + 1 > available) {
            alert(
              `Ya tienes ${existing.quantity} unidades en el carrito. Disponibles: ${available}`,
            );
            return;
          }
          existing.quantity += 1;
        } else {
          cart.push({
            id: product.id,
            name: product.name,
            price: product.price_minorista,
            quantity: 1,
            image: product.image,
          });
        }
        localStorage.setItem("nerinCart", JSON.stringify(cart));
        if (window.updateNav) window.updateNav();
        addBtn.textContent = "Añadido";
        setTimeout(() => {
          addBtn.textContent = "Agregar al carrito";
        }, 2000);
      });
      buyDiv.appendChild(addBtn);
    }
    wrapper.appendChild(buyDiv);
  }
  detailContainer.appendChild(wrapper);
}

document.addEventListener("DOMContentLoaded", initProduct);
