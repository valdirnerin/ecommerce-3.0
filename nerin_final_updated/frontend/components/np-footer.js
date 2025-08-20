(function () {
  if (window.__npFooterLoaded) return;
  window.__npFooterLoaded = true;

  // No renderizar en admin
  const isAdmin =
    location.pathname.includes("/admin.html") ||
    document.querySelector(".admin-container");
  if (isAdmin) {
    console.info("[NP-FOOTER] Skip: admin page");
    return;
  }

  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn)
      : fn();

  ready(async () => {
    try {
      // 1) Obtener template
      let tpl = document.getElementById("np-footer-template");
      if (!tpl) {
        console.info("[NP-FOOTER] Loading template /components/np-footer.html");
        try {
          const r = await fetch("/components/np-footer.html", { cache: "no-store" });
          const html = await r.text();
          const div = document.createElement("div");
          div.innerHTML = html;
          tpl = div.querySelector("#np-footer-template");
          if (tpl) document.body.appendChild(tpl);
        } catch (e) {
          console.warn(
            "[NP-FOOTER] Template fetch failed, will use minimal fallback",
          );
        }
      }

      // 2) Crear footer (desde template o fallback mínimo)
      let footerEl;
      if (tpl && tpl.content && tpl.content.firstElementChild) {
        footerEl = tpl.content.firstElementChild.cloneNode(true);
      } else {
        footerEl = document.createElement("footer");
        footerEl.className = "np-footer";
        footerEl.innerHTML = `
          <div class="np-footer__inner">
            <nav class="np-footer__nav"><div class="np-footer__columns"></div></nav>
            <div class="np-footer__legal"></div>
          </div>`;
      }

      // 3) Cargar config
      let cfg = {};
      try {
        const res = await fetch("/api/footer", { cache: "no-store" });
        cfg = await res.json();
      } catch (e) {
        console.warn("[NP-FOOTER] /api/footer failed, using defaults");
      }

      // 4) Aplicar tema (modo claro por defecto)
      const theme = cfg.theme || {};
      if (theme.accentBar === false) footerEl.setAttribute("data-accent", "off");

      // 5) Rellenar contenido (columns/contact/social/legal) si existen en cfg.show
      const show = cfg.show || {};
      const colWrap = footerEl.querySelector(".np-footer__columns");
      if (show.columns && Array.isArray(cfg.columns) && colWrap) {
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
      const legal = footerEl.querySelector(".np-footer__legal");
      if (legal && show.legal && cfg.legal) {
        const y = new Date().getFullYear();
        const brand = cfg.brand || "NERIN PARTS";
        legal.innerHTML = `© ${y} ${brand} – CUIT ${cfg.legal.cuit || ""} – IIBB ${
          cfg.legal.iibb || ""
        }${
          cfg.legal.terms
            ? ` – <a href="${cfg.legal.terms}">Términos</a>`
            : ""
        }${
          cfg.legal.privacy
            ? ` – <a href="${cfg.legal.privacy}">Privacidad</a>`
            : ""
        }`;
      }

      // 6) Montaje (una vez) en #footer-root o antes de </body>
      if (document.querySelector(".np-footer")) {
        console.info("[NP-FOOTER] Already mounted, skipping");
        return;
      }
      const mount = document.getElementById("footer-root");
      if (mount) mount.appendChild(footerEl);
      else document.body.appendChild(footerEl);

      console.info("[NP-FOOTER] Mounted OK");
    } catch (e) {
      console.error("[NP-FOOTER] Fatal:", e);
    }
  });
})();

