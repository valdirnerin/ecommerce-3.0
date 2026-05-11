# SEO + Stock remoto (fase combinada)

## Problema detectado
Productos con stock local 0 pero disponibles vía proveedor remoto aparecían como **Sin stock** en algunas capas, generando fricción de compra y señales SEO inconsistentes.

## Nueva lógica de disponibilidad
Se implementó `resolveProductAvailability(product)` en backend y frontend.

Estados:
- **En stock**: local > 0, compra habilitada, schema `InStock`.
- **Disponible a pedido**: sin stock local pero con señales de stock remoto, compra habilitada, schema `PreOrder`.
- **Sin stock**: sin stock local ni remoto, compra bloqueada, schema `OutOfStock`.

## Qué se indexa
- `/`
- `/shop.html`, `/shop`
- páginas públicas estáticas (ej. `/contact.html`, `/garantia.html`)
- productos en URL canónica `/p/{slug}`

## Qué NO se indexa
- `/api/`
- `/admin.html`
- `/checkout.html`
- `/cart.html`
- `/account.html`
- `/account-minorista.html`
- `/seguimiento.html`
- URLs con query como principal

## robots.txt final
Se sirve desde backend con:
- Allow global
- Disallow para áreas privadas y API
- `Disallow: /*?*`
- `Sitemap: https://nerinparts.com.ar/sitemap.xml`

## sitemap
- sitemap único (`/sitemap.xml`) para este volumen.
- solo productos públicos con canonical `/p/{slug}` (sin fallback `product.html?id=`).

## Cómo probar
1. Producto local > 0: muestra “EN STOCK” y permite compra.
2. Producto local 0 + remoto: muestra “DISPONIBLE A PEDIDO”, mantiene leyenda de 20-30 días y permite compra.
3. Sin stock total: bloquea compra con mensaje de WhatsApp.
4. Verificar `/robots.txt` y `/sitemap.xml`.
5. Verificar schema availability de producto remoto.
6. Verificar canonical `/p/{slug}`.

## Pendiente en Search Console
1. Enviar `/sitemap.xml`.
2. Validar cobertura de indexación y páginas excluidas.
3. Solicitar reindexación de páginas de producto remoto clave.
