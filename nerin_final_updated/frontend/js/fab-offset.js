(function () {
  const selectors = 'a[href*="wa.me"], .whatsapp-fab, [class*="whatsapp"]';
  const fab = document.querySelector(selectors);
  if (fab) {
    fab.style.position = 'fixed';
    fab.style.right = '16px';
    fab.style.bottom = 'calc(var(--fab-safe-offset) + 16px)';
    fab.style.zIndex = '1000';
  }

  function update() {
    let offset = 0;
    const vp = window.innerHeight;
    document.querySelectorAll('body *').forEach((el) => {
      if (!el || el === fab || (fab && fab.contains(el))) return;
      if (el.offsetParent === null) return;
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        const rect = el.getBoundingClientRect();
        if (rect.bottom >= vp - 1 && rect.top < vp) {
          offset += rect.height;
        }
      }
    });
    const footer = document.querySelector('footer');
    if (footer) {
      const r = footer.getBoundingClientRect();
      if (r.top < vp) {
        const overlap = vp - r.top;
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
