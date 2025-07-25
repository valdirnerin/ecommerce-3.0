// Manejo del formulario de contacto en la página principal

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = encodeURIComponent(document.getElementById('contactName').value.trim());
    const phone = encodeURIComponent(document.getElementById('contactPhone').value.trim());
    const model = encodeURIComponent(document.getElementById('contactModel').value.trim());
    const type = encodeURIComponent(document.getElementById('contactType').value);
    const phoneCfg = window.NERIN_CONFIG && window.NERIN_CONFIG.whatsappNumber;
    const waPhone = phoneCfg ? phoneCfg.replace(/[^0-9]/g, '') : '541112345678';
    const message =
      `Hola, mi nombre es ${name}. Busco ${model}. Soy ${type}. Contacto: ${phone}`;
    const url = `https://api.whatsapp.com/send?phone=${waPhone}&text=${message}`;
    window.open(url, '_blank');
  });
});
