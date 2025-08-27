(function () {
  async function loadFooter() {
    try {
      const res = await fetch(`/api/footer?ts=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('bad');
      const data = await res.json();
      applyFooter(data);
    } catch (e) {
      // keep defaults
    }
  }

  function createIcon(label) {
    const n = label.toLowerCase();
    const svg = document.createElement('svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML =
      n === 'instagram'
        ? '<path d="M7 2C4.243 2 2 4.243 2 7v10c0 2.757 2.243 5 5 5h10c2.757 0 5-2.243 5-5V7c0-2.757-2.243-5-5-5H7zm10 2a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h10zm-5 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm4.5-3a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />'
        : n === 'linkedin'
        ? '<path d="M19 0H5C2.238 0 0 2.238 0 5v14c0 2.762 2.238 5 5 5h14c2.762 0 5-2.238 5-5V5c0-2.762-2.238-5-5-5zM7 19H4V9h3v10zM5.5 7.732A1.732 1.732 0 1 1 5.5 4.268a1.732 1.732 0 0 1 0 3.464zM20 19h-3v-5.604c0-1.336-.027-3.058-1.862-3.058-1.862 0-2.148 1.454-2.148 2.955V19h-3V9h2.879v1.367h.041c.401-.761 1.381-1.561 2.844-1.561 3.041 0 3.646 2.001 3.646 4.604V19z" />'
        : '';
    return svg.innerHTML ? svg : null;
  }

  function applyFooter(data) {
    if (!data || typeof data !== 'object') return;
    const chips =
      document.querySelector('.contact-chips .chips') ||
      document.querySelector('.contact-chips');
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
        const icon = createIcon(s.label);
        if (icon) {
          a.appendChild(icon);
          a.setAttribute('aria-label', s.label);
        } else {
          a.textContent = s.label;
        }
        social.appendChild(a);
      });
    }

    const legal = document.querySelector('.legal');
    if (legal && typeof data.legal === 'string') {
      legal.textContent = data.legal;
    }
  }

  document.addEventListener('DOMContentLoaded', loadFooter);
  window.NPFooter = { loadFooter, applyFooter };
})();
