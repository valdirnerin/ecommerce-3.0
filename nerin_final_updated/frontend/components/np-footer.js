// Mount NERIN Parts footer
(async () => {
  const path = location.pathname;
  if (path.includes('/admin.html') || document.querySelector('.admin-container')) return;
  if (window.__npFooterLoaded) return;
  window.__npFooterLoaded = true;

  let tpl = document.getElementById('np-footer-template');
  if (!tpl) {
    try {
      const res = await fetch('/components/np-footer.html');
      const html = await res.text();
      const div = document.createElement('div');
      div.innerHTML = html;
      tpl = div.querySelector('#np-footer-template');
      document.body.appendChild(tpl);
    } catch (e) {
      console.warn('No se encontró template de footer');
      return;
    }
  }

  let cfg = {};
  try {
    const res = await fetch('/api/footer');
    cfg = await res.json();
  } catch (e) {
    console.warn('No se pudo cargar footer', e);
  }

  const footer = tpl.content.firstElementChild.cloneNode(true);
  const theme = cfg.theme || {};
  const luminance = (hex) => {
    if (!hex) return 1;
    const c = hex.replace('#', '');
    const full = c.length === 3 ? c.split('').map(ch => ch + ch).join('') : c;
    const num = parseInt(full, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  for (const [k, v] of Object.entries(theme)) {
    if (k === 'accentBar' || k === 'mode') continue;
    footer.style.setProperty(`--np-${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`, v);
    if (k === 'bg') footer.style.setProperty('--color-bg', v);
    if (k === 'fg') footer.style.setProperty('--color-secondary', v);
    if (k === 'border') footer.style.setProperty('--color-border', v);
  }
  if (theme.accentBar === false) {
    footer.dataset.accent = 'off';
  }
  const mode = theme.mode || 'light';
  const dark = mode === 'dark' || (mode === 'auto' && luminance(theme.bg) < 0.35);
  if (dark) footer.dataset.theme = 'dark';

  const show = cfg.show || {};

  // CTA
  if (show.cta && cfg.cta && cfg.cta.enabled) {
    const cta = footer.querySelector('.np-footer__cta');
    cta.hidden = false;
    const span = document.createElement('span');
    span.textContent = cfg.cta.text || '';
    const btn = document.createElement('a');
    btn.textContent = cfg.cta.buttonLabel || '';
    btn.href = cfg.cta.href || '#';
    cta.append(span, btn);
  }

  // Branding
  if (show.branding) {
    const brand = footer.querySelector('.np-footer__branding');
    brand.hidden = false;
    const logo = document.createElement('div');
    logo.className = 'np-footer__logo';
    logo.setAttribute('aria-hidden', 'true');
    const textWrap = document.createElement('div');
    textWrap.className = 'np-footer__brand-text';
    const brandSpan = document.createElement('span');
    brandSpan.className = 'np-footer__brand';
    brandSpan.textContent = cfg.brand || '';
    const sloganSpan = document.createElement('span');
    sloganSpan.className = 'np-footer__slogan';
    sloganSpan.textContent = cfg.slogan || '';
    textWrap.append(brandSpan, sloganSpan);
    brand.append(logo, textWrap);
  }

  // Columns navigation
  if (show.columns && Array.isArray(cfg.columns)) {
    const nav = footer.querySelector('.np-footer__nav');
    const cols = nav.querySelector('.np-footer__columns');
    cfg.columns.forEach(col => {
      const div = document.createElement('div');
      const h3 = document.createElement('h3');
      h3.textContent = col.title;
      div.appendChild(h3);
      const ul = document.createElement('ul');
      (col.links || []).forEach(l => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.textContent = l.label;
        a.href = l.href;
        a.rel = 'noopener nofollow';
        li.appendChild(a);
        ul.appendChild(li);
      });
      div.appendChild(ul);
      cols.appendChild(div);
    });
    nav.hidden = false;
  }

  // Contact
  if (show.contact && cfg.contact) {
    const wrap = footer.querySelector('.np-footer__contact');
    if (cfg.contact.whatsapp) {
      const span = document.createElement('span');
      span.textContent = `WhatsApp: ${cfg.contact.whatsapp}`;
      wrap.appendChild(span);
    }
    if (cfg.contact.email) {
      const span = document.createElement('span');
      const a = document.createElement('a');
      a.href = `mailto:${cfg.contact.email}`;
      a.textContent = cfg.contact.email;
      span.append('Email: ', a);
      wrap.appendChild(span);
    }
    if (cfg.contact.address) {
      const span = document.createElement('span');
      span.textContent = cfg.contact.address;
      wrap.appendChild(span);
    }
    wrap.hidden = wrap.childNodes.length === 0;
  }

  // Social
  if (show.social && cfg.social) {
    const social = footer.querySelector('.np-footer__social');
    const addIcon = (href, label, path) => {
      if (!href) return;
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('aria-label', label);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '24');
      svg.setAttribute('height', '24');
      svg.innerHTML = path;
      a.appendChild(svg);
      social.appendChild(a);
    };
    addIcon(cfg.social.instagram, 'Instagram', '<path d="M7 2C4.243 2 2 4.243 2 7v10c0 2.757 2.243 5 5 5h10c2.757 0 5-2.243 5-5V7c0-2.757-2.243-5-5-5H7zm10 2a3 3 0 013 3v10a3 3 0 01-3 3H7a3 3 0 01-3-3V7a3 3 0 013-3h10zm-5 3a5 5 0 100 10 5 5 0 000-10zm6.5-.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>');
    addIcon(cfg.social.linkedin, 'LinkedIn', '<path d="M4 3a2 2 0 110 4 2 2 0 010-4zm0 5h4v13H4V8zm6 0h3.6v1.8h.1c.5-1 1.8-2 3.7-2 4 0 4.7 2.6 4.7 6v7.2h-4V14c0-1.4 0-3.2-2-3.2s-2.3 1.5-2.3 3.1v7.1h-4V8z"/>');
    addIcon(cfg.social.youtube, 'YouTube', '<path d="M10 15l5.19-3L10 9v6zm12-3c0-2-.2-3.3-.6-4.2-.3-.8-.9-1.5-1.7-1.7C17.9 5 12 5 12 5s-5.9 0-7.7.1c-.8.2-1.4.9-1.7 1.7C2.2 8.7 2 10 2 12s.2 3.3.6 4.2c.3.8.9 1.5 1.7 1.7C6.1 18.9 12 19 12 19s5.9 0 7.7-.1c.8-.2 1.4-.9 1.7-1.7.4-.9.6-2.2.6-4.2z"/>');
    social.hidden = social.childNodes.length === 0;
  }

  // Badges
  if (show.badges && cfg.badges) {
    const wrap = footer.querySelector('.np-footer__badges');
    const add = (enabled, label) => {
      if (!enabled) return;
      const span = document.createElement('span');
      span.textContent = label;
      wrap.appendChild(span);
    };
    add(cfg.badges.mercadoPago, 'Mercado Pago');
    add(cfg.badges.ssl, 'SSL');
    add(cfg.badges.andreani, 'Andreani');
    add(cfg.badges.oca, 'OCA');
    add(cfg.badges.dhl, 'DHL');
    add(cfg.badges.authenticity, 'Autenticidad garantizada');
    wrap.hidden = wrap.childNodes.length === 0;
  }

  // Legal
  if (show.legal && cfg.legal) {
    const legal = footer.querySelector('.np-footer__legal');
    legal.hidden = false;
    const year = new Date().getFullYear();
    const parts = [`© ${year} ${cfg.brand || ''}`];
    if (cfg.legal.cuit) parts.push(`CUIT ${cfg.legal.cuit}`);
    if (cfg.legal.iibb) parts.push(`IIBB ${cfg.legal.iibb}`);
    if (cfg.legal.terms) parts.push(`<a href="${cfg.legal.terms}">Términos</a>`);
    if (cfg.legal.privacy) parts.push(`<a href="${cfg.legal.privacy}">Privacidad</a>`);
    legal.innerHTML = parts.join(' – ');
  }

  // mount
  const mount = document.getElementById('footer-root');
  if (mount) {
    mount.appendChild(footer);
  } else {
    document.body.appendChild(footer);
  }
})();
