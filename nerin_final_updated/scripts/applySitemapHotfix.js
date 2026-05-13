const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const serverPath = path.join(root, "backend/server.js");
const marker = "async function requestHandler(req, res) {\n";
const flag = "[sitemap-hotfix-large-catalog]";

let text = fs.readFileSync(serverPath, "utf8");

if (text.includes(flag)) {
  console.log("[sitemap-hotfix] already applied");
  process.exit(0);
}

if (!text.includes(marker)) {
  console.warn("[sitemap-hotfix] marker not found; server.js was not changed");
  process.exit(0);
}

const snippet = String.raw`async function requestHandler(req, res) {
  // [sitemap-hotfix-large-catalog]
  // Intercepta sitemaps antes del handler historico para evitar cargar products.json completo en memoria.
  // El catalogo real puede superar 100 MB, por eso aca se consulta SQLite via productsSqliteRepo.
  const __sitemapParsedUrl = url.parse(req.url, true);
  const __sitemapPathname = __sitemapParsedUrl.pathname;
  if (
    (__sitemapPathname === "/sitemap.xml" ||
      __sitemapPathname === "/sitemap-static.xml" ||
      /^\/sitemap-products-\d+\.xml$/.test(__sitemapPathname)) &&
    req.method === "GET"
  ) {
    try {
      const cfg = getConfig();
      const siteBase = getPublicBaseUrl(cfg);
      const base = normalizeBaseUrl(siteBase) || FALLBACK_BASE_URL;
      const generatedAt = toIsoString(new Date());
      const pageSize = 45000;
      const staticEntries = ["/", "/shop.html", "/shop", "/contact.html", "/garantia.html"].map((pathSegment) => ({
        loc: absoluteUrl(pathSegment, base),
        lastmod: generatedAt,
        changefreq: pathSegment === "/" || pathSegment === "/shop.html" || pathSegment === "/shop" ? "daily" : "monthly",
        priority: pathSegment === "/" ? "1.0" : pathSegment === "/shop.html" || pathSegment === "/shop" ? "0.9" : "0.5",
      }));
      const toProductEntry = (product) => {
        const slug = product?.publicSlug || product?.public_slug || product?.slug;
        if (!slug) return null;
        const autoContent = buildProductAutoContent(product || {});
        if (!evaluateProductSeoQuality(product || {}, autoContent).indexable) return null;
        return {
          loc: absoluteUrl("/p/" + encodeURIComponent(String(slug)), base),
          lastmod: generatedAt,
          changefreq: "weekly",
          priority: "0.8",
        };
      };
      const firstPage = await productsSqliteRepo.queryProducts({ page: 1, pageSize: 1 });
      const publicCount = Number(firstPage?.totalItems || firstPage?.total || firstPage?.count || firstPage?.items?.length || 0);
      const totalParts = Math.max(1, Math.ceil(publicCount / pageSize));

      if (__sitemapPathname === "/sitemap-static.xml") {
        console.log("[sitemap] static");
        const xml = buildSitemapPartXml(base, staticEntries);
        res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
        res.end(xml);
        return;
      }

      if (__sitemapPathname === "/sitemap.xml") {
        console.log("[sitemap] index count=" + publicCount);
        if (publicCount > pageSize) {
          const paths = ["/sitemap-static.xml"];
          for (let i = 1; i <= totalParts; i += 1) paths.push("/sitemap-products-" + i + ".xml");
          const xml = buildSitemapIndexXml(base, paths);
          res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
          res.end(xml);
          return;
        }
        const page = await productsSqliteRepo.queryProducts({ page: 1, pageSize });
        const productEntries = (page?.items || []).map(toProductEntry).filter(Boolean);
        const xml = buildSitemapPartXml(base, [...staticEntries, ...productEntries]);
        res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
        res.end(xml);
        return;
      }

      const match = __sitemapPathname.match(/^\/sitemap-products-(\d+)\.xml$/);
      const part = Number(match?.[1] || 0);
      if (!Number.isInteger(part) || part < 1 || part > totalParts) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const page = await productsSqliteRepo.queryProducts({ page: part, pageSize });
      const productEntries = (page?.items || []).map(toProductEntry).filter(Boolean);
      console.log("[sitemap] products part=" + part + " limit=" + pageSize + " count=" + productEntries.length);
      const xml = buildSitemapPartXml(base, productEntries);
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      res.end(xml);
      return;
    } catch (error) {
      console.error("[sitemap:error]", error?.message || error);
      res.writeHead(500, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" });
      res.end('<?xml version="1.0" encoding="UTF-8"?><error>Sitemap temporarily unavailable</error>');
      return;
    }
  }
`;

text = text.replace(marker, snippet);
fs.writeFileSync(serverPath, text, "utf8");
console.log("[sitemap-hotfix] updated backend/server.js");
