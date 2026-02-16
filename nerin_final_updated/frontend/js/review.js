const form = document.getElementById("reviewForm");
const statusEl = document.getElementById("reviewStatus");
const contextEl = document.getElementById("reviewContext");

const params = new URLSearchParams(window.location.search);

function getRawQueryParam(name) {
  const raw = window.location.search.startsWith("?")
    ? window.location.search.slice(1)
    : window.location.search;
  if (!raw) return "";
  const segments = raw.split("&");
  for (const segment of segments) {
    const [key, ...valueParts] = segment.split("=");
    if (decodeURIComponent(key || "") !== name) continue;
    return decodeURIComponent(valueParts.join("=") || "");
  }
  return "";
}

function normalizeTokenValue(value) {
  if (!value) return "";
  return String(value).trim().replace(/\s+/g, "+");
}

const tokenId = normalizeTokenValue(params.get("tid") || getRawQueryParam("tid"));
const tokenPlain = normalizeTokenValue(params.get("t") || getRawQueryParam("t"));

let currentContext = null;
let productSelect = null;
const photoInput = document.querySelector('input[name="photos"]');
const tokenEntry = document.getElementById("tokenEntry");
const reviewLinkInput = document.getElementById("reviewLinkInput");
const reviewTokenIdInput = document.getElementById("reviewTokenId");
const reviewTokenValueInput = document.getElementById("reviewTokenValue");
const reviewTokenSubmit = document.getElementById("reviewTokenSubmit");

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b91c1c" : "inherit";
}

function renderContext(context) {
  if (!contextEl) return;
  contextEl.innerHTML = "";
  if (!context) return;
  if (context.scope === "purchase") {
    const title = document.createElement("h3");
    title.textContent = "Compra verificada";
    const order = document.createElement("p");
    order.textContent = `Pedido: ${context.order?.number || context.order?.id || "-"}`;
    contextEl.append(title, order);
    const items = context.order?.items || [];
    if (items.length) {
      const list = document.createElement("ul");
      items.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = `${item.name || "Producto"} · ${item.qty || 0} u.`;
        list.appendChild(li);
      });
      contextEl.appendChild(list);
    }
  } else if (context.scope === "service") {
    const title = document.createElement("h3");
    title.textContent = "Servicio verificado";
    const partner = document.createElement("p");
    partner.textContent = `Partner: ${context.partner?.name || "-"}`;
    const address = document.createElement("p");
    address.textContent = context.partner?.address || "";
    contextEl.append(title, partner, address);
  }
}

function buildProductSelect(items = []) {
  if (!form) return;
  if (productSelect) productSelect.remove();
  if (!items.length) return;
  const wrapper = document.createElement("label");
  wrapper.textContent = "Producto";
  const select = document.createElement("select");
  select.name = "productId";
  select.required = items.length > 1;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = items.length > 1 ? "Seleccioná" : "Producto";
  select.appendChild(placeholder);
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id || "";
    option.textContent = item.name || item.id || "Producto";
    select.appendChild(option);
  });
  wrapper.appendChild(select);
  form.insertBefore(wrapper, form.querySelector("label"));
  productSelect = wrapper;
}

async function redeemToken() {
  if (!tokenId || !tokenPlain) {
    setStatus("Necesitamos tu link de reseña para continuar.", true);
    if (tokenEntry) tokenEntry.hidden = false;
    return;
  }
  try {
    const res = await fetch("/api/review-tokens/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tid: tokenId, t: tokenPlain }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "No pudimos validar el token. Revisá el link.");
    }
    const data = await res.json();
    currentContext = data.context;
    renderContext(currentContext);
    if (currentContext?.scope === "purchase") {
      buildProductSelect(currentContext.order?.items || []);
    }
    setStatus("Token validado. Completá el formulario:");
    if (tokenEntry) tokenEntry.hidden = true;
    if (form) form.hidden = false;
  } catch (err) {
    renderContext(null);
    if (form) form.hidden = true;
    setStatus(err?.message || "No pudimos validar el token. Revisá el link.", true);
    if (tokenEntry) tokenEntry.hidden = false;
  }
}

function handleTokenEntry() {
  const linkValue = normalizeTokenValue(reviewLinkInput?.value);
  let tid = normalizeTokenValue(reviewTokenIdInput?.value);
  let t = normalizeTokenValue(reviewTokenValueInput?.value);
  if (linkValue) {
    try {
      const url = new URL(linkValue, window.location.origin);
      tid = normalizeTokenValue(
        tid || url.searchParams.get("tid") || getRawQueryParam("tid") || "",
      );
      t = normalizeTokenValue(
        t || url.searchParams.get("t") || getRawQueryParam("t") || "",
      );
    } catch (err) {
      setStatus("El link pegado no es válido.", true);
      return;
    }
  }
  if (!tid || !t) {
    setStatus("Completá el Token ID y Token para continuar.", true);
    return;
  }
  const next = new URLSearchParams({ tid, t });
  window.location.search = `?${next.toString()}`;
}

if (reviewTokenSubmit) {
  reviewTokenSubmit.addEventListener("click", handleTokenEntry);
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Enviando reseña…");
    const formData = new FormData(form);
    let photos = [];
    const fileList = photoInput?.files ? Array.from(photoInput.files) : [];
    if (fileList.length > 4) {
      setStatus("Podés subir hasta 4 fotos.", true);
      return;
    }
    if (fileList.length) {
      const uploadForm = new FormData();
      fileList.forEach((file) => uploadForm.append("photos", file));
      try {
        const uploadRes = await fetch("/api/reviews/upload", {
          method: "POST",
          body: uploadForm,
        });
        if (!uploadRes.ok) {
          const uploadData = await uploadRes.json().catch(() => ({}));
          throw new Error(uploadData.error || "upload-failed");
        }
        const uploadData = await uploadRes.json();
        photos = Array.isArray(uploadData.urls) ? uploadData.urls : [];
      } catch (err) {
        setStatus("No pudimos subir las fotos. Probá con imágenes más livianas.", true);
        return;
      }
    }
    const payload = {
      tid: tokenId,
      t: tokenPlain,
      rating: formData.get("rating"),
      text: formData.get("text"),
      email: formData.get("email"),
      customerName: formData.get("customerName"),
      productId: formData.get("productId"),
      photos,
    };
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "submit-failed");
      }
      setStatus("¡Gracias! Tu reseña quedó en revisión.");
      form.reset();
      form.hidden = true;
    } catch (err) {
      setStatus("No pudimos enviar la reseña. Verificá los datos.", true);
    }
  });
}

redeemToken();
