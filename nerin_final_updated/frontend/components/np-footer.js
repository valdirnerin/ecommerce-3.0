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

      function setOffsets() {
        let h = 0;
        if (cta && !document.body.classList.contains('hide-cta')) {
          h = cta.offsetHeight;
        }
        document.documentElement.style.setProperty('--cta-offset', h + 'px');
        if (main) {
          main.style.paddingBottom = `calc(${h}px + env(safe-area-inset-bottom))`;
        }
      }
      setOffsets();
      window.addEventListener('resize', setOffsets);

      if (document.body.classList.contains('hide-cta')) {
        cta && cta.classList.add('is-hidden');
      }

      window.addEventListener('focusin', (e) => {
        if (e.target.matches('input,select,textarea')) {
          cta && cta.classList.add('is-hidden');
        }
      });
      window.addEventListener('focusout', () => cta && cta.classList.remove('is-hidden'));

      const checkWa = () => {
        const hide = window.innerWidth < 360 || document.body.classList.contains('hide-whatsapp');
        if (wa) wa.style.display = hide ? 'none' : 'flex';
      };
      checkWa();
      window.addEventListener('resize', checkWa);
    } catch (e) {
      console.error('[np-footer]', e);
    }
  });
})();
