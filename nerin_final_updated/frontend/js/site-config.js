const DEFAULT_SITE_CONFIG = {
  contacto_email: "soporte@nerinparts.com.ar",
  whatsapp_numero: "541112345678",
  whatsapp_url: "https://wa.me/541112345678",
  direccion_comercial: "Paseo Colón 545, Ciudad Autónoma de Buenos Aires, Argentina.",
  horarios: "Lunes a viernes de 9:00 a 18:00.",
  plazos_envio: "Despachamos en 24 a 48 hs hábiles a todo el país.",
  politica_garantia_resumen:
    "Garantía técnica de 6 meses por defectos de fábrica. La cobertura aplica a módulos probados sin pegado.",
};

function sanitizeWhatsappNumber(value) {
  if (!value) return "";
  return String(value).replace(/[^0-9]/g, "");
}

function normalizeOverrides(overrides = {}) {
  const normalized = { ...overrides };
  if (!normalized.contacto_email && overrides.supportEmail) {
    normalized.contacto_email = overrides.supportEmail;
  }
  if (!normalized.whatsapp_numero && overrides.whatsappNumber) {
    normalized.whatsapp_numero = overrides.whatsappNumber;
  }
  return normalized;
}

export function getSiteConfig(overrides = {}) {
  const merged = {
    ...DEFAULT_SITE_CONFIG,
    ...normalizeOverrides(overrides || {}),
  };
  const sanitizedNumber = sanitizeWhatsappNumber(merged.whatsapp_numero);
  if (sanitizedNumber) {
    merged.whatsapp_numero = sanitizedNumber;
  }
  if (!merged.whatsapp_url && sanitizedNumber) {
    merged.whatsapp_url = `https://wa.me/${sanitizedNumber}`;
  }
  return merged;
}
