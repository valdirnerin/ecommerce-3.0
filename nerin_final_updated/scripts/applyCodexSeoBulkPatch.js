const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
let changedFiles = 0;

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function write(rel, text) {
  fs.writeFileSync(path.join(root, rel), text, "utf8");
}

function patch(rel, updater) {
  const before = read(rel);
  const after = updater(before);
  if (after !== before) {
    write(rel, after);
    changedFiles += 1;
    console.log("[codex-patch] updated " + rel);
  }
}

function replaceRequired(text, pattern, replacement, label) {
  const next = text.replace(pattern, replacement);
  if (next === text && !String(text).includes(String(replacement).slice(0, 80))) {
    console.warn("[codex-patch] " + label + " was already applied or pattern was not found");
  }
  return next;
}

const shopHelpers = String.raw`function renderShopListing(products, siteBase, totalCount = null) {
  const valid = Array.isArray(products)
    ? products.filter((p) => p && isProductPublic(p))
    : [];
  const cards = valid.slice(0, 30).map((p) => buildShopCard(p, siteBase)).join("");
  const numericTotal = Number(totalCount);
  const count = Number.isFinite(numericTotal) && numericTotal >= valid.length ? numericTotal : valid.length;
  const summary = count === 1 ? "producto disponible." : "productos disponibles.";
  return { cards, count, summary, products: valid.slice(0, 30) };
}

function filterShopProductsForSsr(products = [], { search = "", category = "", brand = "" } = {}) {
  const cleanSearch = compactText(search).toLowerCase();
  const cleanCategory = compactText(category).toLowerCase();
  const cleanBrand = compactText(brand).toLowerCase();
  return (Array.isArray(products) ? products : [])
    .filter((product) => product && isProductPublic(product))
    .filter((product) => {
      if (cleanCategory && compactText(product?.category || product?.categoria).toLowerCase() !== cleanCategory) return false;
      if (cleanBrand && compactText(product?.brand || product?.marca).toLowerCase() !== cleanBrand) return false;
      if (!cleanSearch) return true;
      const haystack = [
        product?.name,
        product?.title,
        product?.sku,
        product?.code,
        product?.brand,
        product?.category,
        product?.model,
        product?.description,
        product?.short_description,
      ]
        .map((value) => compactText(value).toLowerCase())
        .join(" ");
      return haystack.includes(cleanSearch);
    });
}
`;

