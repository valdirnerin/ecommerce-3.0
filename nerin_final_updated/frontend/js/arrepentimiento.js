import { apiFetch } from "./api.js";

const form = document.getElementById("arrepentForm");
const result = document.getElementById("arrepentResult");

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      email: document.getElementById("arrepentEmail")?.value?.trim(),
      orderNumber: document.getElementById("arrepentOrder")?.value?.trim(),
      reason: document.getElementById("arrepentReason")?.value?.trim(),
      message: document.getElementById("arrepentMessage")?.value?.trim(),
    };

    if (!payload.email || !payload.orderNumber) {
      result.textContent = "Completá email y número de orden para continuar.";
      result.className = "contact-status error";
      return;
    }

    result.textContent = "Enviando solicitud…";
    result.className = "contact-status";

    try {
      const response = await apiFetch("/api/arrepentimiento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "No se pudo registrar la solicitud");
      }
      result.textContent = `Solicitud registrada. Código de arrepentimiento: ${data.code}`;
      result.className = "contact-status success";
      form.reset();
    } catch (error) {
      result.textContent = error.message || "Error al procesar la solicitud.";
      result.className = "contact-status error";
    }
  });
}
