const form = document.getElementById("reviewForm");
const statusEl = document.getElementById("reviewStatus");
const contextEl = document.getElementById("reviewContext");

const params = new URLSearchParams(window.location.search);

function normalizeTokenValue(value) {
  if (!value) return "";
  return String(value).trim().replace(/\s+/g, "+");
}

function normalizeParamKey(value) {
  let key = String(value || "").trim();
  while (key.toLowerCase().startsWith("amp;")) {
    key = key.slice(4);
  }
  return key;
}

function pickParam(searchParams, keys = []) {
  if (!searchParams || !keys.length) return "";
  const expected = new Set(keys.map((key) => String(key)));
  for (const [rawKey, rawValue] of searchParams.entries()) {
    const normalizedKey = normalizeParamKey(rawKey);
    if (!expected.has(rawKey) && !expected.has(normalizedKey)) continue;
    const value = normalizeTokenValue(rawValue);
    if (value) return value;
  }
  return "";
}

function extractTokensFromParams(searchParams) {
  const tid = pickParam(searchParams, ["tid", "tokenId", "token_id", "reviewTokenId"]);
  const t = pickParam(searchParams, ["t", "token", "reviewToken"]);
  return { tid, t };
}

function readTokensFromEmbeddedLink(rawLink) {
  const link = normalizeTokenValue(rawLink);
  if (!link) return { tid: "", t: "" };
  try {
    const embeddedUrl = new URL(link, window.location.origin);
    const direct = extractTokensFromParams(embeddedUrl.searchParams);
    if (direct.tid && direct.t) return direct;
    const nestedLink = pickParam(embeddedUrl.searchParams, ["reviewLink", "review_link", "url", "u", "link"]);
    if (!nestedLink) return { tid: "", t: "" };
    const nestedUrl = new URL(nestedLink, window.location.origin);
    return extractTokensFromParams(nestedUrl.searchParams);
  } catch {
    return { tid: "", t: "" };
  }
}

function readTokenFromLocation() {
  const direct = extractTokensFromParams(params);
  if (direct.tid && direct.t) return direct;

  const embeddedLink = pickParam(params, ["reviewLink", "review_link", "url", "u", "link"]);
  const fromEmbedded = readTokensFromEmbeddedLink(embeddedLink);
  if (fromEmbedded.tid && fromEmbedded.t) return fromEmbedded;

  const fromHash = window.location.hash.startsWith("#")
    ? new URLSearchParams(window.location.hash.slice(1))
    : null;
  if (fromHash) {
    const fromHashTokens = extractTokensFromParams(fromHash);
    if (fromHashTokens.tid && fromHashTokens.t) return fromHashTokens;
  }
  return { tid: "", t: "" };
}

const { tid: tokenId, t: tokenPlain } = readTokenFromLocation();
const silentAccessMode = Boolean(tokenId && tokenPlain);

let currentContext = null;
let productSelect = null;
const photoInput = document.querySelector('input[name="photos"]');
const tokenEntry = document.getElementById("tokenEntry");
const reviewLinkInput = document.getElementById("reviewLinkInput");
const reviewTokenIdInput = document.getElementById("reviewTokenId");
const reviewTokenValueInput = document.getElementById("reviewTokenValue");
const reviewTokenSubmit = document.getElementById("reviewTokenSubmit");

if (silentAccessMode && statusEl) {
  statusEl.hidden = true;
}

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b91c1c" : "#0f172a";
  statusEl.style.fontWeight = "400";
}

function showVerifiedStatus() {
  setStatus(
    "Link verificado correctamente. Ya podés dejar tu reseña. ¡Muchas gracias por confiar en NERINParts!",
  );
  if (statusEl) {
    statusEl.style.color = "#166534";
    statusEl.style.fontWeight = "600";
  }
}

function setTokenEntryVisibility(show) {
  if (!tokenEntry) return;
  tokenEntry.hidden = !show;
  tokenEntry.style.display = show ? "" : "none";
}

function mapTokenError(message) {
  const raw = String(message || "").trim();
  const normalized = raw.toLowerCase();
  if (!normalized) return "No pudimos validar el link de reseña. Probá abrir nuevamente el botón del mail.";
  if (
    normalized.includes("object can not be found") ||
    normalized.includes("token inválido") ||
    normalized.includes("token invalido") ||
    normalized.includes("invalid token") ||
    normalized.includes("not found") ||
    normalized.includes("cannot post /api/review-tokens/redeem")
  ) {
    return "No pudimos validar el link automáticamente. Probá abrir de nuevo el botón del mail o pegá el enlace completo en el campo de link.";
  }
  if (normalized.includes("unexpected token <") || normalized.includes("<!doctype html")) {
    return "El servidor devolvió una respuesta inválida al validar el link. Probá nuevamente en unos minutos.";
  }
  return raw;
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
  if (productSelect?.parentNode) {
    productSelect.parentNode.removeChild(productSelect);
  }
  productSelect = null;
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

  const firstDirectChild = form.firstElementChild;
  if (firstDirectChild) {
    form.insertBefore(wrapper, firstDirectChild);
  } else {
    form.appendChild(wrapper);
  }

  productSelect = wrapper;
}

async function parseResponseError(res) {
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const data = await res.json().catch(() => ({}));
    return mapTokenError(data.error || data.message || "");
  }
  const rawText = await res.text().catch(() => "");
  return mapTokenError(rawText);
}

async function redeemToken() {
  if (!tokenId || !tokenPlain) {
    setStatus("Necesitamos tu link de reseña para continuar.", true);
    setTokenEntryVisibility(true);
    return;
  }
  try {
    const res = await fetch("/api/review-tokens/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tid: tokenId, t: tokenPlain }),
    });
    if (!res.ok) {
      const errorMessage = await parseResponseError(res);
      throw new Error(errorMessage);
    }
    const data = await res.json();
    currentContext = data.context;
    renderContext(currentContext);
    if (currentContext?.scope === "purchase") {
      buildProductSelect(currentContext.order?.items || []);
    }
    showVerifiedStatus();
    setTokenEntryVisibility(false);
    if (form) form.hidden = false;
  } catch (err) {
    renderContext(null);
    if (form) form.hidden = true;
    setStatus(mapTokenError(err?.message), true);
    setTokenEntryVisibility(true);
  }
}

function handleTokenEntry() {
  const linkValue = normalizeTokenValue(reviewLinkInput?.value);
  let tid = normalizeTokenValue(reviewTokenIdInput?.value);
  let t = normalizeTokenValue(reviewTokenValueInput?.value);
  if (linkValue) {
    const extracted = readTokensFromEmbeddedLink(linkValue);
    tid = normalizeTokenValue(tid || extracted.tid);
    t = normalizeTokenValue(t || extracted.t);
    if (!tid || !t) {
      setStatus("El link pegado no es válido o no contiene token.", true);
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
