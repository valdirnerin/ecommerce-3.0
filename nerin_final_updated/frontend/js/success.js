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
    } catch (_) {
      // ignore errors
    }
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

function renderError(msg) {
  card.innerHTML = `<p>${msg}</p><div class="actions"><button id="retry" class="primary">Reintentar</button><a class="secondary" href="/index.html">Volver al inicio</a></div>`;
  const btn = document.getElementById("retry");
  if (btn) btn.addEventListener("click", init);
}

function setupCopy(btn) {
  const text = btn.dataset.copy;
  btn.addEventListener("click", async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 1500);
    } catch (_) {}
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

function renderSuccess(o) {
  const nrn = o?.id || o?.order_number || o?.external_reference || "";
  const tracking = o?.seguimiento || o?.tracking_number || "";
  const paymentStatus = o?.estado_pago || o?.payment_status || "aprobado";
  const total = typeof o?.total === "number" ? o.total : 0;
  const fecha = o?.fecha || o?.date || new Date().toISOString();
  const items = o?.items || o?.productos || [];
  const itemsHtml = items
    .map((i) => `<li>${i.name} x${i.quantity}</li>`)
    .join("");
  const email = o?.cliente?.email || o?.customer?.email || "";
  card.innerHTML = `
    <div class="header">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <h1>Pago aprobado</h1>
      <p>${formatDate(fecha)}</p>
    </div>
    <div class="details">
      <section class="block">
        <h2>Tu pedido</h2>
        ${nrn ? `<p>N° de pedido: <span id="nrn">${nrn}</span> <button class="copy-btn" data-copy="${nrn}" aria-label="Copiar número"><span class="icon">📋</span><span class="tooltip" role="status" aria-live="polite">Copiado</span></button></p>` : `<p>No encontramos el número de pedido.</p>`}
        <p>Estado de pago: ${paymentStatus}</p>
        <p>Total: ${formatMoney(total)}</p>
        ${items.length ? `<ul class="items">${itemsHtml}</ul>` : ""}
      </section>
      <section class="block">
        <h2>Seguimiento</h2>
        ${tracking ? `<p>N° de seguimiento: <span id="tracking">${tracking}</span> <button class="copy-btn" data-copy="${tracking}" aria-label="Copiar número"><span class="icon">📋</span><span class="tooltip" role="status" aria-live="polite">Copiado</span></button></p>` : "<p>Aún sin número de envío</p>"}
      </section>
    </div>
    <div class="actions">
      <a id="trackLink" class="primary" href="/seguimiento.html?order=${encodeURIComponent(nrn)}${email ? `&email=${encodeURIComponent(email)}` : ""}">Ver estado del pedido</a>
      <button id="shareBtn" class="secondary" type="button">Compartir</button>
      <a class="secondary" href="/index.html">Volver al inicio</a>
    </div>
  `;
  document.querySelectorAll(".copy-btn").forEach((b) => setupCopy(b));
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
