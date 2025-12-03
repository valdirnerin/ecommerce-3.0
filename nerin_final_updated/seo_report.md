# Auditoría de SEO de producto

## Plantilla / vista de producto
- **Archivo:** `frontend/product.html`
- **Head actual:** la plantilla trae metadatos genéricos marcados con `data-product-meta` que son removidos en SSR. Ejemplo de título y description base:
  ```html
  <title data-product-meta="title">
      Módulo Pantalla Samsung Original Service Pack | NERIN Parts
  </title>
  <meta
      name="description"
      content="Módulo pantalla Samsung original Service Pack. Con marco, listo para instalar. Envíos a todo Argentina, factura A/B y garantía técnica NERIN."
      data-product-meta="description"
    />
  ```

## Generador SEO centralizado
- **Función:** `generateProductSeo(product)`
- **Ubicación:** `backend/utils/productSeo.js`
- **Firma / rol:** devuelve `{ title, description, ogTitle, ogDescription }` a partir de brand, línea (Galaxy), modelo, código de modelo y GH82, con fallback elegante.
  ```js
  function generateProductSeo(product = {}) {
    const brand = normalizeText(product.brand || product.catalog_brand) || "Samsung";
    const line = inferLine(product, brand);
    const model = extractModelName(product);
    const modelCode = extractModelCode(product);
    const ghCode = extractGhCode(product);
    ...
    return {
      title: truncateText(title || "Módulo Pantalla original Service Pack | NERIN Parts", 160),
      description: truncateText(description, 200),
      ogTitle: title,
      ogDescription: description,
    };
  }
  ```

## Controller / ruta de detalle
- **Ruta SSR de producto:** `/p/:slug` en `backend/server.js`.
- **Uso de SEO dinámico:** se carga el producto desde `data/products.json`, se llama a `generateProductSeo(product)` y se arma el head con esos valores.
  ```js
  const productSeo = generateProductSeo(product);
  const seoTitle = productSeo.title || buildProductSeoTitle(product);
  const description = productSeo.description || buildProductMetaDescription(product);
  ...
  const head = [
    templateHead,
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(metaDescription)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(metaDescription)}">`,
    ...
  ];
  ```

## Aplicación en la vista
- El servidor limpia los metatags marcados como `data-product-meta` en `frontend/product.html` y los reemplaza en SSR con `productSeo.title` y `productSeo.description`.
- Para clientes que lleguen a `/product.html`, el JS de `frontend/js/product.js` también usa `applySeoDefaults`/`generateProductSeo` para setear `<title>` y `<meta description>` luego de cargar el producto.

## Sitemap y robots
- **Sitemap:** ruta `GET /sitemap.xml` en `backend/server.js` genera dinámicamente URLs de home, catálogo, categorías y **todas** las URLs de producto (`/p/slug` o `product.html?id=`).
- **robots.txt:** ruta `GET /robots.txt` en `backend/server.js`; expone `User-agent: *`, `Disallow:`, bloquea `/admin` y referencia al sitemap con la URL pública configurada.

## Conclusión
- El proyecto ya cuenta con un generador SEO (`generateProductSeo`) y se usa en la ruta SSR de producto. El `<title>` y `<meta name="description">` se renderizan de forma dinámica para todos los productos (SSR y en el cliente). No se observan faltantes en sitemap ni robots.
- Archivos revisados/modificados en esta auditoría: `frontend/product.html`, `backend/utils/productSeo.js`, `backend/server.js`, `frontend/js/product.js`, `seo_report.md`.
