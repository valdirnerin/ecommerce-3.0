(function () {
  function getIdentifier() {
    const params = new URLSearchParams(window.location.search);
    const id =
      params.get('preference_id') ||
      params.get('pref_id') ||
      params.get('o') ||
      params.get('order') ||
      params.get('nrn') ||
      params.get('external_reference') ||
      params.get('collection_id') ||
      localStorage.getItem('nerin.lastNRN') ||
      localStorage.getItem('mp_last_pref') ||
      localStorage.getItem('mp_last_nrn');
    return id || null;
  }

  async function pollOrderStatus(id, opts = {}) {
    const { tries = 120, interval = 1500 } = opts;
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(id)}/status`, {
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          const st = data.status;
          const nrn = data.numeroOrden;
          if (st === 'approved' || st === 'rejected') {
            return { status: st, id, numeroOrden: nrn };
          }
        }
      } catch (e) {
        // ignore errors, treat as pending
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    return { status: 'pending', id };
  }

  function containerEl() {
    return document.getElementById('statusMessage');
  }

  function showProcessing(message = 'Estamos confirmando tu pago...') {
    const el = containerEl();
    if (el) {
      el.innerHTML = `<div class="spinner"></div><p>${message}</p>`;
    }
  }

  function showApproved(nrn) { // nerin brand fix
    const q = nrn ? `?order=${encodeURIComponent(nrn)}` : '';
    window.location.href = `/success.html${q}`;
  }

  function showRejected() { // nerin brand fix
    window.location.href = `/failure.html`;
  }

  window.getIdentifier = getIdentifier;
  window.pollOrderStatus = pollOrderStatus;
  window.showProcessing = showProcessing;
  window.showApproved = showApproved;
  window.showRejected = showRejected;

  document.addEventListener('DOMContentLoaded', () => {
    const email = localStorage.getItem('nerin.lastEmail');
    const nrn = localStorage.getItem('nerin.lastNRN');
    const emailInput = document.getElementById('email');
    const orderInput = document.getElementById('orderId');
    if (email && emailInput && !emailInput.value) emailInput.value = email;
    if (nrn && orderInput && !orderInput.value) orderInput.value = nrn;
  });
})();
