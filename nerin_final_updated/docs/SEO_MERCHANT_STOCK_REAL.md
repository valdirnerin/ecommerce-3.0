# SEO y Merchant Center: prioridad de stock real

## Qué cambió

- Las landings `/stock-real` y `/pantallas-en-stock` sólo publican productos con stock físico, precio, imagen y slug canónico.
- `/baterias-en-stock`, `/repuestos-samsung` y `/repuestos-iphone` responden `200`. Cuando no tienen stock real usan `noindex,follow`, muestran una alternativa útil y dejan de estar enlazadas desde home, catálogo y navegación SEO.
- El catálogo ordena primero stock real, luego productos a pedido y finalmente productos sin stock. Los resultados visibles se deduplican por MPN, SKU, slug y título normalizado.
- La home muestra únicamente productos destacados con stock real, precio, imagen y slug.
- Las fichas muestran cantidad física, precio, CTA de compra, consulta de compatibilidad por WhatsApp, Factura A/B, despacho desde CABA, envíos nacionales y SKU/MPN. La compra queda desactivada cuando no hay stock.
- Los títulos comerciales de pantallas se generan en español. Los compatibles se identifican como compatibles y no usan Samsung como marca del producto; Samsung queda como compatibilidad.
- El JSON-LD `Product`/`Offer` usa `InStock`, `PreOrder`, `BackOrder` u `OutOfStock` según el mismo resolvedor que usa la interfaz. `availabilityStarts` sólo se emite para preorder/backorder.
- `product.html?id=...` redirige permanentemente a `/p/{slug}`.
- El sitemap sólo incluye URLs canónicas; `/shop` ya no se duplica con `/shop.html` y las categorías vacías quedan fuera.

## Feeds de Google Merchant Center

- Feed principal de stock real: `GET /merchant-feed.tsv`
- Alias explícito del feed principal: `GET /merchant-feed-stock-real.tsv`
- Feed separado para productos a pedido: `GET /merchant-feed-preorder.tsv`
- Muestra del feed principal: `GET /merchant-feed-sample.tsv`
- Auditoría: `GET /merchant-feed-debug.json`
- Auditoría de productos a pedido: `GET /merchant-feed-debug.json?scope=preorder`

El feed principal sólo admite `availability=in_stock` y nunca emite `availability_date`. El feed a pedido sólo admite `preorder`/`backorder` y exige una fecha RFC 3339, por ejemplo `2026-07-19T00:00:00-03:00`. Ningún producto sin stock se envía a esos feeds.

## Criterios de elegibilidad Merchant

Un producto debe ser público y estar habilitado, tener identificador, título comercial, descripción, `/p/{slug}`, imagen HTTP(S) válida y precio positivo en ARS. Los productos privados, borradores, archivados, mayoristas/VIP o sin datos mínimos quedan excluidos.

`identifier_exists=yes` sólo se usa cuando existen una marca real y un MPN real. Los repuestos compatibles usan la marca real del fabricante si está informada; de lo contrario usan `Compatible` y `identifier_exists=no`. Para Service Pack Samsung se prioriza el MPN GH82.

## Cómo probar

```bash
npm ci
npm test -- --runInBand
```

Validación dirigida:

```bash
npx jest backend/__tests__/organic-seo-stock-real.test.js backend/__tests__/merchant-availability-ui.test.js backend/__tests__/product-ssr.test.js __tests__/backend/merchant-feed.test.js __tests__/backend/catalog-visibility.test.js __tests__/backend/seo-endpoints.test.js --runInBand
```

Comprobar manualmente:

- `/`, `/shop.html`, `/stock-real`, `/pantallas-en-stock`, `/baterias-en-stock`, `/repuestos-samsung` y `/repuestos-iphone`.
- `/sitemap.xml`, `/sitemap-static.xml`, `/sitemap-stock.xml` y un sitemap de productos.
- Los tres estados de ficha: stock real, a pedido y sin stock.
- Los feeds principal, stock-real y preorder; verificar que disponibilidad y fecha coincidan con la ficha.

## Próximos pasos operativos

1. En Search Console, enviar únicamente `https://nerinparts.com.ar/sitemap.xml` y solicitar reindexación de las landings con stock real.
2. En Merchant Center, usar `/merchant-feed.tsv` como fuente principal. Mantener `/merchant-feed-preorder.tsv` como fuente separada sólo si las fechas visibles pueden sostenerse operativamente.
3. Revisar Diagnóstico de Merchant después de cada actualización de catálogo: precio, imagen, MPN, disponibilidad y discrepancias de landing.
4. No indexar ni enlazar una landing vacía. El sitio la reactivará automáticamente al ingresar stock físico elegible.
5. No modificar precios desde estos procesos; sólo se normaliza su representación como `0.00 ARS`.
