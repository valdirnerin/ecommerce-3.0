(function () {
  if (window.__nerinFooter) return;
  window.__nerinFooter = true;

  const html = document.documentElement;
  const markup = `
    <div data-sticky-cta class="sticky-cta">
      <span>¿Sos técnico o mayorista?</span>
      <a href="/mayoristas" class="button primary">Acceso mayoristas</a>
    </div>
    <footer class="site-footer" role="contentinfo"></footer>
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

    function update() {
      const ctaHeight = cta && !cta.classList.contains('is-hidden')
        ? cta.offsetHeight
        : 0;
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
      html.style.setProperty('--footer-offset', `${Math.ceil(offset)}px`);
    }

    // Hide CTA when footer visible
    if ('IntersectionObserver' in window && footer && cta) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) {
              cta.classList.add('is-hidden');
            } else {
              cta.classList.remove('is-hidden');
            }
            update();
          });
        },
        { rootMargin: '0px 0px -10% 0px', threshold: 0.01 }
      );
      io.observe(footer);
    }

    // Hide CTA on input focus
    window.addEventListener('focusin', (e) => {
      if (e.target.matches('input, select, textarea')) {
        cta?.classList.add('is-hidden');
        update();
      }
    });
    window.addEventListener('focusout', () => {
      cta?.classList.remove('is-hidden');
      update();
    });

    const checkWa = () => {
      const hide = document.body.classList.contains('hide-whatsapp');
      if (wa) wa.style.display = hide ? 'none' : 'flex';
    };
    checkWa();
    window.addEventListener('resize', checkWa);

    ['load', 'resize', 'orientationchange'].forEach((ev) =>
      window.addEventListener(ev, update, { passive: true })
    );
    const ro = 'ResizeObserver' in window && cta ? new ResizeObserver(update) : null;
    if (ro && cta) ro.observe(cta);

    update();
  });
})();
