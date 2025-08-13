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

import { isWholesale, fetchProducts } from "./api.js";

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

// Obtener y validar el contenido del carrito desde localStorage
function getStoredCart() {
  try {
    const raw = localStorage.getItem("nerinCart");
    const cart = JSON.parse(raw || "[]");
    return Array.isArray(cart) ? cart : [];
  } catch (err) {
    console.warn("Cart storage corrupt, resetting", err);
    localStorage.removeItem("nerinCart");
    return [];
  }
}

// Renderizar el carrito completo
async function renderCart() {
  const cart = getStoredCart();
  itemsContainer.innerHTML = "";
  let subtotal = 0;
  if (cart.length === 0) {
    itemsContainer.innerHTML = "<p>El carrito está vacío.</p>";
    summaryContainer.innerHTML = "";
    actionsContainer.style.display = "none";
    return;
  }

  // Obtener stock actualizado de productos
  let stockMap = {};
  try {
    const products = await fetchProducts();
    stockMap = Object.fromEntries(
      products.map((p) => [p.id, typeof p.stock === "number" ? p.stock : Infinity]),
    );
  } catch (e) {
    console.warn("No se pudieron obtener los productos", e);
  }

  actionsContainer.style.display = "flex";
  cart.forEach((item, index) => {
    const itemEl = document.createElement("div");
    itemEl.className = "cart-item";

    const available = stockMap[item.id] ?? Infinity;
    if (item.quantity > available) {
      item.quantity = available;
      localStorage.setItem("nerinCart", JSON.stringify(cart));
    }

    if (item.image) {
      const imgEl = document.createElement("img");
      imgEl.src = item.image;
      imgEl.alt = item.name;
      imgEl.className = "cart-img";
      itemEl.appendChild(imgEl);
    }

    const details = document.createElement("div");
    details.className = "cart-details";
    const nameEl = document.createElement("div");
    nameEl.className = "cart-name";
    nameEl.textContent = item.name;
    details.appendChild(nameEl);

    if (available !== Infinity) {
      const stockEl = document.createElement("div");
      stockEl.className = "cart-stock";
      stockEl.textContent = `Stock: ${available}`;
      details.appendChild(stockEl);
    }

    const basePrice = item.price;
    let unitPrice = basePrice;
    if (isWholesale()) {
      unitPrice = calculateDiscountedPrice(basePrice, item.quantity);
    }
    const priceEl = document.createElement("div");
    priceEl.className = "cart-price";
    priceEl.textContent = `$${unitPrice.toLocaleString("es-AR")} c/u`;
    details.appendChild(priceEl);

    const itemTotal = unitPrice * item.quantity;
    const totalEl = document.createElement("div");
    totalEl.className = "cart-item-total";
    totalEl.textContent = `$${itemTotal.toLocaleString("es-AR")}`;
    details.appendChild(totalEl);

    itemEl.appendChild(details);

    const stepper = document.createElement("div");
    stepper.className = "qty-stepper";
    const minus = document.createElement("button");
    minus.className = "stepper-btn";
    minus.textContent = "-";
    minus.addEventListener("click", () => {
      if (cart[index].quantity > 1) {
        cart[index].quantity -= 1;
        localStorage.setItem("nerinCart", JSON.stringify(cart));
        renderCart();
      }
    });
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = 1;
    qtyInput.max = available;
    qtyInput.value = item.quantity;
    qtyInput.className = "cart-qty-input";
    qtyInput.setAttribute("inputmode", "numeric");
    qtyInput.addEventListener("change", () => {
      let qty = parseInt(qtyInput.value, 10) || 1;
      if (qty > available) {
        qty = available;
        qtyInput.value = available;
        alert(`Stock disponible: ${available}`);
      }
      cart[index].quantity = qty;
      localStorage.setItem("nerinCart", JSON.stringify(cart));
      renderCart();
    });
    const plus = document.createElement("button");
    plus.className = "stepper-btn";
    plus.textContent = "+";
    plus.addEventListener("click", () => {
      if (cart[index].quantity < available) {
        cart[index].quantity += 1;
        localStorage.setItem("nerinCart", JSON.stringify(cart));
        renderCart();
      } else {
        alert(`Stock disponible: ${available}`);
      }
    });
    stepper.appendChild(minus);
    stepper.appendChild(qtyInput);
    stepper.appendChild(plus);
    itemEl.appendChild(stepper);

    if (available <= 0) {
      qtyInput.value = 0;
      qtyInput.disabled = true;
      plus.disabled = true;
      minus.disabled = true;
    }

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
    // Siempre redirigimos al flujo de checkout para que el usuario revise sus datos
    window.location.href = "/checkout-steps.html";
  };
}

// Ejecutar al cargar el documento
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderCart);
} else {
  renderCart();
}

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
