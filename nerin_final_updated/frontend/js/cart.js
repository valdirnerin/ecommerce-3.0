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
const confirmBtn = document.getElementById("confirmBtn");

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

  confirmBtn.onclick = async () => {
    try {
      // Enviar también información del cliente si está logueado
      const email = localStorage.getItem("nerinUserEmail");
      const name = localStorage.getItem("nerinUserName");
      const payload = { cart };
      if (email) {
        // Cliente logueado: utilizar sus datos almacenados
        payload.customer = { email, name };
      } else {
        // Invitado: solicitar nombre y correo para poder generar seguimiento
        const guestEmail = prompt(
          "Ingresa tu correo electrónico para recibir el seguimiento de tu pedido:",
        );
        if (!guestEmail) {
          alert(
            "Debes ingresar un correo válido para continuar con la compra.",
          );
          return;
        }
        const guestName = prompt("Ingresa tu nombre completo:");
        if (!guestName) {
          alert("Debes ingresar tu nombre para continuar con la compra.");
          return;
        }
        payload.customer = { email: guestEmail.trim(), name: guestName.trim() };
      }
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(
          "Pedido enviado correctamente.\nTu número de pedido es: " +
            (data.orderId || "N/A"),
        );
        // Limpiar carrito y actualizar navegación
        localStorage.removeItem("nerinCart");
        renderCart();
        if (window.updateNav) {
          window.updateNav();
        }
        // Redirigir a la factura si se generó una
        if (data.orderId) {
          // Intentar generar factura automáticamente
          try {
            await fetch(`/api/invoices/${encodeURIComponent(data.orderId)}`, {
              method: "POST",
            });
            window.location.href = `/invoice.html?orderId=${encodeURIComponent(data.orderId)}`;
          } catch (err) {
            console.warn("No se pudo crear la factura automáticamente");
          }
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || "Error al enviar el pedido");
      }
    } catch (err) {
      alert("Error al conectar con el servidor");
    }
  };
  // Después de renderizar el carrito actualiza la navegación para reflejar el contador del carrito
  if (window.updateNav) {
    window.updateNav();
  }
}

// Ejecutar al cargar el documento
document.addEventListener("DOMContentLoaded", renderCart);
