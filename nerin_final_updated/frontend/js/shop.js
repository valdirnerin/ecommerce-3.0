import { getProducts } from './api.js';
import { formatCurrencyARS } from './dataAdapters.js';

(async () => {
  try {
    const products = await getProducts();
    const grid = document.querySelector('#productGrid');
    grid.innerHTML = products
      .map(
        (p) => `
      <article class="card">
        <img src="${p.image_url ?? '/assets/placeholder.png'}" alt="${p.name}">
        <h3>${p.name || '—'}</h3>
        <p class="muted">SKU: ${p.sku || '—'}</p>
        <p class="muted">${p.brand || '—'} ${p.model || ''}</p>
        <p class="price">${formatCurrencyARS(p.price)}</p>
        <p class="stock ${p.stock > 0 ? 'ok' : 'out'}">Stock: ${p.stock ?? 0}</p>
      </article>
    `
      )
      .join('');
  } catch (e) {
    const errEl = document.querySelector('#products-error');
    if (errEl) errEl.textContent = 'No se pudieron cargar productos.';
    console.error(e);
  }
})();
