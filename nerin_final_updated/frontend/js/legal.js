import { getSiteConfig } from "./site-config.js";

const config = getSiteConfig();

function applyText(key, value) {
  if (!value) return;
  document.querySelectorAll(`[data-site-text="${key}"]`).forEach((el) => {
    el.textContent = value;
  });
}

function applyEmail(value) {
  if (!value) return;
  document.querySelectorAll("[data-site-email]").forEach((el) => {
    if (el.tagName === "A") {
      el.setAttribute("href", `mailto:${value}`);
      el.textContent = value;
    } else {
      el.textContent = value;
    }
  });
}

function applyWhatsapp(number, url) {
  if (!number && !url) return;
  const targetUrl = url || "";
  document.querySelectorAll("[data-site-whatsapp]").forEach((el) => {
    if (el.tagName === "A") {
      if (targetUrl) {
        el.setAttribute("href", targetUrl);
      }
      el.textContent = number || el.textContent;
    } else {
      el.textContent = number || el.textContent;
    }
  });
}

function init() {
  applyText("direccion_comercial", config.direccion_comercial);
  applyText("horarios", config.horarios);
  applyText("plazos_envio", config.plazos_envio);
  applyText("politica_garantia_resumen", config.politica_garantia_resumen);
  applyText("fecha_actualizacion", config.fecha_actualizacion);
  applyEmail(config.contacto_email);
  applyWhatsapp(config.whatsapp_numero, config.whatsapp_url);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
