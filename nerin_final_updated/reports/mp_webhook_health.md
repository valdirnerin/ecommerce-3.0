# Mercado Pago Webhook Health Report

| Check | Status | Notes |
| --- | --- | --- |
| MP_ACCESS_TOKEN present | OK | Declared in `.env.example` |
| MP_NOTIFICATION_URL present | OK | Declared and used when creating preferences |
| PUBLIC_URL present | OK | Declared and used for URLs |
| MP_ENV present/consistent | WARN | Placeholder exists; ensure token matches environment |
| preference includes notification_url | OK | Uses `MP_NOTIFICATION_URL` |
| notification_url matches exposed endpoint | OK | Defaults to `/api/webhooks/mp` |
| Webhook endpoint responds 200 quickly | OK | Tested via `verify:mp-webhook` |
| Reintentos e idempotencia de stock | OK | `inventoryApplied` flag prevents double discount |
| x-signature validation | FAIL | No signature check implemented |
| Estado único backend/frontend | OK | Status mapped to `aprobado/pendiente/rechazado` |
| Orden y stock solo en aprobado | OK | Stock applied only on `statusRaw === 'approved'` |
| Logs claros, sin warnings nuevos | OK | Logs show event reception and processing |

