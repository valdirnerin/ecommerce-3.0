# Supplier Pricing Conservador (Excel/CSV)

Este módulo evita publicar el `UnitPrice` del proveedor como precio final.

## Ubicación
- Config defaults: `backend/config/supplierPricingDefaults.js`
- Motor de pricing: `backend/services/supplierPricing.js`
- Tests: `__tests__/backend/supplier-pricing.test.js`

## Fórmula implementada

1) Conversión proveedor -> USD -> ARS
- Si proveedor EUR: `supplier_cost_usd = unit_price_eur * eur_usd`
- Si proveedor USD: `supplier_cost_usd = unit_price_usd`
- `supplier_cost_ars = supplier_cost_usd * usd_ars`

2) Prorrateo envío internacional
- `shipping_total_usd = international_shipping_total_eur * eur_usd`
- `shipping_total_ars = shipping_total_usd * usd_ars`
- `share_of_order = supplier_cost_usd / minimum_order_usd`
- `international_shipping_allocated_ars = shipping_total_ars * share_of_order`

3) CIF y base importación
- `cif_ars = supplier_cost_ars + international_shipping_allocated_ars`
- `base_import_ars = cif_ars * (1 + die + tasa_estadistica)`

4) Impuestos importación
- `iva_import_ars = base_import_ars * iva_importacion`
- `percepcion_iva_ars = base_import_ars * percepcion_iva`
- `percepcion_ganancias_ars = base_import_ars * percepcion_ganancias`

5) Costo landed total
- `total_landed_cost_ars = base_import_ars + iva_import_ars + percepcion_iva_ars + percepcion_ganancias_ars + ml_shipping_cost_ars + packaging_cost_ars + ads_cost_ars`

6) Precio final
- `final_price_ars_raw = total_landed_cost_ars / (1 - ml_commission - iibb - net_margin)`
- Se aplica mínimo `minimum_final_price_ars`
- Con `rounding_mode = ceil_100`: redondea al próximo 100 ARS hacia arriba.

## Parámetros configurables (defaults)
Se centralizan en `DEFAULT_SUPPLIER_PRICING_CONFIG`.

- `supplier_currency`, `usd_ars`, `eur_usd`
- `international_shipping_total_eur`, `minimum_order_usd`
- `die`, `tasa_estadistica`, `iva_importacion`, `percepcion_iva`, `percepcion_ganancias`
- `ml_commission`, `iibb`, `net_margin`
- `ml_shipping_cost_ars`, `packaging_cost_ars`, `ads_cost_ars`
- `minimum_final_price_ars`, `rounding_mode`

## Uso recomendado

```js
const {
  normalizeProductRow,
  calculateProductPricing,
  isPublishable,
  buildPricingAudit,
} = require('./backend/services/supplierPricing');

const normalized = normalizeProductRow(row, configOverrides);
const pricing = calculateProductPricing(normalized, configOverrides);
const publishable = isPublishable(normalized);
const audit = buildPricingAudit(normalized, pricing, configOverrides);
```

## Detección de columnas Excel/CSV
`normalizeProductRow` intenta detectar variaciones de columnas:
- precio proveedor: `UnitPrice`, `Price`, `Precio`, `SupplierPrice`, etc.
- título: `Name`, `Nombre`, `Title`, `Descripción`, etc.
- stock: `Stock`, `Quantity`, `Cantidad`, etc.
- imagen: `Image`, `ImageURL`, `Imagen`, `Pictures`, etc.
- SKU/EAN: variantes comunes.

## Supuestos conservadores
- Si falta `UnitPrice` o es <= 0: no calcula precio (`ok=false`).
- Si falta stock o stock <= 0: calcula pero marca warning de no publicable.
- Si falta imagen: calcula pero marca warning de no publicable.
- Si moneda no soportada: error explícito.

