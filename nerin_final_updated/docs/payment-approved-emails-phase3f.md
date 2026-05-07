# FASE 3F — Emails de pago aprobado (Mercado Pago)

## Endpoint/hook tocado
- `backend/routes/mercadoPago.js` (procesamiento del webhook MP vía `processNotification`).

## Punto exacto de integración
Se conecta después de confirmar/guardar estado de pago aprobado y dentro de `notifyCustomerStatus(...)` para estado `approved`.

## Emails conectados
1. Cliente: `sendPaymentApprovedEmail(order, customer)`
2. Interno admin: `sendAdminSalePaidNotificationEmail(order, options)`

## Logical keys
- Cliente: `payment_approved:${orderId}`
- Admin: `admin_sale_paid_notification:${orderId}`

## Duplicados
Se reutiliza `sendTransactionalEmailOnce(...)` (FASE 3C).
Webhooks repetidos quedan en `skipped_duplicate` sin reenvío.

## Manejo de errores
- Si falla Resend, no rompe webhook ni actualización de estado.
- Se registra estado fallido en logs de email.
- Se responde normalmente al flujo MP.

## Testing seguro
- Usar `EMAILS_ENABLED=false` o `EMAIL_TEST_MODE=true`.
- Simular evento approved y repetir para validar no duplicado.
- Verificar que cliente/admin no reciben envío real en pruebas.

## Qué NO se tocó
- Checkout
- Carrito
- Precios
- Productos
- Preferencia MP
- Andreani
- Analytics
