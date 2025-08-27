const form = document.getElementById('footerForm');
const linksFields = document.getElementById('linksFields');
const socialFields = document.getElementById('socialFields');
const addLinkBtn = document.getElementById('addLink');
const addSocialBtn = document.getElementById('addSocial');

function createRow(container, data = { label: '', href: '' }) {
  const div = document.createElement('div');
  div.style.display = 'flex';
  div.style.gap = '4px';
  div.innerHTML = `<input type="text" placeholder="Label" value="${data.label || ''}" />` +
    `<input type="text" placeholder="URL" value="${data.href || ''}" />` +
    `<button type="button">×</button>`;
  div.querySelector('button').onclick = () => div.remove();
  container.appendChild(div);
}

addLinkBtn.addEventListener('click', () => createRow(linksFields));
addSocialBtn.addEventListener('click', () => createRow(socialFields));

function collect(container) {
  return Array.from(container.querySelectorAll('div')).map((row) => {
    const [label, href] = row.querySelectorAll('input');
    return { label: label.value.trim(), href: href.value.trim() };
  }).filter((r) => r.label && r.href);
}

async function load() {
  try {
    const res = await fetch('/api/footer');
    const data = await res.json();
    data.links?.forEach((l) => createRow(linksFields, l));
    data.social?.forEach((s) => createRow(socialFields, s));
    form.phone.value = data.contact?.phone || '';
    form.email.value = data.contact?.email || '';
    form.location.value = data.contact?.location || '';
    form.legal.value = data.legal || '';
  } catch {}
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    links: collect(linksFields),
    social: collect(socialFields),
    legal: form.legal.value.trim(),
    contact: {
      phone: form.phone.value.trim(),
      email: form.email.value.trim(),
      location: form.location.value.trim(),
    },
  };
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('nerinToken');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const adminKey = localStorage.getItem('nerinAdminKey');
  if (adminKey) headers['x-admin-key'] = adminKey;
  const res = await fetch('/api/admin/footer', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    alert('Footer guardado');
    window.NPFooter?.loadFooter();
  } else {
    alert('Error al guardar');
  }
});

load();
