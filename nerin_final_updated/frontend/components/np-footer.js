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
      const frag = tpl.content.cloneNode(true);
      document.body.appendChild(frag);

      const cta = document.getElementById("np-wholesale-cta");
      const adjust = () => {
        if (!cta) return;
        document.body.style.paddingBottom = `calc(${cta.offsetHeight + 32}px + env(safe-area-inset-bottom, 0px))`;
      };
      adjust();
      window.addEventListener("resize", adjust);

      const wa = document.querySelector(".np-whatsapp");
      if (wa && window.NP_WHATSAPP_URL) wa.href = window.NP_WHATSAPP_URL;
      const checkWa = () => {
        const hide =
          window.innerWidth < 360 || document.querySelector(".hide-whatsapp");
        if (wa) wa.style.display = hide ? "none" : "flex";
      };
      checkWa();
      window.addEventListener("resize", checkWa);

      const ld = {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "NERIN PARTS",
        url: "https://nerinparts.com.ar",
        email: "ventas@nerinparts.com.ar",
        telephone: "+54 9 11 0000-0000",
        address: {
          "@type": "PostalAddress",
          addressLocality: "CABA",
          addressCountry: "AR",
        },
        sameAs: [
          "https://instagram.com/nerinparts",
          "https://linkedin.com/company/nerinparts",
        ],
      };
      const s = document.createElement("script");
      s.type = "application/ld+json";
      s.textContent = JSON.stringify(ld);
      document.head.appendChild(s);
    } catch (e) {
      console.error("[np-footer]", e);
    }
  });
})();
