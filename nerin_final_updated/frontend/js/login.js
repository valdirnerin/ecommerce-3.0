import { login, requestPasswordReset } from "./api.js";

const form = document.getElementById("loginForm");
const errorDiv = document.getElementById("error");
const forgotForm = document.getElementById("forgotForm");
const forgotEmailInput = document.getElementById("forgotEmail");
const forgotFeedback = document.getElementById("forgotFeedback");
const forgotToggle = document.getElementById("forgotToggle");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  errorDiv.style.display = "none";
  try {
    const data = await login(email, password);
    // Según el rol, redirigir al panel o a la tienda
    const role = data.role;
    if (role === "admin" || role === "vendedor") {
      window.location.href = "/admin.html";
    } else {
      window.location.href = "/shop.html";
    }
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.style.display = "block";
  }
});

function toggleForgotForm(forceOpen = null) {
  if (!forgotForm || !forgotToggle) return;
  const shouldOpen =
    forceOpen === null ? !forgotForm.classList.contains("is-open") : forceOpen;
  forgotForm.classList.toggle("is-open", shouldOpen);
  forgotToggle.textContent = shouldOpen ? "Cerrar" : "Abrir";
}

if (forgotToggle && forgotForm) {
  toggleForgotForm(false);
  forgotToggle.addEventListener("click", () => toggleForgotForm());
}

if (forgotForm) {
  forgotForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!forgotEmailInput || !forgotFeedback) return;
    const email = forgotEmailInput.value.trim();
    forgotFeedback.textContent = "";
    forgotFeedback.classList.remove("is-error", "is-success");

    if (!email) {
      forgotFeedback.textContent = "Ingresá tu correo registrado.";
      forgotFeedback.classList.add("is-error");
      return;
    }

    const submitBtn = forgotForm.querySelector("button[type=submit]");
    const originalText = submitBtn?.textContent;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Enviando...";
    }
    forgotToggle && (forgotToggle.disabled = true);
    try {
      const data = await requestPasswordReset(email);
      forgotFeedback.textContent =
        data?.message || "Te enviamos un correo para recuperar tu acceso.";
      forgotFeedback.classList.add("is-success");
    } catch (err) {
      forgotFeedback.textContent =
        err?.message || "No pudimos enviar el correo de recuperación.";
      forgotFeedback.classList.add("is-error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
      forgotToggle && (forgotToggle.disabled = false);
    }
  });
}
