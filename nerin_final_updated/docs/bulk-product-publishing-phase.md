# Publicación masiva de productos (fase NERIN Parts)

## Criterio de elegibilidad corregido
Se implementó `resolveBulkPublishEligibility(product)` con salida:

```json
{ "eligible": true|false, "reasons": [], "warnings": [], "updates": {} }
```

### Bloquea (reasons)
- `missing_name`
- `missing_identifier`
- `missing_price`
- `deleted`
- `archived`
- `disabled`
- `hidden`
- `private`
- `draft`
- `vip_only`
- `wholesale_only`

### Solo advierte (warnings)
- `missing_image`
- `missing_description`
- `stock_zero_remote_assumed`
- `generated_slug`
- `remote_delivery_estimated`

No se bloquea por `stock 0`, por `missing_image` ni por `missing_slug`.

## Endpoints
- `POST /api/admin/products/bulk-publish-preview`
  - Simula publicación y devuelve:
  - `totalScanned, eligibleCount, blockedCount, warningCount, samplesEligible, samplesBlocked, reasonCounts, warningCounts`.

- `POST /api/admin/products/bulk-publish`
  - Acepta: `{ dryRun, filters, limit, publishMode: "eligible_only" }`
  - Publica solo aptos.
  - Genera `public_slug` cuando falta.
  - Marca `visibility=status=public/active`, `enabled=true`, `is_public=true`.
  - Para stock local 0 configura modo remoto para mostrar “Disponible a pedido”.

## Ejemplos
- Stock local 0 + precio + nombre + sku => `eligible=true`, warning `stock_zero_remote_assumed`, se publica con disponibilidad remota.
- Sin imagen => `eligible=true`, warning `missing_image`.
- Sin precio => `eligible=false`, reason `missing_price`.

## UI Admin agregada
Sección “Publicación masiva” con:
- Botón **Simular publicación**.
- Botón **Publicar productos aptos**.
- Filtros: búsqueda, marca, categoría, solo ocultos/privados y límite.
- Resumen: escaneados, aptos, bloqueados, warnings, top reasons/warnings.

## Cómo probar
1. En Admin > Productos, usar sección “Publicación masiva”.
2. Simular con distintos filtros y validar que `missing_image`/`stock_zero_remote_assumed` aparecen como warning.
3. Ejecutar publicación con `limit=10`.
4. Verificar en catálogo público y sitemap rutas `/p/{slug}`.
5. Verificar que producto con stock 0 muestre “Disponible a pedido”.
6. Confirmar que no se modificaron precios ni flujos de pagos/logística/emails/pedidos.
