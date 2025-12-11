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

      // Métodos de pago y envío
      const payments = footerEl.querySelector(".np-footer__payments");
      const paymentList = footerEl.querySelector(".np-footer__payment-list");
      if (payments && paymentList && show.badges && cfg.badges) {
        const paymentIcons = {
          mercadoPago:
            '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><rect x="3" y="7" width="26" height="18" rx="8" stroke="#66c9f4" stroke-width="1.3"/><path d="M9.5 16c2.7-2.2 5.3-2.2 7.9 0 2.2-1.9 4.5-2 6.8 0" stroke="#00a0de" stroke-width="1.6" stroke-linecap="round"/><path d="m12.5 15 2.6 2.5a1.7 1.7 0 0 0 2.3 0l2.6-2.5" stroke="#00a0de" stroke-width="1.4" stroke-linecap="round"/><path d="M14.9 17.4 13 19.6a1.6 1.6 0 0 1-2.2 0l-1.9-2M17 17.4l1.8 2.2a1.6 1.6 0 0 0 2.2 0l1.9-2" stroke="#0c6fa6" stroke-width="1.2" stroke-linecap="round"/></svg>',
          andreani:
            '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="12" stroke="#f15a4a" stroke-width="1.4"/><path d="M16 9 10 23h4.2l1.6-3.8h4l1.5 3.8H25L18.3 9H16Zm1.3 4.6 2.3 5.2h-4.7l2.4-5.2Z" fill="#f15a4a"/></svg>',
          efectivo:
            '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><rect x="5" y="9" width="22" height="14" rx="4" stroke="#8bd4b4" stroke-width="1.3"/><rect x="8" y="12" width="16" height="8" rx="3" stroke="#8bd4b4" stroke-width="1.1"/><path d="M16 13.6v4.8M13.8 15.3h4.4" stroke="#c7f9e8" stroke-width="1.3" stroke-linecap="round"/></svg>',
          transferencia:
            '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><rect x="5" y="8" width="22" height="14" rx="4" stroke="#b2bef0" stroke-width="1.2"/><path d="M9.5 18h9L15 14.5M22.5 14h-9l3.5 3.5" stroke="#d6ddff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 11.5V9.8M12 12.2h8" stroke="#94a3b8" stroke-width="1.1" stroke-linecap="round"/></svg>',
        };

        const paymentLabels = {
          mercadoPago: "Mercado Pago",
          andreani: "Andreani",
          efectivo: "Pago en efectivo",
          transferencia: "Transferencia bancaria",
        };

        for (const [key, enabled] of Object.entries(cfg.badges)) {
          if (!enabled || !paymentIcons[key]) continue;
          payments.hidden = false;
          const item = document.createElement("li");
          item.className = `np-footer__payment-badge np-footer__payment-badge--${key}`;
          item.setAttribute("aria-label", paymentLabels[key] || key);

          const icon = document.createElement("span");
          icon.className = "np-footer__payment-icon";
          icon.innerHTML = paymentIcons[key];

          const label = document.createElement("span");
          label.className = "np-footer__payment-label";
          label.textContent = paymentLabels[key] || key;

          item.append(icon, label);
          paymentList.appendChild(item);
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
