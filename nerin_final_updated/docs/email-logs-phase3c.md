# FASE 3C — Email logs e idempotencia

## 1. Objetivo
Agregar trazabilidad e idempotencia local para emails transaccionales antes de conectar eventos reales.

## 2. Qué se implementó
- Repositorio de logs `backend/data/emailLogsRepo.js` con persistencia en `data/emailLogs.json`.
- Wrapper `sendTransactionalEmailOnce(...)` sobre el servicio centralizado de FASE 3B.
- Detección de duplicados por `logicalKey` cuando ya existe `status=sent`.
- Registro de estados: `pending`, `sent`, `failed`, `skipped_duplicate`, `dry_run`, `disabled`, `invalid_recipient`.
- Inclusión de `idempotencyKey` derivada de `logicalKey` en metadata para el provider.

## 3. Archivos modificados
- `backend/services/emailService.js`
- `backend/data/emailLogsRepo.js`
- `data/emailLogs.json`
- `docs/email-logs-phase3c.md`

## 4. Modelo de log
Cada registro guarda:
- `id`
- `logicalKey`
- `emailType`
- `to`
- `subject`
- `provider`
- `providerMessageId`
- `status`
- `dryRun`
- `skipped`
- `errorMessage`
- `orderId`
- `customerId`
- `userId`
- `wholesaleRequestId`
- `metadata` (sanitizada)
- `createdAt`
- `updatedAt`

## 5. Estados posibles
- `pending`
- `sent`
- `failed`
- `skipped_duplicate`
- `dry_run`
- `disabled`
- `invalid_recipient`

## 6. Claves lógicas anti-duplicado
El wrapper acepta `logicalKey` explícita y además provee helper:
- `buildEmailLogicalKey(type, entityId)`

Ejemplos recomendados:
- `order_received:ORDER_ID`
- `payment_approved:ORDER_ID`
- `order_shipped:ORDER_ID`
- `wholesale_approved:REQUEST_ID`

## 7. Funcionamiento de sendTransactionalEmailOnce
1. Normaliza destinatario.
2. Busca `sent` previo por `logicalKey`.
3. Si existe, registra `skipped_duplicate` y retorna skip.
4. Si no existe, crea log `pending`.
5. Llama al envío centralizado.
6. Actualiza log final (`sent/failed/dry_run/disabled/invalid_recipient`).

## 8. Modo test / dry-run
Se respeta FASE 3B:
- `EMAILS_ENABLED=false` → `disabled`.
- `EMAIL_TEST_MODE=true` o `NODE_ENV!=production` → dry-run/test path.
- Nunca obliga envío real en esta fase.

## 9. Uso de idempotency key de Resend
- Se deriva `idempotencyKey = email:${logicalKey}` y se incorpora en metadata del envío.
- Anti-duplicado principal sigue siendo local (logs).

## 10. Qué NO se automatizó todavía
- No se conectó a pedidos, pagos, Mercado Pago, mayoristas, tracking o checkout.
- No se cambiaron flujos existentes en producción.

## 11. Cómo probar sin enviar emails reales
1. Setear `EMAIL_TEST_MODE=true` y `EMAIL_TEST_RECIPIENT`.
2. Llamar `sendTransactionalEmailOnce` con `logicalKey` nueva y validar log.
3. Repetir con la misma `logicalKey` y verificar `skipped_duplicate`.
4. Probar `to` inválido y verificar `invalid_recipient`.

## 12. Riesgos pendientes
- No hay lock distribuido para concurrencia multi-instancia (queda para fase siguiente si hiciera falta).
- La persistencia JSON puede requerir migración a repositorio SQL si aumenta volumen.

## 13. Próximo paso recomendado: FASE 3D
Conectar eventos reales gradualmente usando `logicalKey` estable por entidad y monitoreo de entregas.
