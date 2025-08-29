(function () {
  if (window.__nerinFooter) return;
  window.__nerinFooter = true;

  const html = document.documentElement;
  const markup = `
    <div data-sticky-cta class="sticky-cta">
      <span>¿Sos técnico o mayorista?</span>
      <a href="/mayoristas" class="button primary">Acceso mayoristas</a>
    </div>
    <footer class="site-footer" role="contentinfo">
      <div class="footer-top">
        <div class="footer-brand">
          <a href="/" class="footer-logo">
            <img src="/assets/IMG_3086.png" alt="NERIN Parts" class="site-logo" />
          </a>
        </div>
        <nav class="footer-nav" aria-label="Footer">
          <ul class="footer-nav-list">
            <li><a href="/shop.html">Tienda</a></li>
            <li><a href="/product.html">Productos</a></li>
            <li><a href="/mayoristas">Mayoristas</a></li>
            <li><a href="#">Sobre nosotros</a></li>
            <li><a href="/contact.html">Contacto</a></li>
          </ul>
        </nav>
        <div class="footer-contact">
          <ul class="footer-contact-list">
            <li><a href="https://wa.me/5491100000000?text=Hola%20NERIN" target="_blank" rel="noopener">WhatsApp</a></li>
            <li><a href="mailto:info@nerinparts.com.ar">info@nerinparts.com.ar</a></li>
            <li><span>Dirección y horario próximamente</span></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <small class="legal">Razón Social S.A. – CUIT 30-00000000-0 — <a href="/pages/terminos.html">Términos</a> · <a href="/pages/terminos.html">Privacidad</a></small>
      </div>
    </footer>
    <a href="https://wa.me/5491100000000?text=Hola%20Nerin%20Parts" data-wa class="wa-fab" aria-label="Abrir WhatsApp" target="_blank" rel="noopener">
      <img src="/assets/whatsapp.svg" alt="" aria-hidden="true" />
    </a>`;

  document.addEventListener('DOMContentLoaded', () => {
    const container = document.createElement('div');
    container.innerHTML = markup;
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
