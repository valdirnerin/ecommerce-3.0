/*
 * Módulo de internacionalización (i18n) para la interfaz de NERIN.
 * Define traducciones básicas para español e inglés y aplica las traducciones
 * a los elementos con atributos `data-i18n`. El idioma seleccionado se
 * almacena en `localStorage` bajo la clave `nerinLang`.
 */

const translations = {
  es: {
    "admin.title": "Panel de administración",
    "admin.subtitle":
      "Gestiona productos, pedidos, clientes y métricas desde aquí.",
    "nav.products": "Productos",
    "nav.orders": "Pedidos",
    "nav.clients": "Clientes",
    "nav.metrics": "Métricas",
    "nav.calculator": "Calculadora",
    "nav.returns": "Devoluciones",
    "nav.config": "Configuración",
    "nav.shipping": "Envíos",
    "nav.suppliers": "Proveedores",
    "nav.purchase": "Órdenes de compra",
    "nav.analytics": "Analíticas",
    "calculator.title": "Calculadora profesional de costos",
    "calculator.description":
      "Esta vista integra la herramienta completa solicitada para calcular el costo puesto, márgenes objetivo y precio final con IVA. Podés cargar costos en USD o ARS, aplicar tributos parametrizables, simular comisiones o usar un fee real notificado por el gateway de pago. El contenido se muestra dentro del admin para evitar saltar entre pantallas.",
    "calculator.linkPrompt":
      "Si preferís abrirla en otra pestaña, usá este acceso directo:",
    "calculator.linkText": "Abrir calculadora completa",
    "calculator.note":
      "Nota: si el iframe no carga (por políticas del servidor estático), utilizá el enlace “Abrir calculadora completa” para acceder a la herramienta en una ventana nueva.",
    "products.title": "Gestión de productos",
    "orders.title": "Gestión de pedidos",
    "clients.title": "Clientes",
    "metrics.title": "Métricas",
    "returns.title": "Devoluciones",
    "config.title": "Configuración",
    "suppliers.title": "Gestión de proveedores",
    "purchase.title": "Órdenes de compra",
    "analytics.title": "Analíticas detalladas",
    "analytics.monthlySales": "Ventas por mes",
    "analytics.avgOrder": "Valor medio de pedido",
    "analytics.returnRate": "Tasa de devoluciones",
    "analytics.mostReturned": "Producto más devuelto",
  },
  en: {
    "admin.title": "Administration Panel",
    "admin.subtitle": "Manage products, orders, clients and metrics here.",
    "nav.products": "Products",
    "nav.orders": "Orders",
    "nav.clients": "Clients",
    "nav.metrics": "Metrics",
    "nav.calculator": "Calculator",
    "nav.returns": "Returns",
    "nav.config": "Settings",
    "nav.shipping": "Shipping",
    "nav.suppliers": "Suppliers",
    "nav.purchase": "Purchase Orders",
    "nav.analytics": "Analytics",
    "calculator.title": "Professional cost calculator",
    "calculator.description":
      "This view integrates the complete tool requested to calculate landed cost, target margins, and final price with VAT. You can enter costs in USD or ARS, apply configurable duties, simulate commissions, or use an actual fee reported by the payment gateway. The content is displayed inside the admin to avoid switching screens.",
    "calculator.linkPrompt":
      "If you prefer to open it in another tab, use this shortcut:",
    "calculator.linkText": "Open full calculator",
    "calculator.note":
      "Note: if the iframe does not load (due to static server policies), use the “Open full calculator” link to access the tool in a new window.",
    "products.title": "Product Management",
    "orders.title": "Order Management",
    "clients.title": "Clients",
    "metrics.title": "Metrics",
    "returns.title": "Returns",
    "config.title": "Configuration",
    "suppliers.title": "Supplier Management",
    "purchase.title": "Purchase Orders",
    "analytics.title": "Detailed Analytics",
    "analytics.monthlySales": "Sales by month",
    "analytics.avgOrder": "Average order value",
    "analytics.returnRate": "Return rate",
    "analytics.mostReturned": "Most returned product",
  },
};

function applyTranslations(lang) {
  const dict = translations[lang] || translations.es;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (dict[key]) {
      el.textContent = dict[key];
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const langSelect = document.getElementById("langSelect");
  const saved = localStorage.getItem("nerinLang") || "es";
  if (langSelect) {
    langSelect.value = saved;
    langSelect.addEventListener("change", () => {
      localStorage.setItem("nerinLang", langSelect.value);
      applyTranslations(langSelect.value);
    });
  }
  applyTranslations(saved);
});

// Export for other modules if needed
export { applyTranslations };
