// Admin interface to edit footer configuration
const defaultConfig = {
  brand: "NERIN PARTS",
  slogan: "Samsung Service Pack Original",
  cta: {
    enabled: true,
    text: "¿Sos técnico o mayorista?",
    buttonLabel: "Acceso mayoristas",
    href: "/mayoristas",
  },
  columns: [],
  contact: { whatsapp: "", email: "", address: "" },
  social: { instagram: "", linkedin: "", youtube: "" },
  badges: { mercadoPago: true, ssl: true, andreani: true, oca: true, dhl: false, authenticity: true },
  newsletter: { enabled: false, placeholder: "", successMsg: "" },
  legal: { cuit: "", iibb: "", terms: "", privacy: "" },
  show: { cta: true, branding: true, columns: true, contact: true, social: true, badges: true, newsletter: false, legal: true },
  theme: {
    accentFrom: "#FFD54F",
    accentTo: "#FFC107",
    border: "rgba(0,0,0,.08)",
    bg: "#ffffff",
    fg: "#111827",
    muted: "#A9ABB2",
    dark: false,
    accentBar: true,
  },
};

const form = document.getElementById('footerForm');
const resetBtn = document.getElementById('footerReset');
const viewBtn = document.getElementById('footerView');

async function loadFooterConfig() {
  try {
    const res = await fetch('/api/footer');
    const data = await res.json();
    fillForm({ ...defaultConfig, ...data });
  } catch (e) {
    fillForm(defaultConfig);
  }
}

function fillForm(cfg) {
  form.brand.value = cfg.brand;
  form.slogan.value = cfg.slogan;
  form.ctaEnabled.checked = cfg.cta.enabled;
  form.ctaText.value = cfg.cta.text;
  form.ctaLabel.value = cfg.cta.buttonLabel;
  form.ctaHref.value = cfg.cta.href;
  form.whatsapp.value = cfg.contact.whatsapp;
  form.email.value = cfg.contact.email;
  form.address.value = cfg.contact.address;
  form.instagram.value = cfg.social.instagram;
  form.linkedin.value = cfg.social.linkedin;
  form.youtube.value = cfg.social.youtube;
  form.cuit.value = cfg.legal.cuit;
  form.iibb.value = cfg.legal.iibb;
  form.terms.value = cfg.legal.terms;
  form.privacy.value = cfg.legal.privacy;
  form.accentFrom.value = cfg.theme.accentFrom;
  form.accentTo.value = cfg.theme.accentTo;
  form.bg.value = cfg.theme.bg;
  form.fg.value = cfg.theme.fg;
  form.themeDark.checked = cfg.theme.dark;
  form.accentBar.checked = cfg.theme.accentBar !== false;
  form.newsEnabled.checked = cfg.newsletter.enabled;
  form.newsPlaceholder.value = cfg.newsletter.placeholder;
  form.newsSuccess.value = cfg.newsletter.successMsg;
  // toggles
  for (const k in cfg.show) {
    if (form[`show_${k}`]) form[`show_${k}`].checked = cfg.show[k];
  }
  for (const k in cfg.badges) {
    if (form[`badge_${k}`]) form[`badge_${k}`].checked = cfg.badges[k];
  }
  form.columns.value = JSON.stringify(cfg.columns, null, 2);
}

function collectForm() {
  const cfg = { ...defaultConfig };
  cfg.brand = form.brand.value.trim();
  cfg.slogan = form.slogan.value.trim();
  cfg.cta = {
    enabled: form.ctaEnabled.checked,
    text: form.ctaText.value.trim(),
    buttonLabel: form.ctaLabel.value.trim(),
    href: form.ctaHref.value.trim(),
  };
  try {
    cfg.columns = JSON.parse(form.columns.value || '[]');
  } catch {
    cfg.columns = [];
  }
  cfg.contact = {
    whatsapp: form.whatsapp.value.trim(),
    email: form.email.value.trim(),
    address: form.address.value.trim(),
  };
  const sanitizeUrl = (url) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') return url;
    } catch {}
    return '';
  };
  cfg.social = {
    instagram: sanitizeUrl(form.instagram.value.trim()),
    linkedin: sanitizeUrl(form.linkedin.value.trim()),
    youtube: sanitizeUrl(form.youtube.value.trim()),
  };
  cfg.legal = {
    cuit: form.cuit.value.trim(),
    iibb: form.iibb.value.trim(),
    terms: form.terms.value.trim(),
    privacy: form.privacy.value.trim(),
  };
  cfg.theme = {
    accentFrom: form.accentFrom.value,
    accentTo: form.accentTo.value,
    border: defaultConfig.theme.border,
    bg: form.bg.value,
    fg: form.fg.value,
    muted: defaultConfig.theme.muted,
    dark: form.themeDark.checked,
    accentBar: form.accentBar.checked,
  };
  cfg.newsletter = {
    enabled: form.newsEnabled.checked,
    placeholder: form.newsPlaceholder.value.trim(),
    successMsg: form.newsSuccess.value.trim(),
  };
  cfg.show = {};
  for (const k in defaultConfig.show) {
    cfg.show[k] = form[`show_${k}`].checked;
  }
  cfg.badges = {};
  for (const k in defaultConfig.badges) {
    cfg.badges[k] = form[`badge_${k}`].checked;
  }
  return cfg;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cfg = collectForm();
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('nerinToken');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const adminKey = localStorage.getItem('nerinAdminKey');
  if (adminKey) headers['x-admin-key'] = adminKey;
  const res = await fetch('/api/footer', {
    method: 'POST',
    headers,
    body: JSON.stringify(cfg),
  });
  if (res.ok) {
    alert('Footer guardado');
  } else {
    alert('Error al guardar footer');
  }
});

resetBtn.addEventListener('click', async () => {
  const headers = { 'Content-Type': 'application/json' };
  const adminKey = localStorage.getItem('nerinAdminKey');
  if (adminKey) headers['x-admin-key'] = adminKey;
  await fetch('/api/footer', { method: 'POST', headers, body: JSON.stringify(defaultConfig) });
  fillForm(defaultConfig);
  alert('Restaurado');
});

viewBtn.addEventListener('click', () => {
  window.open('/index.html', '_blank');
});

loadFooterConfig();
