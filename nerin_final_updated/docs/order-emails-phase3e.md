# FASE 3E — Emails de pedidos internos/admin

## 1. Objetivo
Conectar emails de pedidos en flujos internos/admin sin tocar Mercado Pago.

## 2. Flujos de pedido detectados
- Creación de pedido: `POST /api/orders`.
- Actualización de estado/envío: `PATCH /api/orders/:id`.
- Carga de factura: `POST /api/orders/:id/invoices`.

## 3. Endpoints/funciones tocadas
- `backend/server.js`:
  - `POST /api/orders`
  - `PATCH /api/orders/:id`
  - `POST /api/orders/:id/invoices`
- `backend/services/emailService.js` (reutilizado, funciones de FASE 3B + idempotencia FASE 3C)

## 4. Emails conectados
- Pedido recibido
- Pedido en preparación
- Pedido enviado
- Factura disponible

## 5. Templates usados
- `sendOrderReceivedEmail(...)`
- `sendOrderPreparingEmail(...)`
- `sendOrderShippedEmail(...)`
- `sendInvoiceAvailableEmail(...)`

## 6. Logical keys usadas
- `order_received:${orderId}`
- `order_preparing:${orderId}`
- `order_shipped:${orderId}`
- `invoice_available:${orderId}`

## 7. Manejo de errores
- El fallo de email no rompe la operación principal.
- Se agrega `emailWarning` y `emailStatus/emailStatuses` en respuesta cuando corresponde.
- El registro de estados/fallos/duplicados queda en la capa de logs de FASE 3C.

## 8. Modo test/dry-run
- Se respeta `EMAILS_ENABLED`, `EMAIL_TEST_MODE`, `EMAIL_TEST_RECIPIENT` y `NODE_ENV` desde `emailService`.
- En pruebas de esta fase se usó modo seguro (sin envío real).

## 9. Qué NO se tocó
- No se modificó Mercado Pago, webhook MP, lógica de pagos ni preferencia MP.
- No se tocó Andreani, Analytics, carrito, precios, productos.

## 10. Cómo probar
1. `EMAILS_ENABLED=false` y crear pedido por `POST /api/orders`.
   - validar `emailStatus` y log `order_received`.
2. Cambiar estado de envío a preparing en `PATCH /api/orders/:id`.
   - validar `emailStatuses.orderPreparing`.
3. Cambiar estado de envío a shipped en `PATCH /api/orders/:id`.
   - validar `emailStatuses.orderShipped`.
4. Subir factura en `POST /api/orders/:id/invoices`.
   - validar `emailStatus` de factura.
5. Repetir acción con misma logical key para verificar `skipped_duplicate`.

## 11. Riesgos pendientes
- Integración de “pago aprobado” queda fuera de esta fase (FASE 3F).
- En multi-instancia podría requerirse lock distribuido adicional al log local.

## 12. Próximo paso recomendado: FASE 3F
Conectar email de pago aprobado (Mercado Pago) con deduplicación e idempotencia ya consolidadas.
