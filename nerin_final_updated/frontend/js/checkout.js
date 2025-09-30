function buildApiUrl(path) {
  const builder = window.NERIN_BUILD_API_URL;
  if (typeof builder === "function") return builder(path);
  const base =
    (window.NERIN_CONFIG && window.NERIN_CONFIG.apiBase) || window.API_BASE_URL || "";
  const safePath = path.startsWith("/") ? path : `/${path}`;
  if (!base) return safePath;
  return `${base.replace(/\/+$/, "")}${safePath}`;
}

function apiFetch(path, options) {
  if (typeof window.NERIN_API_FETCH === "function") {
    return window.NERIN_API_FETCH(path, options);
  }
  return fetch(buildApiUrl(path), options);
}

document.querySelector(".mp-buy").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  btn.textContent = "Procesando...";
  const title = localStorage.getItem("mp_title") || "Producto NERIN";
  const price = Number(localStorage.getItem("mp_price")) || 0;
  const quantity = Number(localStorage.getItem("mp_quantity")) || 1;

  try {
    const res = await apiFetch("/crear-preferencia", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        titulo: title,
        precio: price,
        cantidad: quantity,
      }),
    });

    const data = await res.json();

    if (data.init_point) {
      localStorage.setItem('mp_last_pref', data.preferenceId || '');
      localStorage.setItem('mp_last_nrn', data.nrn || data.orderId || '');
      window.location.href = data.init_point;
    } else {
      window.location.href = "/checkout.html?status=failure";
    }
  } catch (err) {
    console.error("Error en checkout", err);
    window.location.href = "/checkout.html?status=failure";
  }
  btn.disabled = false;
  btn.textContent = "Continuar con el pago";
});
