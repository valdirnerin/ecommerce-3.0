/*
 * Registro de cuentas NERIN
 * - Registro inmediato para clientes minoristas.
 * - Solicitud verificada para cuentas mayoristas con código de confirmación.
 */

const retailForm = document.getElementById("registerForm");
const retailStatus = document.getElementById("regError");
const wholesaleForm = document.getElementById("wholesaleForm");
const wholesaleStatus = document.getElementById("wholesaleStatus");
const sendCodeButton = document.getElementById("sendWholesaleCode");

let wholesaleCodeEmail = null;

function safeTrim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function showFormStatus(el, message = "", type = "info") {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("is-error", "is-success", "is-visible");
  if (message) {
    if (type === "error") {
      el.classList.add("is-error");
    } else if (type === "success") {
      el.classList.add("is-success");
    }
    el.classList.add("is-visible");
  }
}

function notify(message, type = "info") {
  if (typeof Toastify !== "undefined") {
    const colors = {
      success: "#0f766e",
      error: "#dc2626",
      info: "#1f2937",
    };
    Toastify({
      text: message,
      duration: 4200,
      gravity: "top",
      position: "center",
      style: {
        background: colors[type] || colors.info,
      },
    }).showToast();
  }
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || data.message || "No se pudo completar la solicitud";
    throw new Error(message);
  }
  return data;
}

if (retailForm) {
  retailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFormStatus(retailStatus);

    const name = safeTrim(document.getElementById("regName")?.value);
    const email = safeTrim(document.getElementById("regEmail")?.value);
    const password = document.getElementById("regPassword")?.value || "";
    const confirm = document.getElementById("regConfirm")?.value || "";
    const role = document.getElementById("regRole")?.value || "minorista";

    if (password !== confirm) {
      showFormStatus(retailStatus, "Las contraseñas no coinciden", "error");
      return;
    }

    const submitBtn = retailForm.querySelector('button[type="submit"]');
    const defaultText = submitBtn ? submitBtn.textContent : "";

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Creando cuenta...";
      }

      const data = await postJson("/api/register", {
        email,
        password,
        name,
        role,
      });

      localStorage.setItem("nerinToken", data.token);
      localStorage.setItem("nerinUserRole", data.role);
      localStorage.setItem("nerinUserName", name || "Cliente");
      localStorage.setItem("nerinUserEmail", email);

      showFormStatus(
        retailStatus,
        "Cuenta creada correctamente. Te estamos redirigiendo a la tienda...",
        "success",
      );
      notify("¡Bienvenido a NERIN!", "success");

      setTimeout(() => {
        window.location.href = "/shop.html";
      }, 900);
    } catch (error) {
      showFormStatus(retailStatus, error.message, "error");
      notify(error.message, "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = defaultText || "Crear cuenta";
      }
    }
  });
}

if (sendCodeButton) {
  sendCodeButton.addEventListener("click", async () => {
    showFormStatus(wholesaleStatus);

    const email = safeTrim(document.getElementById("wholesaleEmail")?.value);
    const confirmEmail = safeTrim(
      document.getElementById("wholesaleEmailConfirm")?.value,
    );
    const legalName = safeTrim(document.getElementById("wholesaleLegalName")?.value);
    const contactName = safeTrim(document.getElementById("wholesaleContact")?.value);
    const phone = safeTrim(document.getElementById("wholesalePhone")?.value);

    if (!email || !confirmEmail) {
      showFormStatus(wholesaleStatus, "Ingresá y confirmá tu correo corporativo", "error");
      return;
    }

    if (email.toLowerCase() !== confirmEmail.toLowerCase()) {
      showFormStatus(wholesaleStatus, "Los correos no coinciden", "error");
      return;
    }

    const originalText = sendCodeButton.textContent;

    try {
      sendCodeButton.disabled = true;
      sendCodeButton.textContent = "Enviando...";

      await postJson("/api/wholesale/send-code", {
        email,
        confirmEmail,
        legalName,
        contactName,
        phone,
      });

      wholesaleCodeEmail = email.toLowerCase();
      showFormStatus(
        wholesaleStatus,
        "Enviamos un código de verificación a tu correo. Revisá tu bandeja de entrada o spam",
        "success",
      );
      notify("Código enviado. Revisá tu email", "info");
    } catch (error) {
      showFormStatus(wholesaleStatus, error.message, "error");
      notify(error.message, "error");
    } finally {
      sendCodeButton.disabled = false;
      sendCodeButton.textContent = originalText || "Enviar código";
    }
  });
}

