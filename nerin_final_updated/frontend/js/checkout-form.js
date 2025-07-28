const form = document.getElementById("checkoutForm");
form.addEventListener("submit", async (ev) => {
  ev.preventDefault();

  try {
    const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
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

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let data;
    try {
      data = await res.json();
    } catch (jsonErr) {
      console.error("Respuesta inválida", jsonErr);
      alert("Respuesta inválida del servidor");
      return;
    }

    if (!res.ok) {
      alert(data.error || "Error al crear el pedido");
      return;
    }

    if (data.init_point) {
      console.log("Init point:", data.init_point);
      localStorage.removeItem("nerinCart");
      window.location.href = data.init_point;
    } else {
      alert("Pedido creado, pero no se pudo iniciar el pago");
    }
  } catch (err) {
    console.error("Error al enviar el pedido", err);
    alert("Ocurrió un error al enviar el pedido");
  }
});
