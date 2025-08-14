// NERIN footer injection
const FOOTER_INFO = {
  phone: '+5491122334455',
  email: 'ventas@nerinparts.com.ar',
  whatsapp: 'https://wa.me/5491122334455',
  instagram: 'https://instagram.com/nerin',
  address: 'Calle Falsa 123, Buenos Aires, Argentina'
};
const ICONS = {
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15 15 0 006.6 6.6l2.2-2.2c.2-.2.5-.3.8-.2 1 .3 2 .4 3 .4a.8.8 0 01.8.8V21a.8.8 0 01-.8.8A17.8 17.8 0 012 3.8.8.8 0 012.8 3H6c.4 0 .7.3.8.7 0 1 .1 2 .4 3 .1.3 0 .6-.2.8l-2.4 2.3z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2 4h20v16H2z"/><path fill="currentColor" d="M22 4L12 11 2 4"/></svg>',
  wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1a11 11 0 00-9.5 16.3L2 22l4.8-1.3A11 11 0 1012 1zm5.3 15.5c-.2.4-.7.9-1.1 1-1 .2-2.6-.1-4.6-1.4a8.3 8.3 0 01-3-3c-1.4-2-1.6-3.6-1.4-4.6.1-.4.6-.9 1-1l1.2-.1.6 1.1c.2.5.2.7-.1 1.1l-.4.6c-.2.3-.2.5 0 .9a5.8 5.8 0 002.9 2.9c.4.2.6.2.9 0l.6-.4c.4-.3.6-.3 1.1-.1l1.1.6.1 1.2z"/></svg>',
  ig: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h10a5 5 0 015 5v10a5 5 0 01-5 5H7a5 5 0 01-5-5V7a5 5 0 015-5zm10 2H7a3 3 0 00-3 3v10a3 3 0 003 3h10a3 3 0 003-3V7a3 3 0 00-3-3zm-5 3.5A5.5 5.5 0 1111.5 17 5.5 5.5 0 0112 7.5zm0 9A3.5 3.5 0 1015.5 13 3.5 3.5 0 0012 16.5zm4.8-9.9a1.3 1.3 0 11-1.3 1.3 1.3 1.3 0 011.3-1.3z"/></svg>'
};
const root=document.getElementById('footer-root');
if(root){
  const year=new Date().getFullYear();
  root.innerHTML=`<footer class="site-footer"><div class="footer-inner">
    <div class="footer-brand"><span class="footer-logo">NERIN</span><p class="tagline">Repuestos originales Samsung • Envíos a todo el país</p></div>
    <nav class="footer-nav" aria-label="Ayuda"><h3>Ayuda</h3><ul>
      <li><a href="/shop.html">Productos</a></li>
      <li><a href="/contact.html">Contacto</a></li>
      <li><a href="/seguimiento.html">Seguir mi pedido</a></li>
      <li><a href="/cart.html">Carrito</a></li>
    </ul></nav>
    <nav class="footer-nav" aria-label="Soporte"><h3>Soporte</h3><ul>
      <li><a href="#">Envíos y costos</a></li>
      <li><a href="#">Devoluciones/RMA</a></li>
      <li><a href="#">Términos y condiciones</a></li>
      <li><a href="#">Privacidad</a></li>
    </ul></nav>
    <div class="footer-contact"><h3>Contacto</h3><ul>
      <li><a href="tel:${FOOTER_INFO.phone}">${ICONS.phone}<span>${FOOTER_INFO.phone}</span></a></li>
      <li><a href="mailto:${FOOTER_INFO.email}">${ICONS.mail}<span>${FOOTER_INFO.email}</span></a></li>
      <li><a href="${FOOTER_INFO.whatsapp}" target="_blank" rel="noopener">${ICONS.wa}<span>WhatsApp</span></a></li>
      <li><a href="${FOOTER_INFO.instagram}" target="_blank" rel="noopener">${ICONS.ig}<span>Instagram</span></a></li>
    </ul><address>${FOOTER_INFO.address}</address></div>
  </div><div class="footer-bottom"><p>© ${year} NERIN — Todos los derechos reservados.</p></div></footer>`;
  const ld={"@context":"https://schema.org","@type":"Organization","name":"NERIN","url":"https://nerinparts.com.ar","sameAs":[FOOTER_INFO.instagram,FOOTER_INFO.whatsapp],"address":{"@type":"PostalAddress","streetAddress":FOOTER_INFO.address,"addressCountry":"AR"}};
  const s=document.createElement('script');s.type='application/ld+json';s.textContent=JSON.stringify(ld);document.head.appendChild(s);
}
