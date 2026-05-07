# Flujos de email “Pago aprobado”: Transferencia + Mercado Pago

## Objetivo
Unificar el envío de emails de pago aprobado en dos flujos separados, sin duplicar y sin romper webhook/admin update.

## Flujo A — Transferencia bancaria (manual admin)
- El email de creación por transferencia (`Esperando pago por transferencia`) se mantiene intacto.
- En `PUT/PATCH /api/orders/:id` (ruta usada por admin “Actualizar pedido”), cuando hay transición de estado de pago **de no pagado a pagado/aprobado**, se dispara:
  1. Cliente: `sendPaymentApprovedEmail(order, customer)`
  2. Admin: `sendAdminSalePaidNotificationEmail(order, options)`

### Detección de transición
- Se compara `prevPaymentCode` vs `nextPaymentCode`.
- Solo dispara si:
  - `incomingStatus != null`
  - `prevPaymentCode !== "approved"`
  - `nextPaymentCode === "approved"`

Estados origen cubiertos vía normalización existente (`mapPaymentStatusCode`):
- `pending`, `pendiente`, `unpaid`, `waiting_payment`, `transfer_pending`, `pendiente de comprobante`, `no_pagado` (y equivalentes que normalizan a pendiente/no pago)

Estados destino cubiertos:
- `paid`, `pagado`, `approved`, `aprobado`, `payment_approved` (equivalentes que normalizan a approved)

## Flujo B — Mercado Pago webhook
- Se mantiene en `backend/routes/mercadoPago.js`.
- Solo dispara al confirmarse estado real `approved` en backend/webhook.
- Envía:
  1. Cliente: `sendPaymentApprovedEmail(order, customer)`
  2. Admin: `sendAdminSalePaidNotificationEmail(order, options)`

## Idempotencia / deduplicación
Se usan las mismas logical keys en ambos flujos:
- Cliente: `payment_approved:${orderId}`
- Admin: `admin_sale_paid_notification:${orderId}`

Así, si intenta disparar por más de un flujo, el servicio de emails deduplica por `logicalKey`.

## Metadata `source`
- Transferencia manual admin: `source: "admin_manual_transfer_payment"`
- Mercado Pago webhook: `source: "mercado_pago_webhook"`

## Subject/contenido método de pago
- Se mantiene humanización de método en templates.
- Para transferencia manual, subject admin puede salir como:
  - `Vendiste en NERIN Parts — Pago aprobado por transferencia — Pedido #{ORDER_ID}`

## Manejo de fallas
- Si falta email cliente: no rompe actualización; queda estado email controlado.
- Si falta `ADMIN_SALES_EMAIL`/`ADMIN_SALES_EMAILS`: no rompe, retorna estado skipped/disabled.
- Si falla Resend: no rompe webhook ni actualización admin; registra `failed` y devuelve `emailWarning` en flujo admin.

## Testing seguro
Usar:
- `EMAILS_ENABLED=false` o
- `EMAIL_TEST_MODE=true`

Casos:
A. Transferencia pendiente -> admin marca pagado -> intenta `payment_approved` + `admin_sale_paid_notification`.
B. Repetir guardado pagado -> no duplica.
C. Ya pagado -> no dispara.
D. MP approved -> sigue disparando webhook.
E. Reintento webhook MP -> no duplica.
F. Falla Resend -> no rompe admin/webhook.

## Alcance
No se tocaron checkout, carrito, precios, productos, Andreani ni Analytics.
