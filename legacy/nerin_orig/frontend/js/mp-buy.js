export function setupMpBuyButtons(selector = '.mp-buy') {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.addEventListener('click', () => {
      const title = btn.dataset.title;
      const price = btn.dataset.price;
      const quantity = btn.dataset.quantity || '1';
      if (!title || !price) {
        console.error('Datos de producto incompletos');
        return;
      }
      localStorage.setItem('mp_title', title);
      localStorage.setItem('mp_price', price);
      localStorage.setItem('mp_quantity', quantity);
      // Redirige al nuevo formulario de checkout con pasos
      window.location.href = '/checkout-steps.html';
    });
  });
}