const seoHelpers = String.raw`function buildShopSeoState({ siteBase, search = "", category = "", brand = "", count = 0, products = [] } = {}) {
  const normalizedBase = normalizeBaseUrl(siteBase) || FALLBACK_BASE_URL;
  const cleanSearch = compactText(search);
  const cleanCategory = compactText(category);
  const cleanBrand = compactText(brand);
  const query = new URLSearchParams();
  if (cleanCategory) query.set("category", cleanCategory);
  if (cleanBrand) query.set("brand", cleanBrand);
  const queryText = query.toString();
  const canonical = normalizedBase + "/shop.html" + (queryText ? "?" + queryText : "");
  const titleSubject = [cleanCategory, cleanBrand].filter(Boolean).join(" ");
  const title = cleanSearch
    ? "Resultados para " + cleanSearch + " | NERIN Parts"
    : titleSubject
      ? titleSubject + " en stock | NERIN Parts"
      : "Catalogo de repuestos para celulares | NERIN Parts";
  const description = cleanSearch
    ? "Resultados de busqueda para " + cleanSearch + " en NERIN Parts. Repuestos para celulares con stock real, factura A/B y envios a todo el pais."
    : titleSubject
      ? "Compra " + titleSubject + " en NERIN Parts. Stock real, factura A/B, retiro con turno en CABA y envios a todo Argentina."
      : "Catalogo actualizado de pantallas, modulos, baterias y repuestos para celulares. Stock real, garantia, factura A/B y envios a todo Argentina.";
  const robots = cleanSearch ? "noindex,follow" : "index,follow";
  const itemListElement = products
    .map((product, index) => {
      const slug = product?.publicSlug || product?.public_slug || product?.slug || product?.id;
      const urlValue = slug ? absoluteUrl("/p/" + encodeURIComponent(String(slug)), normalizedBase) : null;
      if (!urlValue) return null;
      return {
        "@type": "ListItem",
        position: index + 1,
        url: urlValue,
        name: product?.name || product?.title || "Repuesto NERIN",
      };
    })
    .filter(Boolean);
  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: canonical,
    isPartOf: {
      "@type": "WebSite",
      name: "NERIN Parts",
      url: normalizedBase + "/",
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: Number(count) || itemListElement.length,
      itemListElement,
    },
  };
  return { canonical, title, description, robots, collectionLd };
}

function replaceTag(html, regex, replacement) {
  if (regex.test(html)) return html.replace(regex, replacement);
  return html + replacement;
}

function applyShopSeoHead(head, seo) {
  let next = head || "";
  next = replaceTag(next, /<title>[\s\S]*?<\/title>/i, "<title>" + esc(seo.title) + "</title>");
  next = replaceTag(next, /<meta\s+name=["']description["'][^>]*>/i, "<meta name=\"description\" content=\"" + esc(seo.description) + "\">");
  next = replaceTag(next, /<meta\s+name=["']robots["'][^>]*>/i, "<meta name=\"robots\" content=\"" + esc(seo.robots) + "\">");
  next = replaceTag(next, /<link\s+rel=["']canonical["'][^>]*>/i, "<link rel=\"canonical\" href=\"" + esc(seo.canonical) + "\">");
  next = replaceTag(next, /<meta\s+property=["']og:title["'][^>]*>/i, "<meta property=\"og:title\" content=\"" + esc(seo.title) + "\">");
  next = replaceTag(next, /<meta\s+property=["']og:description["'][^>]*>/i, "<meta property=\"og:description\" content=\"" + esc(seo.description) + "\">");
  next = replaceTag(next, /<meta\s+property=["']og:url["'][^>]*>/i, "<meta property=\"og:url\" content=\"" + esc(seo.canonical) + "\">");
  next = replaceTag(next, /<meta\s+name=["']twitter:title["'][^>]*>/i, "<meta name=\"twitter:title\" content=\"" + esc(seo.title) + "\">");
  next = replaceTag(next, /<meta\s+name=["']twitter:description["'][^>]*>/i, "<meta name=\"twitter:description\" content=\"" + esc(seo.description) + "\">");
  next = replaceTag(next, /<meta\s+name=["']twitter:url["'][^>]*>/i, "<meta name=\"twitter:url\" content=\"" + esc(seo.canonical) + "\">");
  return next.replace(
    /<script[^>]+id=["']shop-schema["'][^>]*>[\s\S]*?<\/script>/i,
    "<script type=\"application/ld+json\" id=\"shop-schema\">" + safeJsonForScript(seo.collectionLd) + "</script>",
  );
}

function replaceBasePlaceholders`;

const shopRoute = String.raw`  // SSR del catalogo
  if (
    (pathname === "/shop.html" || pathname === "/shop" || pathname === "/shop/") &&
    req.method === "GET"
  ) {
    const seoConfig = getConfig();
    const siteBase = getPublicBaseUrl(seoConfig);
    const { head: templateHead, body: templateBody } = getShopTemplateParts();
    const search = compactText(String(parsedUrl.query?.search || ""));
    const category = compactText(String(parsedUrl.query?.category || parsedUrl.query?.categoria || ""));
    const brand = compactText(String(parsedUrl.query?.brand || parsedUrl.query?.marca || ""));
    const sort = compactText(String(parsedUrl.query?.sort || ""));
    let queryResult = null;
    try {
      queryResult = await productsSqliteRepo.queryProducts({
        page: 1,
        pageSize: 30,
        search,
        category,
        brand,
        sort,
      });
    } catch (error) {
      console.warn("[shop-ssr:query-failed]", error?.message || error);
      try {
        const fallbackProducts = filterShopProductsForSsr(await loadProducts(), { search, category, brand });
        queryResult = {
          items: fallbackProducts.slice(0, 30),
          totalItems: fallbackProducts.length,
        };
      } catch (fallbackError) {
        console.warn("[shop-ssr:fallback-failed]", fallbackError?.message || fallbackError);
      }
    }
    const rendered = renderShopListing(queryResult?.items || [], siteBase, queryResult?.totalItems);
    const listing = rendered.cards || '<p class="description">Cargando catalogo...</p>';
    const summary = rendered.summary || "Mostrando productos";
    const seo = buildShopSeoState({
      siteBase,
      search,
      category,
      brand,
      count: rendered.count,
      products: rendered.products,
    });
    const hydratedHead = applyShopSeoHead(replaceBasePlaceholders(templateHead, siteBase), seo);
    let hydratedBody = replaceBasePlaceholders(templateBody, siteBase);
    hydratedBody = hydratedBody.replace(
      /<div\s+id=\"productGrid\"[^>]*>\s*<\/div>/i,
      '<div id="productGrid" class="product-grid premium-grid" role="list">' + listing + '</div>',
    );
    hydratedBody = hydratedBody.replace(
      /<span\s+id=\"resultCount\">[^<]*<\/span>/i,
      '<span id="resultCount">' + esc(String(rendered.count || 0)) + '</span>',
    );
    hydratedBody = hydratedBody.replace(
      /<p>\s*<span\s+id=\"resultCount\">[^<]*<\/span>[^<]*<\/p>/i,
      '<p><span id="resultCount">' + esc(String(rendered.count || 0)) + '</span> ' + esc(summary) + '</p>',
    );
    const html = '<!doctype html><html lang="es"><head>' + hydratedHead + '</head>' + hydratedBody + '</html>';
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // Servir componentes`;

