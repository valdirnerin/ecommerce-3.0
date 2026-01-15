import { getSiteConfig } from "./site-config.js";

function setText(selector, value) {
  document.querySelectorAll(selector).forEach((node) => {
    node.textContent = value;
  });
}

function setLink(selector, value, href) {
  document.querySelectorAll(selector).forEach((node) => {
    node.textContent = value;
    if (href) {
      node.setAttribute("href", href);
    }
  });
}

function applySiteConfig(cfg) {
  if (!cfg) return;
  setText("[data-site-address]", cfg.direccion_comercial || "");
  setText("[data-site-hours]", cfg.horarios || "");
  setText("[data-site-shipping]", cfg.plazos_envio || "");
  setText("[data-site-warranty]", cfg.politica_garantia_resumen || "");
  if (cfg.contacto_email) {
    setText("[data-site-email]", cfg.contacto_email);
    setLink("[data-site-email-link]", cfg.contacto_email, `mailto:${cfg.contacto_email}`);
  }
  if (cfg.whatsapp_numero) {
    setText("[data-site-whatsapp-number]", cfg.whatsapp_numero);
  }
  if (cfg.whatsapp_url) {
    setLink("[data-site-whatsapp-link]", cfg.whatsapp_numero || cfg.whatsapp_url, cfg.whatsapp_url);
  }
}

function initLegalConfig() {
  const cfg = getSiteConfig(window.NERIN_CONFIG || {});
  applySiteConfig(cfg);
}

document.addEventListener("nerin:config-loaded", (event) => {
  const cfg = getSiteConfig(event.detail || {});
  applySiteConfig(cfg);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLegalConfig);
} else {
  initLegalConfig();
}
