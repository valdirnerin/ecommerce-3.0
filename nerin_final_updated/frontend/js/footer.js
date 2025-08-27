(function () {
  async function loadFooter() {
    try {
      const res = await fetch('/api/footer');
      if (!res.ok) throw new Error('bad');
      const data = await res.json();
      applyFooter(data);
    } catch (e) {
      // keep defaults
    }
  }

  function applyFooter(data) {
    if (!data || typeof data !== 'object') return;
    const chips = document.querySelector('.contact-chips .chips');
    if (chips && data.contact) {
      chips.innerHTML = '';
      if (data.contact.phone) {
        const a = document.createElement('a');
        a.className = 'chip';
        a.href = `tel:${data.contact.phone}`;
        a.textContent = data.contact.phone;
        chips.appendChild(a);
      }
      if (data.contact.email) {
        const a = document.createElement('a');
        a.className = 'chip';
        a.href = `mailto:${data.contact.email}`;
        a.textContent = data.contact.email;
        chips.appendChild(a);
      }
      if (data.contact.location) {
        const span = document.createElement('span');
        span.className = 'chip';
        span.textContent = data.contact.location;
        chips.appendChild(span);
      }
    }

    const nav = document.querySelector('.footer-nav');
    if (nav && Array.isArray(data.links)) {
      nav.innerHTML = '';
      data.links.forEach((l) => {
        if (!l || !l.label || !l.href) return;
        const a = document.createElement('a');
        a.href = l.href;
        a.textContent = l.label;
        nav.appendChild(a);
      });
    }

    const social = document.querySelector('.footer-social');
    if (social && Array.isArray(data.social)) {
      social.innerHTML = '';
      data.social.forEach((s) => {
        if (!s || !s.label || !s.href) return;
        const a = document.createElement('a');
        a.href = s.href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = s.label;
        social.appendChild(a);
      });
    }

    const legal = document.querySelector('.legal');
    if (legal && typeof data.legal === 'string') {
      legal.textContent = data.legal;
    }
  }

  document.addEventListener('DOMContentLoaded', loadFooter);
})();
