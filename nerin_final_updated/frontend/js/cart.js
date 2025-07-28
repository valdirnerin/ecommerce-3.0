/*
 * Gestión del carrito de compras.
 *
 * Este módulo lee los artículos almacenados en localStorage bajo la clave
 * `nerinCart` y los presenta en una lista editable. Permite modificar
 * cantidades, eliminar productos, enviar el pedido por WhatsApp o
 * confirmar el pedido hacia el backend. Si el usuario está logueado
 * como mayorista se aplican descuentos automáticos según la cantidad
 * seleccionada.
 */

import { isWholesale } from "./api.js";

// Referencias a los elementos del DOM
const itemsContainer = document.getElementById("cartItems");
const summaryContainer = document.getElementById("cartSummary");
const actionsContainer = document.getElementById("cartActions");
const whatsappBtn = document.getElementById("whatsappBtn");
const payBtn = document.getElementById("payBtn");

// Calcular el precio con descuento según cantidad para mayoristas
function calculateDiscountedPrice(basePrice, quantity) {
  let discount = 0;
  if (quantity >= 20) {
    discount = 0.15;
  } else if (quantity >= 10) {
    discount = 0.1;
  } else if (quantity >= 5) {
    discount = 0.05;
  }
  return Math.round(basePrice * (1 - discount));
}

// Renderizar el carrito completo
function renderCart() {
  const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
  itemsContainer.innerHTML = "";
  let subtotal = 0;
  if (cart.length === 0) {
    itemsContainer.innerHTML = "<p>El carrito está vacío.</p>";
    summaryContainer.innerHTML = "";
    actionsContainer.style.display = "none";
    return;
  }
  actionsContainer.style.display = "flex";
  cart.forEach((item, index) => {
    // Contenedor del ítem
    const itemEl = document.createElement("div");
    itemEl.className = "cart-item";

    // Imagen del producto si está disponible
    if (item.image) {
      const imgEl = document.createElement("img");
      imgEl.src = item.image;
      imgEl.alt = item.name;
      imgEl.className = "cart-img";
      itemEl.appendChild(imgEl);
    }

    // Nombre del producto
    const nameEl = document.createElement("div");
    nameEl.className = "cart-name";
    nameEl.textContent = item.name;
    itemEl.appendChild(nameEl);

    // Campo de cantidad editable
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = 1;
    qtyInput.value = item.quantity;
    qtyInput.className = "cart-qty-input";
    qtyInput.setAttribute("inputmode", "numeric");
    qtyInput.addEventListener("change", () => {
      const qty = parseInt(qtyInput.value, 10) || 1;
      cart[index].quantity = qty;
      localStorage.setItem("nerinCart", JSON.stringify(cart));
      renderCart();
    });
    itemEl.appendChild(qtyInput);

    // Precio unitario mostrando descuento si corresponde
    const priceEl = document.createElement("div");
    priceEl.className = "cart-price";
    const basePrice = item.price;
    let unitPrice = basePrice;
    if (isWholesale()) {
      unitPrice = calculateDiscountedPrice(basePrice, item.quantity);
    }
    priceEl.textContent = `$${unitPrice.toLocaleString("es-AR")} c/u`;
    itemEl.appendChild(priceEl);

    // Precio total por producto
    const totalEl = document.createElement("div");
    totalEl.className = "cart-item-total";
    const itemTotal = unitPrice * item.quantity;
    totalEl.textContent = `$${itemTotal.toLocaleString("es-AR")}`;
    itemEl.appendChild(totalEl);

    // Botón para eliminar
    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-item-btn";
    removeBtn.textContent = "Eliminar";
    removeBtn.addEventListener("click", () => {
      cart.splice(index, 1);
      localStorage.setItem("nerinCart", JSON.stringify(cart));
      renderCart();
    });
    itemEl.appendChild(removeBtn);

    itemsContainer.appendChild(itemEl);
    subtotal += itemTotal;
  });
  summaryContainer.innerHTML = `<h3>Total:</h3><p class="cart-total-amount">$${subtotal.toLocaleString("es-AR")}</p>`;

  // Configurar acciones
  whatsappBtn.onclick = () => {
    // Usar número de WhatsApp desde configuración global si está disponible
    const phoneCfg = window.NERIN_CONFIG && window.NERIN_CONFIG.whatsappNumber;
    const phone = phoneCfg ? phoneCfg.replace(/[^0-9]/g, "") : "541112345678";
    let message = "Hola! Deseo hacer un pedido:%0A";
    cart.forEach((item) => {
      const basePrice = item.price;
      const price = isWholesale()
        ? calculateDiscountedPrice(basePrice, item.quantity)
        : basePrice;
      message += `- ${item.name} x${item.quantity} ($${price.toLocaleString("es-AR")} c/u)%0A`;
    });
    message += `%0ATotal: $${subtotal.toLocaleString("es-AR")}`;
    window.open(
      `https://api.whatsapp.com/send?phone=${phone}&text=${message}`,
      "_blank",
    );
  };

  payBtn.onclick = () => {
    window.location.href = "/checkout-form.html";
  };
  // Después de renderizar el carrito actualiza la navegación para reflejar el contador del carrito
  if (window.updateNav) {
    window.updateNav();
  }
}

// Ejecutar al cargar el documento
document.addEventListener("DOMContentLoaded", renderCart);

function showPaymentSummary(orderId, cart, preferenceId) {
  if (!preferenceId) {
    alert("Error al preparar el pago");
    return;
  }
  const orderEl = document.getElementById("orderSummary");
  if (!orderEl) return;
  const total = cart.reduce((acc, item) => {
    const price = isWholesale()
      ? calculateDiscountedPrice(item.price, item.quantity)
      : item.price;
    return acc + price * item.quantity;
  }, 0);
  orderEl.innerHTML = `
    <h3>Pedido creado correctamente</h3>
    <p>Número de pedido: ${orderId}</p>
    <ul>
      ${cart
        .map(
          (i) =>
            `<li>${i.name} x${i.quantity} - $${i.price.toLocaleString("es-AR")}</li>`,
        )
        .join("")}
    </ul>
    <p class="cart-total-amount">Total: $${total.toLocaleString("es-AR")}</p>
    <div id="mpButton"></div>
  `;
  orderEl.querySelector("#mpButton").innerHTML =
    `<script src="https://www.mercadopago.com.ar/integrations/v1/web-payment-checkout.js" data-preference-id="${preferenceId}" data-source="button"></script>`;
  document.getElementById("cartActions").style.display = "none";
  document.getElementById("cartItems").style.display = "none";
  document.getElementById("cartSummary").style.display = "none";
  orderEl.style.display = "block";
}
