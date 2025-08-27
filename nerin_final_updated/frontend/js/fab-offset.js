(function () {
  const selectors = '[data-wa], a[href*="wa.me"], .whatsapp-fab, [class*="whatsapp"]';
  const fab = document.querySelector(selectors);

  const getSafe = () =>
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--safe-area')
    ) || 0;

  function update() {
    let offset = 0;
    const vp = window.innerHeight;
    const safe = getSafe();
    document.querySelectorAll('body *').forEach((el) => {
      if (!el || el === fab || (fab && fab.contains(el))) return;
      if (el.offsetParent === null) return;
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        const rect = el.getBoundingClientRect();
        if (rect.bottom >= vp - safe - 1 && rect.top < vp) {
          offset += rect.height;
        }
      }
    });
    const footer = document.querySelector('footer');
    if (footer) {
      const r = footer.getBoundingClientRect();
      if (r.top < vp - safe) {
        const overlap = vp - safe - r.top;
        if (overlap > offset) offset = overlap;
      }
    }
    document.documentElement.style.setProperty(
      '--fab-safe-offset',
      `${Math.ceil(offset)}px`
    );
  }

  window.addEventListener('resize', update);
  const mo = new MutationObserver(update);
  mo.observe(document.body, { childList: true, subtree: true, attributes: true });
  document.addEventListener('DOMContentLoaded', update);
  update();
})();
