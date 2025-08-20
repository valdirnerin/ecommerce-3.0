// Render and mount NERIN PARTS footer
(async () => {
  if (window.__npFooterLoaded) return;
  window.__npFooterLoaded = true;

  let tpl = document.getElementById('np-footer-template');
  if (!tpl) {
    try {
      const tplRes = await fetch('/components/np-footer.html');
      const html = await tplRes.text();
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

  // Apply theme variables
  const theme = cfg.theme || {};
  for (const [k, v] of Object.entries(theme)) {
    footer.style.setProperty(`--np-${k.replace(/([A-Z])/g,'-$1').toLowerCase()}`, v);
  }

  const show = cfg.show || {};

  // CTA strip
  if (show.cta && cfg.cta && cfg.cta.enabled) {
    const cta = footer.querySelector('.np-footer-cta');
    cta.hidden = false;
    cta.querySelector('.np-footer-cta-text').textContent = cfg.cta.text || '';
    const btn = cta.querySelector('.np-footer-cta-btn');
    btn.textContent = cfg.cta.buttonLabel || '';
    btn.href = cfg.cta.href || '#';
  }

  // Branding
  if (show.branding) {
    const brand = footer.querySelector('.np-footer-branding');
    brand.hidden = false;
    brand.querySelector('.np-footer-brand').textContent = cfg.brand || '';
    brand.querySelector('.np-footer-slogan').textContent = cfg.slogan || '';
  }

  // Columns navigation
  if (show.columns && Array.isArray(cfg.columns)) {
    const nav = footer.querySelector('.np-footer-nav');
    const cols = nav.querySelector('.np-footer-columns');
    cfg.columns.forEach(col => {
      const div = document.createElement('div');
      const h3 = document.createElement('h3');
      h3.textContent = col.title;
      div.appendChild(h3);
      const ul = document.createElement('ul');
      (col.links || []).forEach(l => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'np-footer-link';
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
    const wrap = footer.querySelector('.np-footer-contact');
    const parts = [];
    if (cfg.contact.whatsapp) {
      parts.push(`WhatsApp: ${cfg.contact.whatsapp}`);
    }
    if (cfg.contact.email) {
      const a = document.createElement('a');
      a.className = 'np-footer-link';
      a.href = `mailto:${cfg.contact.email}`;
      a.textContent = cfg.contact.email;
      wrap.append('Email: ', a, ' ');
    }
    if (cfg.contact.address) {
      const span = document.createElement('span');
      span.textContent = cfg.contact.address;
      wrap.appendChild(span);
    }
    wrap.hidden = false;
  }

  // Social
  if (show.social && cfg.social) {
    const social = footer.querySelector('.np-footer-social');
    const addIcon = (href, label, path) => {
      if (!href) return;
      const a = document.createElement('a');
      a.className = 'np-footer-link';
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('aria-label', label);
      const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 24 24');
      svg.innerHTML = path;
      a.appendChild(svg);
      social.appendChild(a);
    };
    addIcon(cfg.social.instagram, 'Instagram', '<path d="M7 2C4.243 2 2 4.243 2 7v10c0 2.757 2.243 5 5 5h10c2.757 0 5-2.243 5-5V7c0-2.757-2.243-5-5-5H7zm10 2a3 3 0 013 3v10a3 3 0 01-3 3H7a3 3 0 01-3-3V7a3 3 0 013-3h10zm-5 3a5 5 0 100 10 5 5 0 000-10zm6.5-.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>');
    addIcon(cfg.social.linkedin, 'LinkedIn', '<path d="M4 3a2 2 0 110 4 2 2 0 010-4zm0 5h4v13H4V8zm6 0h3.6v1.8h.1c.5-1 1.8-2 3.7-2 4 0 4.7 2.6 4.7 6v7.2h-4V14c0-1.4 0-3.2-2-3.2s-2.3 1.5-2.3 3.1v7.1h-4V8z"/>');
    addIcon(cfg.social.youtube, 'YouTube', '<path d="M10 15l5.19-3L10 9v6zm12-3c0-2-.2-3.3-.6-4.2-.3-.8-.9-1.5-1.7-1.7C17.9 5 12 5 12 5s-5.9 0-7.7.1c-.8.2-1.4.9-1.7 1.7C2.2 8.7 2 10 2 12s.2 3.3.6 4.2c.3.8.9 1.5 1.7 1.7C6.1 18.9 12 19 12 19s5.9 0 7.7-.1c.8-.2 1.4-.9 1.7-1.7.4-.9.6-2.2.6-4.2z"/>');
    social.hidden = social.childNodes.length === 0;
  }

  // Badges simple icons
  if (show.badges && cfg.badges) {
    const wrap = footer.querySelector('.np-footer-badges');
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

  // Newsletter
  if (show.newsletter && cfg.newsletter && cfg.newsletter.enabled) {
    const wrap = footer.querySelector('.np-footer-newsletter');
    wrap.hidden = false;
    const input = wrap.querySelector('.np-footer-news-input');
    input.placeholder = cfg.newsletter.placeholder || '';
    const success = wrap.querySelector('.np-footer-news-success');
    wrap.querySelector('.np-footer-news-form').addEventListener('submit', (e) => {
      e.preventDefault();
      success.textContent = cfg.newsletter.successMsg || '';
      success.hidden = false;
      e.target.reset();
    });
  }

  // Legal line
  if (show.legal && cfg.legal) {
    const legal = footer.querySelector('.np-footer-legal');
    legal.hidden = false;
    const year = new Date().getFullYear();
    const span = document.createElement('span');
    span.textContent = `© ${year} ${cfg.brand || ''} - CUIT ${cfg.legal.cuit} - IIBB ${cfg.legal.iibb}`;
    legal.appendChild(span);
    if (cfg.legal.terms) {
      const a = document.createElement('a');
      a.className = 'np-footer-link';
      a.href = cfg.legal.terms;
      a.textContent = 'Términos';
      legal.append(' - ', a);
    }
    if (cfg.legal.privacy) {
      const a = document.createElement('a');
      a.className = 'np-footer-link';
      a.href = cfg.legal.privacy;
      a.textContent = 'Privacidad';
      legal.append(' - ', a);
    }
  }

  // insert footer into DOM
  let mount = document.getElementById('footer-root');
  if (mount) {
    mount.appendChild(footer);
  } else {
    document.body.appendChild(footer);
  }
})();
