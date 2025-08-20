(function () {
  console.info("[NP-FOOTER] boot");
  if (window.__npFooterLoaded) return;
  window.__npFooterLoaded = true;

  const isAdmin =
    location.pathname.includes("/admin.html") ||
    document.querySelector(".admin-container");
  if (isAdmin) {
    console.info("[NP-FOOTER] skip admin");
    return;
  }

  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn)
      : fn();

  ready(async () => {
    try {
      // Obtener template
      let tpl = document.getElementById("np-footer-template");
      if (!tpl) {
        try {
          const r = await fetch("/components/np-footer.html", {
            cache: "no-store",
          });
          const div = document.createElement("div");
          div.innerHTML = await r.text();
          tpl = div.querySelector("#np-footer-template");
          if (tpl) document.body.appendChild(tpl);
          console.info("[NP-FOOTER] template loaded");
        } catch (e) {
          console.warn("[NP-FOOTER] template fetch failed", e);
        }
      } else {
        console.info("[NP-FOOTER] template loaded");
      }

      // Crear footer desde template o fallback
      let footerEl;
      if (tpl?.content?.firstElementChild) {
        footerEl = tpl.content.firstElementChild.cloneNode(true);
      } else {
        footerEl = document.createElement("footer");
        footerEl.className = "np-footer";
        footerEl.innerHTML =
          '<div class="np-footer__inner"><div class="np-footer__nav" hidden><div class="np-footer__columns"></div></div><div class="np-footer__legal np-footer__row"></div></div>';
      }

      // Configuración
      let cfg = {};
      try {
        const res = await fetch("/api/footer", { cache: "no-store" });
        cfg = await res.json();
      } catch (e) {
        console.warn("[NP-FOOTER] /api/footer failed", e);
      }

      const show = cfg.show || {};

      // CTA
      const cta = footerEl.querySelector(".np-footer__cta");
      if (cta && show.cta && cfg.cta?.enabled) {
        cta.hidden = false;
        const span = document.createElement("span");
        span.textContent = cfg.cta.text || "";
        const a = document.createElement("a");
        a.href = cfg.cta.href || "#";
        a.textContent = cfg.cta.buttonLabel || "";
        cta.append(span, a);
      }

      // Branding
      const branding = footerEl.querySelector(".np-footer__branding");
      if (branding && show.branding && cfg.brand) {
        branding.hidden = false;
        const strong = document.createElement("strong");
        strong.textContent = cfg.brand;
        branding.appendChild(strong);
        if (cfg.slogan) {
          const p = document.createElement("p");
          p.textContent = cfg.slogan;
          branding.appendChild(p);
        }
      }

      // Columns
      const nav = footerEl.querySelector(".np-footer__nav");
      const colWrap = footerEl.querySelector(".np-footer__columns");
      if (nav && colWrap && show.columns && Array.isArray(cfg.columns)) {
        if (cfg.columns.length) nav.hidden = false;
        cfg.columns.forEach((col) => {
          const d = document.createElement("div");
          const h = document.createElement("h3");
          h.textContent = col.title || "";
          const ul = document.createElement("ul");
          (col.links || []).forEach((l) => {
            const li = document.createElement("li");
            const a = document.createElement("a");
            a.textContent = l.label || "";
            a.href = l.href || "#";
            a.rel = "noopener";
            li.appendChild(a);
            ul.appendChild(li);
          });
          d.appendChild(h);
          d.appendChild(ul);
          colWrap.appendChild(d);
        });
      }

      // Contact
      const contact = footerEl.querySelector(".np-footer__contact");
      if (contact && show.contact && cfg.contact) {
        contact.hidden = false;
        const { whatsapp, email, address } = cfg.contact;
        if (whatsapp) {
          const p = document.createElement("p");
          const a = document.createElement("a");
          a.href = `https://wa.me/${whatsapp.replace(/[^\d]/g, "")}`;
          a.textContent = whatsapp;
          p.append("WhatsApp: ", a);
          contact.appendChild(p);
        }
        if (email) {
          const p = document.createElement("p");
          const a = document.createElement("a");
          a.href = `mailto:${email}`;
          a.textContent = email;
          p.append("Email: ", a);
          contact.appendChild(p);
        }
        if (address) {
          const p = document.createElement("p");
          p.textContent = address;
          contact.appendChild(p);
        }
      }

      // Social
      const social = footerEl.querySelector(".np-footer__social");
      if (social && show.social && cfg.social) {
        const icons = {
          instagram:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M7 2C4.243 2 2 4.243 2 7v10c0 2.757 2.243 5 5 5h10c2.757 0 5-2.243 5-5V7c0-2.757-2.243-5-5-5H7zm10 2c1.654 0 3 1.346 3 3v10c0 1.654-1.346 3-3 3H7c-1.654 0-3-1.346-3-3V7c0-1.654 1.346-3 3-3h10zm-5 3a5 5 0 100 10 5 5 0 000-10zm0 2a3 3 0 110 6 3 3 0 010-6zm4.5-.75a1.25 1.25 0 11-.001 2.501 1.25 1.25 0 01.001-2.501z"/></svg>',
          linkedin:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.88 3.88 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1 4.98 2.12 4.98 3.5zM.5 8h4V23h-4V8zm7.5 0h3.8v2.1h.05c.53-1 1.83-2.1 3.77-2.1 4.03 0 4.77 2.65 4.77 6.1V23h-4v-7.5c0-1.8-.03-4.1-2.5-4.1-2.5 0-2.88 1.95-2.88 4v7.6h-4V8z"/></svg>',
          youtube:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a2.995 2.995 0 00-2.107-2.122C19.511 3.5 12 3.5 12 3.5s-7.511 0-9.391.564a2.995 2.995 0 00-2.107 2.122A31.533 31.533 0 000 12a31.533 31.533 0 00.502 5.814 2.995 2.995 0 002.107 2.122C4.489 18.5 12 18.5 12 18.5s7.511 0 9.391-.564a2.995 2.995 0 002.107-2.122A31.533 31.533 0 0024 12a31.533 31.533 0 00-.502-5.814zM9.75 15.02V8.98L15.5 12l-5.75 3.02z"/></svg>',
        };
        const map = {
          instagram: cfg.social.instagram,
          linkedin: cfg.social.linkedin,
          youtube: cfg.social.youtube,
        };
        Object.entries(map).forEach(([k, url]) => {
          if (!url) return;
          if (social.hidden) social.hidden = false;
          const a = document.createElement("a");
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener";
          a.innerHTML = icons[k] + `<span class="sr-only">${k}</span>`;
          social.appendChild(a);
        });
      }

      // Legal
      const legal = footerEl.querySelector(".np-footer__legal");
      if (legal && show.legal && cfg.legal) {
        legal.hidden = false;
        const y = new Date().getFullYear();
        const brand = cfg.brand || "NERIN PARTS";
        legal.innerHTML =
          `© ${y} ${brand}` +
          (cfg.legal.cuit ? ` – CUIT ${cfg.legal.cuit}` : "") +
          (cfg.legal.iibb ? ` – IIBB ${cfg.legal.iibb}` : "") +
          (cfg.legal.terms
            ? ` – <a href="${cfg.legal.terms}">Términos</a>`
            : "") +
          (cfg.legal.privacy
            ? ` – <a href="${cfg.legal.privacy}">Privacidad</a>`
            : "");
      }

      // Tema
      if (cfg.theme?.accentBar !== false && cfg.theme?.accentFrom && cfg.theme?.accentTo) {
        footerEl.removeAttribute("data-accent");
        footerEl.style.setProperty("--np-accent-from", cfg.theme.accentFrom);
        footerEl.style.setProperty("--np-accent-to", cfg.theme.accentTo);
      }
      if (cfg.theme?.mode === "dark") {
        footerEl.setAttribute("data-theme", "dark");
      }

      // Montaje
      if (document.querySelector(".np-footer")) return;
      const mount = document.getElementById("footer-root");
      if (mount) mount.appendChild(footerEl);
      else document.body.appendChild(footerEl);
      console.info("[NP-FOOTER] mounted");
    } catch (e) {
      console.error("[NP-FOOTER] fatal", e);
    }
  });
})();

