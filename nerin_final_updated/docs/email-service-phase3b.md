# FASE 3B — Servicio centralizado de emails

## 1. Qué se implementó
- Se creó un módulo centralizado en `backend/services/emailService.js` para preparar y enviar correos transaccionales con Resend desde un único punto recomendado.
- Se agregaron helpers de formato y sanitización HTML.
- Se agregaron templates profesionales base (HTML + text) para los escenarios definidos.
- Se incorporó modo seguro `test-mode/dry-run` para evitar envíos accidentales.

## 2. Archivos modificados
- `backend/services/emailService.js` (nuevo)
- `docs/email-service-phase3b.md` (nuevo)
- `docs/resend-audit.md` (nota de continuidad)

## 3. Servicio centralizado
Función base:
- `sendTransactionalEmail({ to, subject, html, text, replyTo, type, metadata, testMode })`

Comportamiento:
- valida payload mínimo;
- respeta `EMAILS_ENABLED`;
- aplica `EMAIL_TEST_MODE` y/o entorno no productivo;
- redirige en test a `EMAIL_TEST_RECIPIENT`;
- devuelve objeto estándar:
  - `ok`
  - `skipped`
  - `dryRun`
  - `provider`
  - `providerMessageId`
  - `error`

## 4. Funciones disponibles
- `sendOrderReceivedEmail(order, customer)`
- `sendPaymentApprovedEmail(order, customer)`
- `sendOrderPreparingEmail(order, customer)`
- `sendOrderShippedEmail(order, customer)`
- `sendInvoiceAvailableEmail(order, customer)`
- `sendWholesaleRequestReceivedEmail(requestOrCustomer)`
- `sendWholesaleApprovedEmail(requestOrCustomer)`
- `sendWholesaleRejectedEmail(requestOrCustomer)`
- `sendPasswordResetEmail(user, resetLink)`
- `sendContactFormEmail(data)`

## 5. Templates disponibles
Se implementaron templates base compatibles con clientes de correo:
- layout común con header, bloque principal, card de datos y footer;
- CTA opcional;
- versión `text/plain` mínima por cada template.

## 6. Helpers de formato
- `escapeHtml(value)`
- `formatCurrencyARS(value)`
- `formatDate(value)`
- `formatPaymentMethod(value)`
- `formatPaymentStatus(value)`
- `formatOrderStatus(value)`
- `formatShippingStatus(value)`
- `formatInvoiceStatus(value)`
- `formatCustomerName(value)`
- `formatOrderNumber(value)`

## 7. Variables de entorno necesarias
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (o fallback `EMAIL_FROM` / `FROM_EMAIL_NO_REPLY`)
- `RESEND_REPLY_TO` (o fallback `EMAIL_REPLY_TO` / `SUPPORT_EMAIL`)
- `APP_BASE_URL` / `PUBLIC_BASE_URL` / `FRONTEND_BASE_URL`
- `WHATSAPP_URL`
- `EMAILS_ENABLED`
- `EMAIL_TEST_MODE`
- `EMAIL_TEST_RECIPIENT`
- `NODE_ENV`

## 8. Modo test / dry-run
- `EMAILS_ENABLED=false` ⇒ no envía (skipped/dryRun).
- `EMAIL_TEST_MODE=true` ⇒ no envía a cliente real; usa `EMAIL_TEST_RECIPIENT`.
- `NODE_ENV !== production` ⇒ comportamiento conservador: modo test por defecto.

## 9. Qué NO se automatizó todavía
- No se conectó ningún envío a eventos reales de pedido/pago/envío/factura/mayoristas.
- No se tocaron webhooks de Mercado Pago.
- No se agregaron logs persistentes ni anti-duplicados globales (queda para FASE 3C).

## 10. Cómo probar sin enviar a clientes reales
1. Configurar:
   - `EMAILS_ENABLED=true`
   - `EMAIL_TEST_MODE=true`
   - `EMAIL_TEST_RECIPIENT=correo-interno@dominio`
2. Invocar funciones desde script interno o test local.
3. Verificar que el subject lleve prefijo `[TEST]` y el destinatario sea el correo interno.

## 11. Riesgos pendientes para FASE 3C
- Convivencia temporal con servicios legacy.
- Falta de capa de auditoría persistente por envío.
- Falta de política unificada de idempotencia para todos los eventos.

## 12. Próximo paso recomendado
- FASE 3C: integrar gradualmente este servicio a eventos reales con idempotencia, logs persistentes y rollout controlado.
