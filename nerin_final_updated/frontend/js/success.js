const card = document.getElementById("card");

function getIdentifier() {
  const params = new URLSearchParams(window.location.search);
  const id =
    params.get("preference_id") ||
    params.get("pref_id") ||
    params.get("o") ||
    params.get("order") ||
    params.get("external_reference") ||
    params.get("collection_id") ||
    localStorage.getItem("mp_last_pref") ||
    localStorage.getItem("mp_last_nrn");
  return id || null;
}

async function pollOrderStatus(id, opts = {}) {
  const { tries = 120, interval = 1500 } = opts;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}/status`);
      if (res.ok) {
        const data = await res.json();
        const st = data.status;
        const nrn = data.numeroOrden;
        if (st === "approved" || st === "rejected") {
          return { status: st, id, numeroOrden: nrn };
        }
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, interval));
  }
  return { status: "pending", id };
}

function formatDate(d) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(d));
}

function formatMoney(n) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(n);
}

async function copyToClipboard(text) { // nerin brand fix
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    if (window.showToast) window.showToast("Copiado");
  } catch (e) {
    if (window.showToast) window.showToast("No se pudo copiar");
  }
}

function bindCopyButtons() {
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    const sel = btn.getAttribute("data-copy");
    btn.addEventListener("click", () => {
      const el = document.querySelector(sel);
      if (el) copyToClipboard(el.textContent.trim());
    });
  });
}

function setupShare(nrn, tracking) {
  const btn = document.getElementById("shareBtn");
  if (!btn) return;
  if (navigator.share) {
    btn.addEventListener("click", () => {
      const text = `Pedido ${nrn}${tracking ? " - Seguimiento: " + tracking : ""}`;
      navigator.share({ text });
    });
  } else {
    btn.style.display = "none";
  }
}

function renderError(msg) {
  card.innerHTML = `<p>${msg}</p><div class="actions"><button id="retry" class="button primary">Reintentar</button><a class="button secondary" href="/index.html">Volver al inicio</a></div>`; // nerin brand fix
  const btn = document.getElementById("retry");
  if (btn) btn.addEventListener("click", init);
}

function renderSuccess(o) {
  const nrn = o?.id || o?.order_number || o?.external_reference || "";
  const tracking = o?.seguimiento || o?.tracking_number || "";
  const paymentStatus = o?.estado_pago || o?.payment_status || "aprobado";
  const total = typeof o?.total === "number" ? o.total : 0;
  const fecha = o?.fecha || o?.date || new Date().toISOString();
  const items = o?.items || o?.productos || [];
  const itemsHtml = items.map((i) => `<li>${i.name} x${i.quantity}</li>`).join("");
  const email = o?.cliente?.email || o?.customer?.email || "";
  const statusClass =
    paymentStatus === "aprobado"
      ? "status-badge status-pagado"
      : paymentStatus === "rechazado"
      ? "status-badge status-rechazado"
      : "status-badge status-pendiente";
  card.innerHTML = `
    <h1>Pago aprobado</h1>
    <p class="date">${formatDate(fecha)}</p>
    <section class="receipt-card">
      <h2>Tu pedido</h2>
      ${nrn ? `<p>N° de pedido: <span id="orderNumber">${nrn}</span><button class="button secondary copy-btn" data-copy="#orderNumber">Copiar</button></p>` : `<p>No encontramos el número de pedido.</p>`}
      <p>Estado de pago: <span class="${statusClass}">${paymentStatus}</span></p>
      <p>Total: ${formatMoney(total)}</p>
      ${items.length ? `<ul class="items">${itemsHtml}</ul>` : ""}
    </section>
    <section class="receipt-card">
      <h2>Seguimiento</h2>
      ${tracking ? `<p>N° de seguimiento: <span id="tracking">${tracking}</span><button class="button secondary copy-btn" data-copy="#tracking">Copiar</button></p>` : "<p>Aún sin número de envío</p>"}
    </section>
    <div class="actions">
      <a id="trackLink" class="button primary" href="/seguimiento.html?order=${encodeURIComponent(nrn)}${email ? `&email=${encodeURIComponent(email)}` : ""}">Ver estado del pedido</a>
      <button id="shareBtn" class="button secondary" type="button">Compartir</button>
      <a class="button secondary" href="/index.html">Volver al inicio</a>
    </div>
  `;
  bindCopyButtons();
  setupShare(nrn, tracking);
}

async function init() {
  const id = getIdentifier();
  if (!id) {
    renderError("No encontramos la orden.");
    return;
  }
  const { status, id: resolvedId, numeroOrden } = await pollOrderStatus(id);
  if (status === "approved") {
    const nrn = numeroOrden || resolvedId;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(nrn)}`);
      if (res.ok) {
        const data = await res.json();
        renderSuccess(data.order || { id: nrn });
        localStorage.removeItem("mp_last_pref");
        localStorage.removeItem("mp_last_nrn");
        return;
      }
    } catch (_) {}
    renderSuccess({ id: nrn });
  } else if (status === "rejected") {
    renderError("Tu pago fue rechazado.");
  } else {
    renderError("Estamos acreditando tu pago...");
  }
}

document.addEventListener("DOMContentLoaded", init);
