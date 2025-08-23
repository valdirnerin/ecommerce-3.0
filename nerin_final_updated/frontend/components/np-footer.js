(function () {
  if (window.__npFooterLoaded) return;
  window.__npFooterLoaded = true;

  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn)
      : fn();

  ready(async () => {
    try {
      let tpl = document.getElementById("np-footer-template");
      if (!tpl) {
        const res = await fetch("/components/np-footer.html?v=np-r2", {
          cache: "no-store",
        });
        const div = document.createElement("div");
        div.innerHTML = await res.text();
        tpl = div.querySelector("#np-footer-template");
        if (tpl) document.body.appendChild(tpl);
      }
      if (!tpl) return;
      document.body.appendChild(tpl.content.cloneNode(true));

      const cta = document.querySelector('[data-sticky-cta]');
      const main = document.querySelector('main');
      const wa = document.querySelector('[data-wa]');
      const footer = document.querySelector('footer');

      function setOffsets() {
        const h = (cta?.offsetHeight || 0);
        document.documentElement.style.setProperty('--cta-h', h + 'px');
        if (main) {
          main.style.paddingBottom = `calc(${h}px + env(safe-area-inset-bottom))`;
        }
        document.documentElement.classList.toggle('cta-visible', h > 0 && isCTAOnScreen());
      }

      function isCTAOnScreen() {
        const r = cta?.getBoundingClientRect();
        return r ? (window.innerHeight - r.bottom) <= 1 : false;
      }

      window.addEventListener('focusin', (e) => {
        if (e.target.matches('input, select, textarea')) {
          cta?.classList.add('is-hidden');
          setOffsets();
        }
      });
      window.addEventListener('focusout', () => {
        cta?.classList.remove('is-hidden');
        setOffsets();
      });

      if ('IntersectionObserver' in window && footer && cta) {
        const io = new IntersectionObserver(
          (entries) => {
            entries.forEach((en) => {
              if (en.isIntersecting) {
                cta.classList.add('is-hidden');
              } else {
                cta.classList.remove('is-hidden');
              }
              setOffsets();
            });
          },
          { rootMargin: '0px 0px -10% 0px', threshold: 0.01 }
        );
        io.observe(footer);
      }

      ['load', 'resize'].forEach((ev) =>
        window.addEventListener(ev, setOffsets, { passive: true })
      );
      const ro = 'ResizeObserver' in window && cta ? new ResizeObserver(setOffsets) : null;
      if (ro && cta) ro.observe(cta);

      const checkWa = () => {
        const hide = document.body.classList.contains('hide-whatsapp');
        if (wa) wa.style.display = hide ? 'none' : 'flex';
      };
      checkWa();
      window.addEventListener('resize', checkWa);

      setOffsets();
    } catch (e) {
      console.error('[np-footer]', e);
    }
  });
})();
