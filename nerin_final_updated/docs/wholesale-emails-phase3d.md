# FASE 3D — Emails mayoristas

## 1. Objetivo
Automatizar únicamente emails mayoristas (solicitud recibida, aprobación, rechazo) usando servicio centralizado + logs + anti-duplicados.

## 2. Flujos mayoristas detectados
- Alta de solicitud: `POST /api/wholesale/apply`.
- Listado en admin: `GET /api/wholesale/requests`.
- Actualización de estado (aprobar/rechazar): `PATCH /api/wholesale/requests/:id`.

## 3. Endpoints/funciones tocadas
- `backend/server.js`
  - bloque `POST /api/wholesale/apply`
  - bloque `PATCH /api/wholesale/requests/:id`
- `backend/services/emailService.js` (reutilizado, sin crear servicio paralelo)
- `backend/data/emailLogsRepo.js` (reutilizado para trazabilidad)

## 4. Emails conectados
1. Solicitud mayorista recibida.
2. Cuenta mayorista aprobada.
3. Cuenta mayorista rechazada.

## 5. Templates usados
Se usan templates del servicio de FASE 3B:
- `sendWholesaleRequestReceivedEmail(...)`
- `sendWholesaleApprovedEmail(...)`
- `sendWholesaleRejectedEmail(...)`

## 6. Logical keys usadas
- `wholesale_request_received:${requestId}`
- `wholesale_approved:${requestId}`
- `wholesale_rejected:${requestId}`

Fallback si faltara ID: se usa email como último recurso (`${current.email}`), pero el flujo actual ya genera `id` de solicitud.

## 7. Manejo de errores
- Fallo de email **no rompe** el flujo principal.
- Se devuelve operación principal exitosa si la acción de negocio fue exitosa.
- Se agrega `emailWarning` en respuesta cuando corresponde.
- Logs y anti-duplicado quedan en `sendTransactionalEmailOnce` + `emailLogsRepo`.

## 8. Modo test/dry-run
- Respetado por `emailService` (`EMAILS_ENABLED`, `EMAIL_TEST_MODE`, `EMAIL_TEST_RECIPIENT`, `NODE_ENV`).
- En pruebas de esta fase se usó modo seguro sin envío real.

## 9. Cómo probar
1. Enviar solicitud mayorista (`/api/wholesale/apply`) con `EMAILS_ENABLED=false`.
   - Debe crear solicitud y registrar email con logical key de solicitud.
2. Aprobar solicitud (`PATCH ... status=approved`, `notifyApplicant=true`).
   - Debe persistir estado y registrar email `wholesale_approved`.
3. Rechazar solicitud (`PATCH ... status=rejected`, `notifyApplicant=true`).
   - Debe persistir estado y registrar email `wholesale_rejected`.
4. Repetir la misma acción para validar `skipped_duplicate`.

## 10. Qué NO se tocó
- Checkout, carrito, Mercado Pago, webhooks MP, Andreani, Analytics, pedidos/pagos/tracking.
- No se conectaron otros eventos de email fuera de mayoristas.

## 11. Riesgos pendientes
- Si hay despliegue multi-instancia, puede requerirse lock distribuido además del log local.
- El fallback de logical key por email queda solo como contingencia.

## 12. Próximo paso recomendado: FASE 3E
Extender automatizaciones a otros eventos (pedidos/pagos/facturas/tracking) reutilizando logical keys y políticas de idempotencia.
