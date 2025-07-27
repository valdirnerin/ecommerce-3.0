document.querySelector(".mp-buy").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  btn.textContent = "Procesando...";
  const title = localStorage.getItem("mp_title") || "Producto NERIN";
  const price = Number(localStorage.getItem("mp_price")) || 0;
  const quantity = Number(localStorage.getItem("mp_quantity")) || 1;

  try {
    const res = await fetch("/create_preference", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, price, quantity }),
    });

    const data = await res.json();

    if (data.init_point) {
      window.location.href = data.init_point;
    } else {
      window.location.href = "/checkout.html?status=failure";
    }
  } catch (err) {
    console.error("Error en checkout", err);
    window.location.href = "/checkout.html?status=failure";
  }
  btn.disabled = false;
  btn.textContent = "Pagar con Mercado Pago";
});
