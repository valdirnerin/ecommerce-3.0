# FASE 3E.1 — Notificación interna de pedido recibido

## Objetivo
Enviar notificación interna al admin cuando se crea un pedido web, **sin asumir pago aprobado**.

## Archivos modificados
- `backend/services/emailService.js`
- `backend/server.js`
- `docs/admin-sale-email-phase3e1.md`

## Función creada
- `sendAdminSaleNotificationEmail(order, options)`
  - usa servicio centralizado y `sendTransactionalEmailOnce(...)`.
  - logicalKey actualizada: `admin_order_received_notification:${orderId}`.

## Variables de entorno
- `ADMIN_SALES_EMAIL`
- `ADMIN_SALES_EMAILS`

Si no existen:
- no rompe el pedido;
- retorna `status=disabled` con razón `missing-admin-sales-email`;
- el backend expone `adminSaleEmailWarning`.

## Semántica del email interno
- Asunto: `Nuevo pedido recibido en NERIN Parts — Pedido #{ORDER_ID} — {TOTAL}`
- Mensaje principal:
  - “Se generó un nuevo pedido desde la web.”
  - “Estado del pago: {estado humanizado}”.
  - Si no está aprobado: “Pago pendiente / a confirmar”.
- No afirma “vendiste/cobrado” en esta fase.

## Contenido operativo (se mantiene)
- cliente
- productos
- total
- método y estado de pago
- envío
- fallback Andreani pendiente
- acciones rápidas

## Anti-duplicado
- `admin_order_received_notification:${orderId}`
- segunda ejecución: `skipped_duplicate`.

## FASE 3F (pendiente)
El email de “venta cobrada / pago aprobado” se conecta en FASE 3F al confirmarse pago aprobado por Mercado Pago.

## Testing seguro
- usar `EMAILS_ENABLED=false` o `EMAIL_TEST_MODE=true`.
- no envía email real en pruebas.
- verificar logs en `data/emailLogs.json`.

## Qué NO se tocó
- Mercado Pago/webhook MP
- Andreani (integración)
- Analytics
- precios
- carrito
- lógica de pagos
