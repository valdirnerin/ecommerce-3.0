# Admin manual transfer payment emails

## Endpoint tocado
- `PUT/PATCH /api/orders/:id` en `backend/server.js`.
- Es el endpoint usado por la sección **Actualizar pedido** del admin (`frontend/js/admin.js` hace `fetch` a `/api/orders/{id}` con método `PUT`).

## Qué se corrigió
Cuando desde admin cambia el estado de pago de un pedido a aprobado/pagado, ahora el backend evalúa transición real y dispara los mismos mails idempotentes que usa Mercado Pago:

- Cliente: `sendPaymentApprovedEmail(order, customer)` con logical key `payment_approved:${orderId}`.
- Interno admin: `sendAdminSalePaidNotificationEmail(order, options)` con logical key `admin_sale_paid_notification:${orderId}`.

## Detección de transición
En el update de pedido:
1. Se toma el estado anterior (`prevPaymentCode`).
2. Se normaliza el estado nuevo (`nextPaymentCode`).
3. Solo dispara emails si:
   - llegó un cambio de estado de pago (`incomingStatus != null`), y
   - `prevPaymentCode !== "approved"`, y
   - `nextPaymentCode === "approved"`.

Si no hay transición real, se loguea:
- `[email-payment-approved-admin] skipped no transition`

## Idempotencia y no duplicados
Se usan las mismas keys lógicas que MP webhook:
- `payment_approved:${orderId}`
- `admin_sale_paid_notification:${orderId}`

Como `emailService.sendTransactionalEmailOnce(...)` consulta `emailLogsRepo` por `logicalKey`, si ya se envió por MP (o por admin), el siguiente intento queda como `skipped_duplicate` y no se reenvía.

## Metadata agregada
Ambos envíos incluyen metadata:

```json
{
  "source": "admin_manual_transfer_payment",
  "paymentMethod": "Transferencia bancaria" | "<método detectado>" | null
}
```

Para transferencia, se fuerza humanización a `Transferencia bancaria`.

## Manejo de fallos sin romper guardado
- Si falta email cliente: no rompe el update; `sendTransactionalEmailOnce` registra `invalid_recipient` y se devuelve warning controlado.
- Si falta `ADMIN_SALES_EMAIL`/`ADMIN_SALES_EMAILS`: no rompe; el envío interno devuelve estado no exitoso y se agrega warning.
- Si falla Resend: no rompe; se captura error y se agrega warning.

## Logs de diagnóstico agregados
- `[email-payment-approved-admin] sending`
- `[email-payment-approved-admin] result`
- `[email-payment-approved-admin] error`
- `[email-payment-approved-admin] skipped no transition`

Sin secretos ni payload sensible.

## Alcance (qué NO se tocó)
No se modificó:
- checkout
- carrito
- precios
- productos
- Andreani
- Analytics
- flujo Mercado Pago ni creación de preferencia MP

## Prueba recomendada (EMAILS_ENABLED=false)
1. Configurar `EMAILS_ENABLED=false`.
2. Caso A: pedido transferencia pendiente → admin cambia a pagado → verificar intentos de:
   - `payment_approved:${orderId}`
   - `admin_sale_paid_notification:${orderId}`
3. Caso B: guardar otra vez en pagado → verificar `skipped no transition` o `skipped_duplicate`.
4. Caso C: pedido ya pagado previo → no disparar.
5. Caso D: quitar email cliente → no rompe guardado, warning controlado.
6. Caso E: sin `ADMIN_SALES_EMAIL(S)` → no rompe guardado, warning controlado.
7. Caso F: webhook MP approved sigue funcionando igual (sin cambios en ruta MP).
