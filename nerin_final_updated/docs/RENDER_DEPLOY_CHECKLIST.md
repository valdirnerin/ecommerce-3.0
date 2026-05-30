# Render Deploy Checklist

## Objetivo

Checklist operativo para publicar NERINParts en Render sin ejecutar hotfixes mutantes al arrancar y sin exponer secretos.

## Start command

Usar:

```bash
npm start
```

El script `start` debe resolver a:

```bash
node backend/server.js
```

No agregar scripts `applyPatch`, `applyHotfix`, `applyCodexSeoBulkPatch`, `applySitemapHotfix` ni tareas que modifiquen codigo o datos durante el arranque del servicio web.

## Variables requeridas o recomendadas

- `NODE_ENV=production`
- `PUBLIC_URL=https://nerinparts.com.ar`
- `DATA_DIR=/var/data` o la ruta persistente del Render Disk
- `RENDER_DISK_MOUNT_PATH=/var/data` si aplica
- `PRODUCTS_FILE_PATH=products.json` o ruta absoluta dentro del disco persistente
- `MERCHANT_FEED_ENABLED=true`
- `MERCHANT_PREORDER_DAYS=30`
- `MAX_JSON_BODY_BYTES=524288`
- `PUBLIC_PRODUCTS_CACHE_MS=30000`
- `PUBLIC_SEARCH_CACHE_MS=30000`
- `MERCHANT_FEED_CACHE_MS=1800000`
- `SITEMAP_STOCK_CACHE_MS=3600000`

Configurar aparte, sin commitear valores reales:

- credenciales de Mercado Pago
- credenciales de Resend/email
- claves de admin o integraciones privadas
- credenciales de base de datos externa si se usan

## Healthchecks

- `GET /healthz`: liviano; valida que el proceso responde.
- `GET /readyz`: valida estado de catalogo SQLite. Devuelve `503` mientras el catalogo inicializa o reconstruye.
- `GET /api/catalog/status`: diagnostico ampliado para operadores/admin.

## Validacion despues del deploy

1. Confirmar que Render marca el servicio como live.
2. Abrir `/healthz` y verificar `200`.
3. Abrir `/readyz`; si devuelve `503`, esperar y revisar progreso del catalogo antes de reiniciar.
4. Probar `/api/products?page=1&pageSize=24&includeFacets=1`.
5. Probar `/api/search?q=iphone&limit=12`.
6. Probar `/sitemap.xml` y confirmar que referencia `/sitemap-stock.xml`.
7. Probar `/sitemap-stock.xml` y verificar que solo tenga URLs `/p/...`.
8. Probar `/merchant-feed.tsv` y `/merchant-feed-debug.json`.
9. Hacer una prueba de carrito y checkout sin completar pago real.
10. Revisar logs por errores `CATALOG_INITIALIZING`, `REQUEST_BODY_TOO_LARGE`, Merchant o sitemap.

## Riesgos y pendientes

- Si el catalogo SQLite no existe o esta corrupto, `/readyz` puede devolver `503` mientras se reconstruye.
- Los feeds siguen generandose en runtime la primera vez; quedan cacheados, pero conviene moverlos a jobs offline si el catalogo crece mucho mas.
- No se rotaron secretos desde este PR. Si hubo secretos commiteados historicamente, rotarlos desde los proveedores.