if (wholesaleForm) {
  wholesaleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFormStatus(wholesaleStatus);

    const legalName = safeTrim(document.getElementById("wholesaleLegalName")?.value);
    const taxId = safeTrim(document.getElementById("wholesaleTaxId")?.value);
    const contactName = safeTrim(document.getElementById("wholesaleContact")?.value);
    const phone = safeTrim(document.getElementById("wholesalePhone")?.value);
    const email = safeTrim(document.getElementById("wholesaleEmail")?.value);
    const confirmEmail = safeTrim(
      document.getElementById("wholesaleEmailConfirm")?.value,
    );
    const verificationCode = safeTrim(
      document.getElementById("wholesaleCode")?.value,
    );
    const province = document.getElementById("wholesaleProvince")?.value || "";
    const website = safeTrim(document.getElementById("wholesaleWebsite")?.value);
    const companyType = safeTrim(
      document.getElementById("wholesaleCompanyType")?.value,
    );
    const salesChannel = safeTrim(
      document.getElementById("wholesaleSalesChannel")?.value,
    );
    const monthlyVolume = document.getElementById("wholesaleMonthlyVolume")?.value || "";
    const systems = safeTrim(document.getElementById("wholesaleSystems")?.value);
    const afipUrl = safeTrim(document.getElementById("wholesaleAfipUrl")?.value);
    const notes = safeTrim(document.getElementById("wholesaleNotes")?.value);
    const termsAccepted = Boolean(document.getElementById("wholesaleTerms")?.checked);

    if (!email || !confirmEmail) {
      showFormStatus(wholesaleStatus, "Ingresá y confirmá tu correo corporativo", "error");
      return;
    }

    if (email.toLowerCase() !== confirmEmail.toLowerCase()) {
      showFormStatus(wholesaleStatus, "Los correos no coinciden", "error");
      return;
    }

    if (!verificationCode || !/^\d{4,6}$/.test(verificationCode)) {
      showFormStatus(
        wholesaleStatus,
        "Ingresá el código de verificación que te enviamos",
        "error",
      );
      return;
    }

    if (wholesaleCodeEmail !== email.toLowerCase()) {
      showFormStatus(
        wholesaleStatus,
        "Solicitá primero el código de verificación para este correo",
        "error",
      );
      return;
    }

    if (!termsAccepted) {
      showFormStatus(
        wholesaleStatus,
        "Debés aceptar la declaración para continuar",
        "error",
      );
      return;
    }

    const submitBtn = wholesaleForm.querySelector('button[type="submit"]');
    const defaultText = submitBtn ? submitBtn.textContent : "";

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Enviando solicitud...";
      }

      await postJson("/api/wholesale/apply", {
        legalName,
        taxId,
        contactName,
        phone,
        email,
        confirmEmail,
        verificationCode,
        province,
        website,
        companyType,
        salesChannel,
        monthlyVolume,
        systems,
        afipUrl,
        notes,
        termsAccepted,
      });

      wholesaleForm.reset();
      wholesaleCodeEmail = null;
      showFormStatus(
        wholesaleStatus,
        "Recibimos tu solicitud. Te contactaremos por correo dentro de las próximas 48 hs hábiles",
        "success",
      );
      notify("Solicitud enviada. Te contactaremos por email", "success");
    } catch (error) {
      showFormStatus(wholesaleStatus, error.message, "error");
      notify(error.message, "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = defaultText || "Enviar solicitud para revisión";
      }
    }
  });
}