patch("backend/server.js", (text) => {
  let next = text;
  next = next.replace(/\n\s*"Disallow: \/\*\?\*",/g, "");
  if (!next.includes("function filterShopProductsForSsr(")) {
    next = replaceRequired(
      next,
      /function renderShopListing\(products, siteBase\) \{[\s\S]*?return \{ cards, count, summary \};\n\}/,
      shopHelpers.trimEnd(),
      "shop listing helpers",
    );
  }
  if (!next.includes("function buildShopSeoState(")) {
    next = replaceRequired(
      next,
      /function replaceBasePlaceholders/,
      seoHelpers,
      "shop seo helpers",
    );
  }
  next = replaceRequired(
    next,
    /  \/\/ SSR del cat[^\n]*\n  if \(\n    \(pathname === "\/shop\.html"[\s\S]*?\n  \/\/ Servir componentes/,
    shopRoute,
    "shop ssr route",
  );
  return next;
});

patch("backend/data/productsSqliteRepo.js", (text) => {
  let next = text;
  next = next.replace(/\n\s*if \(signals\.enabledFalse\) reasons\.push\("disabled"\);/g, "");
  next = next.replace(/\n\s*if \(signals\.visibility === "hidden" \|\| signals\.status === "hidden"\) reasons\.push\("hidden"\);/g, "");
  next = next.replace(/\n\s*if \(signals\.visibility === "private" \|\| signals\.status === "private"\) reasons\.push\("private"\);/g, "");
  next = next.replace(/firstFiniteNumber\(\[/g, "firstNumber([");
  next = next.replace(
    /const query = await queryAdminProducts\(\{\n    page: 1,\n    pageSize: safeLimit,\n    search: filters\?\.search \|\| "",\n    brand: filters\?\.brand \|\| "",\n    category: filters\?\.category \|\| "",\n    visibility: filters\?\.visibility \|\| "",\n    status: filters\?\.status \|\| "",\n  \}\);\n  const rows = query\.items \|\| \[\];/,
    `const privateScope = filters?.privateScope === "private_or_hidden";
  const query = await queryAdminProducts({
    page: 1,
    pageSize: safeLimit,
    search: filters?.search || "",
    brand: filters?.brand || "",
    category: filters?.category || "",
    visibility: privateScope ? "" : filters?.visibility || "",
    status: filters?.status || "",
  });
  const rawRows = query.items || [];
  const rows = privateScope
    ? rawRows.filter((item) => {
        const visibility = normalizeQueryText(item.visibility || "");
        const status = normalizeQueryText(item.status || "");
        return visibility === "private" || visibility === "hidden" || status === "private" || status === "hidden";
      })
    : rawRows;`,
  );
  next = next.replace(
    /const query = await queryAdminProducts\(\{ page: 1, pageSize: Math\.max\(1, Math\.min\(50000, Number\(limit\) \|\| 500\)\), search: filters\?\.search \|\| "", brand: filters\?\.brand \|\| "", category: filters\?\.category \|\| "", visibility: filters\?\.visibility \|\| "", status: filters\?\.status \|\| "" \}\);\n  const rows = query\.items \|\| \[\];/,
    `const publishPrivateScope = filters?.privateScope === "private_or_hidden";
  const query = await queryAdminProducts({
    page: 1,
    pageSize: Math.max(1, Math.min(50000, Number(limit) || 500)),
    search: filters?.search || "",
    brand: filters?.brand || "",
    category: filters?.category || "",
    visibility: publishPrivateScope ? "" : filters?.visibility || "",
    status: filters?.status || "",
  });
  const rawRows = query.items || [];
  const rows = publishPrivateScope
    ? rawRows.filter((item) => {
        const visibility = normalizeQueryText(item.visibility || "");
        const status = normalizeQueryText(item.status || "");
        return visibility === "private" || visibility === "hidden" || status === "private" || status === "hidden";
      })
    : rawRows;`,
  );
  return next;
});

patch("frontend/admin.html", (text) => {
  let next = text;
  next = next.replace(
    /(<input type="number" id="bulkPublishLimit" placeholder="[^"]*" min="1" max="50000")( \/>)/,
    '$1 value="500"$2',
  );
  next = next.replace(/<option value="">Acci[oÃ³]n masiva[^<]*<\/option>/, '<option value="">Accion por seleccion...</option>');
  next = next.replace(/<strong>Publicaci[^<]*masiva<\/strong>/, '<strong>Privados -&gt; publicos</strong>');
  next = next.replace(/(<input type="checkbox" id="bulkPublishOnlyHidden")( \/>)/, '$1 checked$2');
  next = next.replace(/Solo ocultos\/privados/g, "Solo privados u ocultos");
  next = next.replace(/Simular publicaci[^<]*<\/button>/, 'Simular privados -&gt; publicos</button>');
  next = next.replace(/Publicar productos aptos<\/button>/, 'Pasar privados -&gt; publicos</button>');
  if (!next.includes('value="vis-public"')) {
    next = next.replace(
      /<option value="delete">Eliminar<\/option>/,
      '<option value="delete">Eliminar</option>\n              <option value="vis-public">Pasar seleccionados a publico</option>\n              <option value="vis-private">Pasar seleccionados a privado</option>',
    );
  }
  return next;
});

const bulkRunHandler = String.raw`if (bulkPublishRunBtn) {
  bulkPublishRunBtn.addEventListener("click", async () => {
    const payload = { ...getBulkPublishPayload(), dryRun: false, publishMode: "eligible_only" };
    bulkPublishRunBtn.disabled = true;
    bulkPublishRunBtn.textContent = "Pasando...";
    try {
      const previewRes = await apiFetch("/api/admin/products/bulk-publish-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const preview = await previewRes.json();
      if (!previewRes.ok) throw new Error(preview?.error || "No se pudo simular privados a publicos");
      if (!preview.eligibleCount) {
        renderBulkPublishSummary(preview, "preview");
        return;
      }
      const scope = payload.filters?.privateScope === "private_or_hidden" ? "privados/ocultos" : "filtrados";
      const message = "Se van a pasar a publico " + preview.eligibleCount + " productos " + scope + " (limite " + payload.limit + "). Continuar?";
      if (!confirm(message)) {
        renderBulkPublishSummary(preview, "preview");
        return;
      }
      const res = await apiFetch("/api/admin/products/bulk-publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "No se pudo pasar a publico en masa");
      renderBulkPublishSummary(data, "publish");
      loadProducts();
    } finally {
      bulkPublishRunBtn.disabled = false;
      bulkPublishRunBtn.textContent = "Pasar privados -> publicos";
    }
  });
}

async function deleteProduct`;

patch("frontend/js/admin.js", (text) => {
  let next = text;
  next = next.replace(
    /function getBulkPublishPayload\(\) \{\n  const filters = \{/,
    'function getBulkPublishPayload() {\n  const safeLimit = Math.max(1, Math.min(50000, Number(bulkPublishLimit?.value || 500) || 500));\n  const filters = {',
  );
  next = next.replace(/limit: Number\(bulkPublishLimit\?\.value \|\| 500\),/, "limit: safeLimit,");
  next = next.replace(/if \(bulkPublishOnlyHidden\?\.checked\) filters\.visibility = "private";/, 'if (bulkPublishOnlyHidden?.checked) filters.privateScope = "private_or_hidden";');
  next = replaceRequired(
    next,
    /if \(bulkPublishRunBtn\) \{[\s\S]*?\n\}\n\nasync function deleteProduct/,
    bulkRunHandler,
    "bulk publish run handler",
  );
  return next;
});

console.log("[codex-patch] complete; changedFiles=" + changedFiles);
