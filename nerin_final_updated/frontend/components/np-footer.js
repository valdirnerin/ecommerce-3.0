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
      const version = "np-r1";
      let tpl = document.getElementById("np-footer-template");
      if (!tpl) {
        try {
          const r = await fetch(`/components/np-footer.html?v=${version}`, {
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

      let footerEl;
      if (tpl?.content?.firstElementChild) {
        footerEl = tpl.content.firstElementChild.cloneNode(true);
      } else {
        footerEl = document.createElement("footer");
        footerEl.className = "np-footer";
        footerEl.setAttribute("role", "contentinfo");
        footerEl.setAttribute("data-accent", "on");
        const accent = document.createElement("div");
        accent.className = "np-footer__accent";
        accent.setAttribute("aria-hidden", "true");
        const inner = document.createElement("div");
        inner.className = "np-footer__inner";
        const branding = document.createElement("div");
        branding.className = "np-footer__branding";
        branding.hidden = true;
        const nav = document.createElement("nav");
        nav.className = "np-footer__nav";
        nav.hidden = true;
        const cols = document.createElement("div");
        cols.className = "np-footer__columns";
        nav.appendChild(cols);
        const legal = document.createElement("div");
        legal.className = "np-footer__legal";
        legal.hidden = true;
        inner.append(branding, nav, legal);
        footerEl.append(accent, inner);
      }

      const defaults = {
        brand: "NERIN PARTS",
        slogan: "Samsung Service Pack Original",
        cta: {
          enabled: true,
          text: "¿Sos técnico o mayorista?",
          buttonLabel: "Acceso mayoristas",
          href: "/mayoristas",
        },
        columns: [
          {
            title: "Catálogo",
            links: [
              {
                label: "Pantallas Service Pack",
                href: "/shop.html?cat=pantallas",
              },
              { label: "Baterías", href: "/shop.html?cat=baterias" },
              { label: "Módulos / Flex", href: "/shop.html?cat=modulos-flex" },
            ],
          },
          {
            title: "Información",
            links: [
              { label: "Verificar originalidad", href: "/info/originalidad" },
              { label: "Garantía y devoluciones", href: "/info/garantia" },
              { label: "Envíos", href: "/info/envios" },
            ],
          },
          {
            title: "Cuenta",
            links: [
              { label: "Mi cuenta", href: "/account.html" },
              { label: "Mayoristas", href: "/mayoristas" },
              { label: "Soporte técnico", href: "/soporte" },
            ],
          },
        ],
        contact: {
          whatsapp: "+54 9 11 1111-1111",
          email: "info@nerinparts.com",
          address: "CABA, Argentina",
        },
        social: {
          instagram: "https://instagram.com/nerinparts",
          linkedin: "https://linkedin.com/company/nerinparts",
        },
        badges: ["mercadopago", "ssl", "andreani", "oca", "auth"],
        legal: {
          cuit: "30-00000000-0",
          iibb: "CM 000000",
          terms: "/terminos.html",
          privacy: "/privacidad.html",
        },
        show: {
          cta: true,
          branding: true,
          columns: true,
          contact: true,
          social: true,
          badges: true,
          legal: true,
        },
        theme: {
          accentFrom: "#60a5fa",
          accentTo: "#2563eb",
          accentBar: true,
        },
      };

      const merge = (base, incoming) => {
        const out = { ...base };
        for (const k in incoming || {}) {
          if (
            incoming[k] &&
            typeof incoming[k] === "object" &&
            !Array.isArray(incoming[k])
          ) {
            out[k] = merge(base[k] || {}, incoming[k]);
          } else if (incoming[k] !== undefined) {
            out[k] = incoming[k];
          }
        }
        return out;
      };

      let remote = {};
      try {
        const base =
          (window.NERIN_CONFIG && window.NERIN_CONFIG.apiBase) ||
          window.API_BASE_URL ||
          "";
        const res = await fetch(`${base}/api/footer`, { cache: "no-store" });
        remote = await res.json();
      } catch (e) {
        console.warn("[NP-FOOTER] /api/footer failed", e);
      }
      const cfg = merge(defaults, remote);
      const show = cfg.show || {};

      // CTA
      const cta = footerEl.querySelector(".np-footer__cta");
      if (cta && show.cta && cfg.cta?.enabled) {
        cta.hidden = false;
        const textEl = cta.querySelector(".np-footer__cta-text");
        const btn = cta.querySelector(".np-footer__cta-btn");
        if (textEl) textEl.textContent = cfg.cta.text || "";
        if (btn) {
          btn.textContent = cfg.cta.buttonLabel || "";
          btn.href = cfg.cta.href || "#";
        }
      }

      // Branding
      const branding = footerEl.querySelector(".np-footer__branding");
      if (branding && show.branding) {
        branding.hidden = false;
        const brandEl = branding.querySelector(".np-footer__brand");
        const sloganEl = branding.querySelector(".np-footer__slogan");
        if (brandEl) brandEl.textContent = cfg.brand || "NERIN PARTS";
        if (sloganEl)
          sloganEl.textContent = cfg.slogan || "Samsung Service Pack Original";
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
          d.append(h, ul);
          colWrap.appendChild(d);
        });
      }

      // Contact
      const contact = footerEl.querySelector(".np-footer__contact");
      if (contact && show.contact && cfg.contact) {
        contact.hidden = false;
        const icons = {
          whatsapp:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.86 19.86 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.86 19.86 0 012.08 4.18 2 2 0 014.06 2h3a2 2 0 012 1.72c.12.81.37 1.6.72 2.34a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.74-1.24a2 2 0 012.11-.45c.74.35 1.53.6 2.34.72a2 2 0 011.72 2z"/></svg>',
          email:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3,7 12,13 21,7"/></svg>',
          address:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 5-9 13-9 13S3 15 3 10a9 9 0 1118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
        };
        const addItem = (iconKey, text, href) => {
          const p = document.createElement("p");
          p.className = "np-footer__contact-item";
          const icon = document.createElement("span");
          icon.className = "np-footer__contact-icon";
          icon.innerHTML = icons[iconKey];
          p.appendChild(icon);
          if (href) {
            const a = document.createElement("a");
            a.href = href;
            a.textContent = text;
            a.rel = "noopener";
            p.appendChild(a);
          } else {
            p.appendChild(document.createTextNode(text));
          }
          contact.appendChild(p);
        };
        const { whatsapp, email, address } = cfg.contact;
        if (whatsapp) {
          addItem(
            "whatsapp",
            whatsapp,
            `https://wa.me/${whatsapp.replace(/[^\d]/g, "")}`,
          );
        }
        if (email) {
          addItem("email", email, `mailto:${email}`);
        }
        if (address) {
          addItem("address", address);
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
        const entries = [
          ["instagram", cfg.social.instagram],
          ["linkedin", cfg.social.linkedin],
          ["youtube", cfg.social.youtube],
        ];
        entries.forEach(([key, url]) => {
          if (!url) return;
          if (social.hidden) social.hidden = false;
          const a = document.createElement("a");
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener";
          const label = key.charAt(0).toUpperCase() + key.slice(1);
          a.setAttribute("aria-label", label);
          a.innerHTML = icons[key];
          const span = document.createElement("span");
          span.textContent = label;
          a.appendChild(span);
          social.appendChild(a);
        });
      }

      // Badges
      const badges = footerEl.querySelector(".np-footer__badges");
      if (badges && show.badges && Array.isArray(cfg.badges)) {
        const icons = {
          mercadopago:
            '<svg aria-label="Mercado Pago" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32" fill="currentColor"><rect width="64" height="32" rx="4" ry="4" fill="#f3f4f6"/><path d="M20 11c2-2 6-2 8 0 2-2 6-2 8 0" stroke="#2563eb" stroke-width="2" fill="none"/><path d="M20 11v5c2 2 6 2 8 0 2 2 6 2 8 0v-5" stroke="#2563eb" stroke-width="2" fill="none"/></svg>',
          ssl: '<svg aria-label="SSL" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor"><rect x="2" y="12" width="28" height="18" rx="2" fill="#f3f4f6"/><path d="M10 12V9a6 6 0 1112 0v3" stroke="#2563eb" stroke-width="2" fill="none"/><circle cx="16" cy="21" r="4" stroke="#2563eb" stroke-width="2" fill="none"/><path d="M16 19v4" stroke="#2563eb" stroke-width="2"/></svg>',
          andreani:
            '<svg aria-label="Andreani" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 32" fill="currentColor"><rect width="40" height="32" rx="4" fill="#f3f4f6"/><path d="M20 6l9 20h-4l-1.8-4h-6.4l-1.8 4h-4l9-20zm0 7.5l-2.2 5h4.4L20 13.5z" fill="#2563eb"/></svg>',
          oca: '<svg aria-label="OCA" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32" fill="currentColor"><rect width="48" height="32" rx="4" fill="#f3f4f6"/><path d="M14 10h8l-4 6 4 6h-8l-4-6 4-6zm12 0h8v4h-4v4h4v4h-8v-12zm14 0h8l-4 6 4 6h-8l-4-6 4-6z" fill="#2563eb"/></svg>',
          auth: '<svg aria-label="Autenticidad garantizada" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor"><path d="M16 2l12 6v8c0 7-5 13-12 14-7-1-12-7-12-14V8l12-6z" fill="#f3f4f6"/><path d="M12 16l3 3 5-5" stroke="#2563eb" stroke-width="2" fill="none"/></svg>',
        };
        cfg.badges.forEach((key) => {
          if (!icons[key]) return;
          if (badges.hidden) badges.hidden = false;
          const span = document.createElement("span");
          span.className = "np-footer__badge";
          span.innerHTML = icons[key];
          badges.appendChild(span);
        });
      }

      // Legal
      const legal = footerEl.querySelector(".np-footer__legal");
      if (legal && show.legal && cfg.legal) {
        legal.hidden = false;
        const y = new Date().getFullYear();
        const brand = cfg.brand || "NERIN PARTS";
        legal.appendChild(document.createTextNode(`© ${y} ${brand}`));
        if (cfg.legal.cuit) {
          legal.appendChild(
            document.createTextNode(` – CUIT ${cfg.legal.cuit}`),
          );
        }
        if (cfg.legal.iibb) {
          legal.appendChild(
            document.createTextNode(` – IIBB ${cfg.legal.iibb}`),
          );
        }
        if (cfg.legal.terms) {
          legal.appendChild(document.createTextNode(" – "));
          const terms = document.createElement("a");
          terms.href = cfg.legal.terms;
          terms.textContent = "Términos";
          terms.rel = "noopener";
          legal.appendChild(terms);
        }
        if (cfg.legal.privacy) {
          legal.appendChild(document.createTextNode(" – "));
          const priv = document.createElement("a");
          priv.href = cfg.legal.privacy;
          priv.textContent = "Privacidad";
          priv.rel = "noopener";
          legal.appendChild(priv);
        }
      }

      // Theme
      if (cfg.theme?.accentFrom && cfg.theme?.accentTo) {
        footerEl.style.setProperty("--np-accent-from", cfg.theme.accentFrom);
        footerEl.style.setProperty("--np-accent-to", cfg.theme.accentTo);
      }
      if (cfg.theme?.accentBar === false) {
        footerEl.setAttribute("data-accent", "off");
      }
      if (cfg.theme?.mode === "dark") {
        footerEl.setAttribute("data-theme", "dark");
      }

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
