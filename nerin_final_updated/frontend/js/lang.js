/*
 * Módulo de internacionalización (i18n) para la interfaz de NERIN.
 * Define traducciones básicas para español e inglés y aplica las traducciones
 * a los elementos con atributos `data-i18n`. El idioma seleccionado se
 * almacena en `localStorage` bajo la clave `nerinLang`.
 */

const translations = {
  es: {
    'admin.title': 'Panel de administración',
    'admin.subtitle': 'Gestiona productos, pedidos, clientes y métricas desde aquí.',
    'nav.products': 'Productos',
    'nav.orders': 'Pedidos',
    'nav.clients': 'Clientes',
    'nav.metrics': 'Métricas',
    'nav.returns': 'Devoluciones',
    'nav.config': 'Configuración',
    'nav.suppliers': 'Proveedores',
    'nav.purchase': 'Órdenes de compra',
    'nav.analytics': 'Analíticas',
    'products.title': 'Gestión de productos',
    'orders.title': 'Gestión de pedidos',
    'clients.title': 'Clientes',
    'metrics.title': 'Métricas',
    'returns.title': 'Devoluciones',
    'config.title': 'Configuración',
    'suppliers.title': 'Gestión de proveedores',
    'purchase.title': 'Órdenes de compra',
    'analytics.title': 'Analíticas detalladas'
  },
  en: {
    'admin.title': 'Administration Panel',
    'admin.subtitle': 'Manage products, orders, clients and metrics here.',
    'nav.products': 'Products',
    'nav.orders': 'Orders',
    'nav.clients': 'Clients',
    'nav.metrics': 'Metrics',
    'nav.returns': 'Returns',
    'nav.config': 'Settings',
    'nav.suppliers': 'Suppliers',
    'nav.purchase': 'Purchase Orders',
    'nav.analytics': 'Analytics',
    'products.title': 'Product Management',
    'orders.title': 'Order Management',
    'clients.title': 'Clients',
    'metrics.title': 'Metrics',
    'returns.title': 'Returns',
    'config.title': 'Configuration',
    'suppliers.title': 'Supplier Management',
    'purchase.title': 'Purchase Orders',
    'analytics.title': 'Detailed Analytics'
  }
};

function applyTranslations(lang) {
  const dict = translations[lang] || translations.es;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) {
      el.textContent = dict[key];
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const langSelect = document.getElementById('langSelect');
  const saved = localStorage.getItem('nerinLang') || 'es';
  if (langSelect) {
    langSelect.value = saved;
    langSelect.addEventListener('change', () => {
      localStorage.setItem('nerinLang', langSelect.value);
      applyTranslations(langSelect.value);
    });
  }
  applyTranslations(saved);
});

// Export for other modules if needed
export { applyTranslations };