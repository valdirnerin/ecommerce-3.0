(function () {
  if (window.__nerinFooter) return;
  window.__nerinFooter = true;

  const html = document.documentElement;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function buildMarkup(cfg) {
    const nav = (cfg.navigation || [])
      .map(
        (col) =>
          `<ul class="footer-nav-list">${col
            .map((l) => `<li><a href="${l.url}">${escapeHtml(l.text)}</a></li>`)
            .join('')}</ul>`
      )
      .join('');

    const contactItems = [];
    if (cfg.contact.whatsapp_number) {
      const waLink = `https://wa.me/${cfg.contact.whatsapp_number.replace(/\D/g, '')}`;
      contactItems.push(
        `<li><a href="${waLink}" target="_blank" rel="noopener">WhatsApp</a></li>`
      );
    }
    if (cfg.contact.email)
      contactItems.push(
        `<li><a href="mailto:${cfg.contact.email}">${escapeHtml(cfg.contact.email)}</a></li>`
      );
    if (cfg.contact.address)
      contactItems.push(`<li><span>${escapeHtml(cfg.contact.address)}</span></li>`);
    if (cfg.contact.opening_hours)
      contactItems.push(`<li><span>${escapeHtml(cfg.contact.opening_hours)}</span></li>`);

    const cta = cfg.cta.enabled
      ? `<div data-sticky-cta class="sticky-cta"><span>${escapeHtml(
          cfg.cta.prompt
        )}</span><a href="${cfg.cta.cta_link}" class="button primary">${escapeHtml(
          cfg.cta.button_text
        )}</a></div>`
      : '';

    const legal = `<small class="legal">${escapeHtml(
      cfg.legal.company_name
    )} – CUIT ${escapeHtml(cfg.legal.cuit)} — <a href="${cfg.legal.terms}">Términos</a> · <a href="${cfg.legal.privacy}">Privacidad</a></small>`;

    const waFab = cfg.contact.whatsapp_number
      ? `<a href="https://wa.me/${cfg.contact.whatsapp_number.replace(
          /\D/g,
          ''
        )}?text=Hola%20${encodeURIComponent(cfg.identity.brand_name)}" data-wa class="wa-fab" aria-label="Abrir WhatsApp" target="_blank" rel="noopener"><img src="/assets/whatsapp.svg" alt="" aria-hidden="true" /></a>`
      : '';

    return `${cta}<footer class="site-footer theme-${cfg.appearance.theme}" role="contentinfo"${
      cfg.appearance.accent ? ` style="--accent:${cfg.appearance.accent}"` : ''
    }><div class="footer-top"><div class="footer-brand"><a href="/" class="footer-logo"><img src="/assets/IMG_3086.png" alt="${escapeHtml(
      cfg.identity.brand_name
    )}" class="site-logo logo-${cfg.identity.logo_variant}" /></a>${
      cfg.identity.tagline ? `<p>${escapeHtml(cfg.identity.tagline)}</p>` : ''
    }</div><nav class="footer-nav" aria-label="Footer">${nav}</nav><div class="footer-contact"><ul class="footer-contact-list">${contactItems.join(
      ''
    )}</ul></div></div><div class="footer-bottom">${legal}</div></footer>${waFab}`;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    let cfg;
    try {
      const res = await fetch('/api/footer');
      cfg = await res.json();
    } catch {
      cfg = JSON.parse(JSON.stringify({
        identity: { brand_name: 'NERIN PARTS', logo_variant: 'light', tagline: '' },
        navigation: [[], [], []],
        contact: { whatsapp_number: '', email: '', address: '', opening_hours: '' },
        cta: { enabled: false, prompt: '', button_text: '', cta_link: '' },
        legal: { company_name: '', cuit: '', terms: '#', privacy: '#' },
        appearance: { theme: 'light', accent: '' },
      }));
    }

    const container = document.createElement('div');
    container.innerHTML = buildMarkup(cfg);
    document.body.appendChild(container);

    const cta = document.querySelector('[data-sticky-cta]');
    const footer = document.querySelector('footer');
    const wa = document.querySelector('[data-wa]');

    const getSafe = () =>
      parseFloat(getComputedStyle(html).getPropertyValue('--safe-area')) || 0;

    let lastInset = 0;
    let raf = 0;
    let ctaHidden = false;
    let ctaBase = 0;

    function update() {
      const ctaHeight = cta && !ctaHidden ? cta.offsetHeight : 0;
      let offset = ctaHeight;
      const vp = window.innerHeight;
      const safe = getSafe();
      if (footer) {
        const r = footer.getBoundingClientRect();
        if (r.top < vp - safe) {
          const overlap = vp - safe - r.top;
          if (overlap > offset) offset = overlap;
        }
      }
      const inset = Math.ceil(offset + safe);
      if (Math.abs(inset - lastInset) > 1) {
        lastInset = inset;
        html.style.setProperty('--bottom-inset', `${inset}px`);
      }
    }

    function requestUpdate() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    }

    // Hide CTA when footer visible
    if ('IntersectionObserver' in window && footer && cta) {
      const H = 12;
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            const diff = en.rootBounds.bottom - en.boundingClientRect.top;
            if (!ctaHidden && diff > H) {
              ctaHidden = true;
              ctaBase = cta.offsetHeight;
              cta.classList.add('is-hidden');
              requestUpdate();
            } else if (ctaHidden && diff < -ctaBase - H) {
              ctaHidden = false;
              cta.classList.remove('is-hidden');
              requestUpdate();
            }
          });
        },
        { rootMargin: '0px 0px -16px 0px', threshold: [0, 0.05, 0.1] }
      );
      io.observe(footer);
    }

    // Hide CTA on input focus
    window.addEventListener('focusin', (e) => {
      if (e.target.matches('input, select, textarea')) {
        ctaHidden = true;
        ctaBase = cta ? cta.offsetHeight : 0;
        cta?.classList.add('is-hidden');
        requestUpdate();
      }
    });
    window.addEventListener('focusout', () => {
      ctaHidden = false;
      cta?.classList.remove('is-hidden');
      requestUpdate();
    });

    const checkWa = () => {
      const hide = document.body.classList.contains('hide-whatsapp');
      if (wa) wa.style.display = hide ? 'none' : 'flex';
    };
    checkWa();
    window.addEventListener('resize', checkWa);

    ['load', 'resize', 'orientationchange'].forEach((ev) =>
      window.addEventListener(ev, requestUpdate, { passive: true })
    );
    const ro = 'ResizeObserver' in window ? new ResizeObserver(requestUpdate) : null;
    if (ro) {
      if (cta) ro.observe(cta);
      if (footer) ro.observe(footer);
    }

    requestUpdate();
  });
})();
