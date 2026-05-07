# FASE 3A — Auditoría de Resend (estado actual)

## 1) Estado actual de Resend

- **Resend sí está integrado** en el backend actual mediante un servicio central llamado `backend/services/emailNotifications.js` que expone `sendEmail` y funciones específicas por evento (`sendOrderConfirmed`, `sendPaymentPending`, etc.).
- Hay además una **implementación paralela legacy/alternativa** en `backend/index.js` y otra capa en `src/services/send-email.js` (con templates React Email), lo que sugiere coexistencia de caminos y riesgo de fragmentación.
- En la app que corre con `backend/server.js`, el flujo activo está mayormente centralizado en `backend/services/emailNotifications.js` y sus invocaciones desde rutas/eventos del server.

## 2) Archivos encontrados (relevantes)

### Núcleo backend (activo)
- `backend/services/emailNotifications.js` (servicio principal de envío por Resend).
- `backend/server.js` (disparadores por eventos de negocio y endpoints).
- `backend/routes/mercadoPago.js` (webhook/estado MP y envío deduplicado por flags).
- `backend/data/ordersRepo.js` (persistencia de flags en campo `emails` mediante `markEmailSent`).
- `backend/README.md` (variables y webhook inbound documentados).

### Otros módulos relacionados (potencial duplicación)
- `backend/index.js` (usa Resend y endpoint `/test-email` en otra entrada de app).
- `src/lib/resend.js` (cliente Resend en código `src/`).
- `src/services/send-email.js` (envíos con React Email).
- `src/routes/test-email.js` + `src/app.js` (router de testing de email).

### Templates existentes
- HTML legacy: `emails/orderPaid.html`.
- React Email: `src/emails/OrderConfirmedEmail.tsx`, `src/emails/PaymentPendingEmail.tsx`, `src/emails/PaymentRejectedEmail.tsx`.
- Templates inline (string HTML en funciones) dentro de `backend/services/emailNotifications.js`.

## 3) Flujo actual (cómo se disparan mails hoy)

1. **Pago Mercado Pago (webhook)**
   - `backend/routes/mercadoPago.js` mapea estado `approved/pending/rejected` a funciones de email.
   - Antes de enviar, chequea deduplicación por `order.emails.<flag>` y lock en memoria (`inflight`).
   - Si envía ok, persiste `markEmailSent(..., flag, true)`.

2. **Cambios de estado de pedido (admin)**
   - En `backend/server.js`, al cambiar estados se disparan:
     - cancelado de pago → `sendPaymentCancelled`
     - envío preparando → `sendOrderPreparing`
     - envío despachado → `sendOrderShipped`
     - envío entregado → `sendOrderDelivered`

3. **Factura cargada**
   - En `POST /api/orders/:id/invoices`, al adjuntar factura dispara `sendInvoiceUploaded`.

4. **Mayoristas**
   - `POST /api/wholesale/send-code` → `sendWholesaleVerificationEmail`.
   - `POST /api/wholesale/apply` → `sendWholesaleApplicationReceived` + `sendWholesaleInternalNotification`.

5. **Recuperación de contraseña**
   - `POST /api/password/forgot` envía mail al usuario y opcionalmente notificación a soporte usando `sendEmail` genérico.

6. **Inbound de Resend**
   - `POST /api/webhooks/resend` procesa `email.received`, valida firma Svix y consulta `resend.emails.receiving.get(email_id)` para logueo.

## 4) Variables de entorno necesarias (detectadas)

- `RESEND_API_KEY` (clave principal).
- `FROM_EMAIL_NO_REPLY`, `FROM_EMAIL_VENTAS`, `FROM_EMAIL_CONTACTO` (remitentes por tipo).
- `SUPPORT_EMAIL` (reply-to / soporte).
- `WHOLESALE_NOTIFICATION_EMAILS` (destinatarios internos mayoristas).
- `RESEND_WEBHOOK_SECRET` (firma del inbound webhook).

Notas:
- `backend/README.md` todavía menciona `FROM_EMAIL` genérico; el código actual usa variantes `FROM_EMAIL_*`.
- Si falta `RESEND_API_KEY`, el servicio devuelve error `email service not configured`.

