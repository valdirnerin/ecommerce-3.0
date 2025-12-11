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
      const version = "np-r2";
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
          buttonLabel: "Ingresar a portal mayorista",
          href: "/account-minorista.html#mayoristas",
        },
        columns: [
          {
            title: "Catálogo",
            links: [
              { label: "Productos", href: "/shop.html" },
              { label: "Pantallas Samsung", href: "/shop.html?category=pantallas" },
              { label: "Baterías originales", href: "/shop.html?category=baterias" },
            ],
          },
          {
            title: "Ayuda",
            links: [
              { label: "Seguimiento de pedido", href: "/seguimiento.html" },
              { label: "Garantía y devoluciones", href: "/garantia.html" },
              { label: "Preguntas frecuentes", href: "/contact.html#faq" },
            ],
          },
          {
            title: "Cuenta",
            links: [
              { label: "Acceder", href: "/login.html" },
              { label: "Crear cuenta", href: "/register.html" },
              { label: "Soporte técnico", href: "/contact.html" },
            ],
          },
          {
            title: "Empresa",
            links: [
              { label: "Quiénes somos", href: "/index.html#quienes-somos" },
              { label: "Contacto comercial", href: "#contacto" },
              { label: "Términos y condiciones", href: "/pages/terminos.html" },
            ],
          },
        ],
        contact: {
          whatsapp: "+54 9 11 3034-1550",
          email: "ventas@nerinparts.com.ar",
          address: "CABA, Argentina",
        },
        social: {
          instagram: "https://www.instagram.com/nerinparts",
          linkedin: "https://www.linkedin.com/company/nerinparts",
          youtube: "",
        },
        badges: {
          mercadoPago: true,
          andreani: true,
          efectivo: true,
          transferencia: true,
        },
        newsletter: {
          enabled: false,
          placeholder: "Tu email para recibir novedades",
          successMsg: "¡Listo! Te sumamos a nuestra lista.",
        },
        legal: {
          cuit: "30-93002432-2",
          iibb: "IIBB CABA 901-117119-4",
          terms: "/pages/terminos.html",
          privacy: "/pages/terminos.html#datos",
        },
        show: {
          cta: true,
          branding: true,
          columns: true,
          contact: true,
          social: true,
          badges: true,
          newsletter: false,
          legal: true,
        },
        theme: {
          accentFrom: "#60a5fa",
          accentTo: "#2563eb",
          accentBar: true,
          bg: "#0b0b0c",
          fg: "#edeff5",
          muted: "#9ca3af",
          border: "rgba(255,255,255,0.08)",
          link: "#93c5fd",
          mode: "dark",
        },
      };

      const merge = (base, incoming) => {
        if (Array.isArray(base) || Array.isArray(incoming)) {
          return Array.isArray(incoming) ? incoming : Array.isArray(base) ? base : [];
        }
        const out = { ...base };
        for (const k in incoming || {}) {
          const value = incoming[k];
          if (value && typeof value === "object" && !Array.isArray(value)) {
            out[k] = merge(base?.[k] ?? {}, value);
          } else if (value !== undefined) {
            out[k] = value;
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
      if (nav && colWrap && show.columns) {
        const columns = Array.isArray(cfg.columns) ? cfg.columns : [];
        colWrap.innerHTML = "";
        const validColumns = columns.filter((col) => {
          const links = Array.isArray(col?.links) ? col.links : [];
          return (col?.title && col.title.trim()) || links.length;
        });
        nav.hidden = validColumns.length === 0;
        validColumns.forEach((col) => {
          const d = document.createElement("div");
          const h = document.createElement("h3");
          h.textContent = col.title || "";
          const ul = document.createElement("ul");
          (Array.isArray(col.links) ? col.links : []).forEach((l) => {
            if (!l || (!l.label && !l.href)) return;
            const li = document.createElement("li");
            const a = document.createElement("a");
            a.textContent = l.label || l.href || "";
            a.href = l.href || "#";
            if (/^https?:/i.test(a.href)) {
              a.target = "_blank";
              a.rel = "noopener noreferrer";
            } else {
              a.rel = "noopener";
            }
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
        const icons = {
          whatsapp:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16.5A9.3 9.3 0 1116.5 3a9.3 9.3 0 014.5 13.5L21 21l-4.5-1.5z"/><path d="M8.7 10.8c.3 1.6 1.9 3.2 3.5 3.5"/><path d="M8.8 11.2l.7-1.2a1 1 0 011.4-.3l1.1.7a1 1 0 01.4 1.3l-.4.9a.8.8 0 00.3 1l.2.1"/></svg>',
          email:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/></svg>',
          address:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5.5-8 12-8 12s-8-6.5-8-12a8 8 0 0116 0z"/><circle cx="12" cy="10" r="3"/></svg>',
        };
        const createLink = (text, href, ariaLabel) => {
          const a = document.createElement("a");
          a.href = href;
          a.textContent = text;
          a.rel = "noopener";
          if (ariaLabel) a.setAttribute("aria-label", ariaLabel);
          return a;
        };
        const addItem = (iconKey, builder) => {
          const row = document.createElement("div");
          row.className = "np-footer__contact-item";
          const icon = document.createElement("span");
          icon.className = "np-footer__contact-icon";
          icon.innerHTML = icons[iconKey];
          row.appendChild(icon);
          const content = builder();
          if (content) row.appendChild(content);
          contact.appendChild(row);
        };
        const { whatsapp, email, address } = cfg.contact;
        const sanitizedPhone = (whatsapp || "").replace(/[^\d]/g, "");
        if (whatsapp && sanitizedPhone.length >= 6) {
          contact.hidden = false;
          addItem("whatsapp", () =>
            createLink(
              whatsapp,
              `https://wa.me/${sanitizedPhone}`,
              "Chatear por WhatsApp",
            ),
          );
        }
        if (email) {
          contact.hidden = false;
          addItem("email", () => createLink(email, `mailto:${email}`));
        }
        if (address) {
          contact.hidden = false;
          addItem("address", () => document.createTextNode(address));
        }
      }

      // Newsletter
      const newsletter = footerEl.querySelector(".np-footer__newsletter");
      if (newsletter && show.newsletter && cfg.newsletter?.enabled) {
        newsletter.hidden = false;
        const form = newsletter.querySelector(".np-footer__newsletter-form");
        const input = newsletter.querySelector("input[type=email]");
        const feedback = newsletter.querySelector(
          ".np-footer__newsletter-feedback",
        );
        if (input && cfg.newsletter.placeholder) {
          input.placeholder = cfg.newsletter.placeholder;
        }
        const successMsg = cfg.newsletter.successMsg || "¡Gracias por suscribirte!";
        if (form) {
          if (input && feedback) {
            input.addEventListener("input", () => {
              feedback.hidden = true;
              feedback.textContent = "";
            });
          }
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!input) return;
            const value = String(input.value || "").trim();
            const isValid = /.+@.+\..+/.test(value);
            if (!isValid) {
              input.setCustomValidity("Ingresá un correo válido");
              input.reportValidity();
              return;
            }
            input.value = "";
            input.setCustomValidity("");
            if (feedback) {
              feedback.hidden = false;
              feedback.textContent = successMsg;
            }
          });
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
      if (badges && show.badges && cfg.badges) {
        const badgeIcons = {
          mercadoPago:
            '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="mpGrad" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#00A7E2"/><stop offset="1" stop-color="#0069A5"/></linearGradient></defs><rect x="3" y="6" width="42" height="36" rx="11" fill="#f5fbff" stroke="#b5e4fb" stroke-width="1.6"/><path d="M12.5 22.5c4.5-3.4 8.7-3.5 12.7-.4 4-3.2 8.2-3 12 .3" fill="none" stroke="#00a0de" stroke-width="2" stroke-linecap="round"/><path d="M17.6 21.5 22 26c.9 1 2.4 1 3.3 0l4.4-4.4" fill="none" stroke="#00a0de" stroke-width="2" stroke-linecap="round"/><path d="m15.4 21.8 3.8 2.9c1 .8 2.4.8 3.4 0l3.6-2.7" fill="none" stroke="#0069a5" stroke-width="1.4"/><path d="M21.8 24.6 19 27.7c-.8.9-2.2 1-3.1.2l-3.4-3.3m17.5 0 2.7 2.8a2.2 2.2 0 0 0 3.1 0l3.4-3.3" fill="#ffde9a" stroke="#0069a5" stroke-width="1.3" stroke-linejoin="round"/><path d="M17 20.9c.3-.7 1.6-2 2.9-2 1 0 2 .6 2.7 1.3.7-.6 1.6-1.2 2.6-1.2 1.4 0 2.6 1 3 1.9" fill="#00a7e2" stroke="#0069a5" stroke-width="1.1" stroke-linejoin="round"/></svg>',
          andreani:
            '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="andrGrad" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#F4472E"/><stop offset="1" stop-color="#C80000"/></linearGradient></defs><rect x="4" y="6" width="40" height="36" rx="12" fill="#fff3f1" stroke="#ffc9c2" stroke-width="1.4"/><path d="M24 9 11 36.5h7.6l2.6-5.6h6.7l2.5 5.6H38L26 9h-2Zm1.7 6.9 3.9 8.5h-8l4.1-8.5Z" fill="url(#andrGrad)"/></svg>',
          efectivo:
            '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="cashGrad" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#2BB673"/><stop offset="1" stop-color="#0E8D4E"/></linearGradient></defs><rect x="4" y="9" width="40" height="30" rx="9" fill="#eaf7ef" stroke="#c6e8d1" stroke-width="1.4"/><rect x="9" y="14" width="30" height="20" rx="7" fill="url(#cashGrad)" stroke="#0b7541" stroke-width="1.2"/><circle cx="24" cy="24" r="6" fill="#eaf7ef" stroke="#0b7541" stroke-width="1.2"/><path d="M24 18.2v11.6M21 21.3h6" stroke="#0b7541" stroke-width="1.6" stroke-linecap="round"/></svg>',
          transferencia:
            '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="bankGrad" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#7C8CF8"/><stop offset="1" stop-color="#4256D0"/></linearGradient></defs><rect x="4" y="8" width="40" height="32" rx="10" fill="#f3f4ff" stroke="#d7dcff" stroke-width="1.4"/><rect x="9" y="14" width="30" height="11" rx="4" fill="#e6e9ff" stroke="#bfc8ff" stroke-width="1.1"/><path d="M14 24h11l-3.5-3.6M34 22H23l3.5 3.6" fill="none" stroke="#4256d0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 12v-3M16 13h15" stroke="#bfc8ff" stroke-width="1.4" stroke-linecap="round"/></svg>',
        };

        const badgeLabels = {
          mercadoPago: "Mercado Pago",
          andreani: "Andreani",
          efectivo: "Pago en efectivo",
          transferencia: "Transferencia bancaria",
        };

        for (const [key, enabled] of Object.entries(cfg.badges)) {
          if (!enabled || !badgeIcons[key]) continue;
          badges.hidden = false;
          const span = document.createElement("span");
          span.className = `np-footer__badge np-footer__badge--${key}`;
          span.setAttribute("aria-label", badgeLabels[key] || key);

          const icon = document.createElement("span");
          icon.className = "np-footer__badge-icon";
          icon.innerHTML = badgeIcons[key];

          const label = document.createElement("span");
          label.className = "np-footer__badge-label";
          label.textContent = badgeLabels[key] || key;

          span.append(icon, label);
          badges.appendChild(span);
        }
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
      if (cfg.theme?.accentFrom) {
        footerEl.style.setProperty("--np-accent-from", cfg.theme.accentFrom);
      }
      if (cfg.theme?.accentTo) {
        footerEl.style.setProperty("--np-accent-to", cfg.theme.accentTo);
      }
      if (cfg.theme?.bg) {
        footerEl.style.setProperty("--np-bg", cfg.theme.bg);
      }
      if (cfg.theme?.fg) {
        footerEl.style.setProperty("--np-fg", cfg.theme.fg);
      }
      if (cfg.theme?.muted) {
        footerEl.style.setProperty("--np-muted", cfg.theme.muted);
      }
      if (cfg.theme?.border) {
        footerEl.style.setProperty("--np-border", cfg.theme.border);
      }
      if (cfg.theme?.link) {
        footerEl.style.setProperty("--np-link", cfg.theme.link);
      } else if (cfg.theme?.accentFrom) {
        footerEl.style.setProperty("--np-link", cfg.theme.accentFrom);
      }
      if (cfg.theme?.accentBar === false) {
        footerEl.setAttribute("data-accent", "off");
      }
      if (cfg.theme?.mode && cfg.theme.mode !== "auto") {
        footerEl.setAttribute("data-theme", cfg.theme.mode);
      } else {
        footerEl.removeAttribute("data-theme");
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
