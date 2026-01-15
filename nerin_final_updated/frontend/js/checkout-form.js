document.addEventListener("DOMContentLoaded", () => {
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

  const form = document.querySelector("form.shipping-form");
  const loading = document.getElementById("loading");
  if (!form) return;

  function safeParseLocalStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn(`No se pudo leer ${key} desde localStorage`, error);
      return null;
    }
  }

  function readTrackingSessionId() {
    try {
      const raw = localStorage.getItem("nerinActivitySession");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.id ? parsed.id : null;
    } catch (error) {
      console.warn("No se pudo leer la sesión de tracking", error);
      return null;
    }
  }

  function setFieldValue(id, value) {
    if (value == null) return;
    const el = document.getElementById(id);
    if (el) {
      el.value = value;
    }
  }

  const storedCheckout = safeParseLocalStorage("nerinUserInfo");
  const storedProfile = storedCheckout || safeParseLocalStorage("nerinUserProfile");
  const fallbackName = (localStorage.getItem("nerinUserName") || "").trim();
  const fallbackEmail = (localStorage.getItem("nerinUserEmail") || "").trim();

  const profile =
    storedProfile && typeof storedProfile === "object" ? { ...storedProfile } : {};

  if (!profile.nombre && fallbackName) {
    const [first = "", ...rest] = fallbackName.split(/\s+/);
    profile.nombre = first || fallbackName;
    profile.apellido = profile.apellido || rest.join(" ");
  }

  if (!profile.email && fallbackEmail) {
    profile.email = fallbackEmail;
  }

  const address = profile.direccion || profile.address || {};

  setFieldValue("nombre", profile.nombre || profile.name || "");
  setFieldValue("email", profile.email || profile.mail || "");
  setFieldValue("telefono", profile.telefono || profile.phone || profile.celular || "");
  setFieldValue("calle", profile.calle || address.calle || address.street || "");
  setFieldValue("numero", profile.numero || address.numero || address.number || "");
  setFieldValue("piso", profile.piso || address.piso || address.apartamento || "");
  setFieldValue("localidad", profile.localidad || address.localidad || address.ciudad || "");
  setFieldValue(
    "provincia",
    profile.provincia || address.provincia || address.estado || profile.state || "",
  );
  setFieldValue("cp", profile.cp || address.cp || address.zip || address.codigo_postal || "");
  setFieldValue(
    "metodo_envio",
    profile.metodo || profile.metodo_envio || profile.shippingMethod || "",
  );

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
        sessionId: readTrackingSessionId(),
      };

      try {
        const profileToStore = {
          nombre: cliente.nombre,
          email: cliente.email,
          telefono: cliente.telefono,
          provincia: cliente.direccion.provincia,
          localidad: cliente.direccion.localidad,
          calle: cliente.direccion.calle,
          numero: cliente.direccion.numero,
          piso: cliente.direccion.piso,
          cp: cliente.direccion.cp,
          metodo: payload.metodo_envio,
        };
        localStorage.setItem("nerinUserProfile", JSON.stringify(profileToStore));
      } catch (profileError) {
        console.warn("No se pudo actualizar el perfil de envío", profileError);
      }

      if (loading) loading.classList.add("active");
      const res = await apiFetch("/api/orders", {
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
        localStorage.setItem('mp_last_pref', data.preferenceId || '');
        localStorage.setItem('mp_last_nrn', data.nrn || data.orderId || '');
        localStorage.removeItem("nerinCart");
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