## 5) Logs, errores y observabilidad

- Hay logs de configuración (`email-config`) y de procesamiento/skip/fallo en webhook MP.
- Errores de envío se capturan con `try/catch` en múltiples puntos; en varios casos se hace `console.warn/error` y el flujo funcional sigue.
- Inbound webhook también loguea eventos recibidos/ignorados y fallos de fetch.
- **No se detecta** un registro persistente específico de auditoría de emails (tabla/log estructurado dedicado), salvo flags booleanos por tipo en `orders.emails`.

## 6) Riesgos detectados

1. **Duplicación/fragmentación de implementaciones**
   - Conviven `backend/services/emailNotifications.js`, `backend/index.js` y `src/services/send-email.js`.
   - Riesgo: cambios futuros en un módulo no reflejados en otro.

2. **Idempotencia parcial**
   - Muy buena cobertura en webhook MP (flags + inflight lock).
   - En otros flujos (ej. cambios admin o password/wholesale) no hay una estrategia uniforme de deduplicación persistente.

3. **Inconsistencia documental de variables**
   - README menciona `FROM_EMAIL`, código usa `FROM_EMAIL_NO_REPLY/VENTAS/CONTACTO`.

4. **Templates dispersos**
   - Inline HTML + archivo HTML + React Email TSX en paralelo.

5. **Persistencia de trazabilidad limitada**
   - Hay flags por estado de pedido, pero no un histórico completo por intento (timestamp, payload, error code, provider id).

## 7) Matriz de casos solicitados (estado actual)

- **Registro de usuario:** no se encontró envío de bienvenida explícito.
- **Solicitud mayorista:** **sí** (confirmación al solicitante + notificación interna).
- **Aprobación mayorista:** no se identificó email explícito de aprobación final en el flujo auditado.
- **Pedido recibido:** **sí**, vía `sendOrderConfirmed` en transición a pago aprobado.
- **Pago aprobado:** **sí** (mismo evento anterior).
- **Pedido enviado:** **sí** (`sendOrderShipped`).
- **Factura disponible:** **sí** (`sendInvoiceUploaded`).
- **Recuperación de contraseña:** **sí** (`/api/password/forgot`).
- **Formulario de contacto:** no se detectó envío de email transaccional asociado al form público de contacto.

## 8) Mejoras recomendadas (sin implementar en FASE 3A)

1. **Mantener un único servicio canónico de email** (siguiente fase): conservar `backend/services/emailNotifications.js` como fuente única y deprecar rutas alternativas.
2. **Normalizar estrategia de idempotencia** para todos los eventos críticos (no solo MP webhook).
3. **Unificar catálogo de templates** (elegir un enfoque y consolidar).
4. **Actualizar documentación de env vars** para que refleje exactamente el código vigente.
5. **Agregar trazabilidad persistente de envíos** (éxito/fallo, tipo, destinatario, provider message id), sin tocar checkout ni lógica de pago.

## 9) Próximos pasos propuestos

### FASE 3B (hardening técnico sin automatizaciones nuevas)
- Consolidar contrato del servicio de emails (API interna única).
- Eliminar o marcar legacy los emisores duplicados.
- Alinear `.env.example` / README con vars reales.

### FASE 3C (plantillas y calidad)
- Estandarizar templates (estructura, branding, textos, placeholders).
- Definir validaciones y fallback homogéneos de remitente/reply-to.

### FASE 3D (automatización controlada)
- Activar nuevos disparadores de negocio faltantes con idempotencia y observabilidad.
- Incorporar métricas/tablero de entregas/fallos/reintentos.

---

## Confirmación de alcance FASE 3A

En esta fase **solo se auditó y documentó** el estado actual de Resend.
No se modificaron checkout, carrito, Mercado Pago, Andreani, Google Analytics, ni base de datos.
No se crearon templates nuevos ni automatizaciones nuevas de correo.

## Nota de continuidad

- El servicio base de FASE 3B quedó implementado en `backend/services/emailService.js` y documentado en `docs/email-service-phase3b.md`.
