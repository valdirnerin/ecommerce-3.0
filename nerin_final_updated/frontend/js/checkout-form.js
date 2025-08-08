import { getCart, clearCart } from "./cart-storage.js";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("form.shipping-form");
  const loading = document.getElementById("loading");
  if (!form) return;

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    // Validación básica de campos requeridos
    let valid = true;
    form.querySelectorAll("input, select, textarea").forEach((el) => {
      const msg = el.parentElement.querySelector(".error-message");
      if (el.required && !el.value.trim()) {
        el.classList.add("invalid");
        if (msg) {
          msg.textContent = "Campo obligatorio";
          msg.classList.add("show");
        }
        valid = false;
      } else {
        el.classList.remove("invalid");
        if (msg) {
          msg.textContent = "";
          msg.classList.remove("show");
        }
      }
    });
    if (!valid) return;

    try {
      const cart = getCart();
      if (cart.length === 0) {
        alert("Carrito vacío");
        return;
      }
      const cliente = {
        nombre: document.getElementById("nombre").value.trim(),
        email: document.getElementById("email").value.trim(),
        telefono: document.getElementById("telefono").value.trim(),
        direccion: {
          calle: document.getElementById("calle").value.trim(),
          numero: document.getElementById("numero").value.trim(),
          piso: document.getElementById("piso").value.trim(),
          localidad: document.getElementById("localidad").value.trim(),
          provincia: document.getElementById("provincia").value.trim(),
          cp: document.getElementById("cp").value.trim(),
        },
      };
      const payload = {
        cliente,
        productos: cart,
        metodo_envio: document.getElementById("metodo_envio").value,
        comentarios: document.getElementById("comentarios").value.trim(),
      };

      if (loading) loading.classList.add("active");
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        alert((data && data.error) || "Error al crear el pedido");
        return;
      }

      if (data && data.init_point) {
        clearCart();
        window.location.href = data.init_point;
      } else {
        alert("Pedido creado, pero no se pudo iniciar el pago");
      }
    } catch (err) {
      console.error("Error al enviar el pedido", err);
      alert("Ocurrió un error al enviar el pedido");
    } finally {
      if (loading) loading.classList.remove("active");
    }
  });
});
