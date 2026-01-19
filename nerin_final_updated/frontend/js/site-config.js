export const SITE_CONFIG = {
  contacto_email: "ventas@nerinparts.com.ar",
  whatsapp_numero: "+54 9 11 3034-1550",
  whatsapp_url: "https://wa.me/5491130341550",
  direccion_comercial: "Paseo Colón 545, CABA, Argentina",
  horarios: "Lunes a viernes de 9 a 18 h",
  plazos_envio: "CABA 24 a 48 h hábiles · Interior 2 a 5 días hábiles",
  politica_garantia_resumen:
    "Garantía técnica por defectos de fábrica: probá el módulo sin pegar y notificá dentro de los 7 días corridos posteriores a la entrega.",
  fecha_actualizacion: "2 de agosto de 2025",
};

export function getSiteConfig() {
  if (typeof window !== "undefined") {
    const override = window.NERIN_SITE_CONFIG || window.NERIN_CONFIG?.siteConfig;
    if (override && typeof override === "object") {
      return { ...SITE_CONFIG, ...override };
    }
  }
  return { ...SITE_CONFIG };
}
