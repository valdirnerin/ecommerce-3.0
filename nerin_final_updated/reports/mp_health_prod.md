# Mercado Pago Production Health Check

Date: 2025-08-28

## Self-Probe

```
{
  "handler_200": true,
  "signature_valid": true,
  "mp_lookup_ok": false,
  "final_status": null,
  "stock_delta": 0,
  "idempotent": true
}
```

## Health Endpoint

Request: `GET /ops/health/mp-webhook?token=****`

```
{"handler_200":true,"signature_valid":true,"mp_lookup_ok":false,"final_status":null,"stock_delta":0,"idempotent":true}
```

## Checklist

| Check | Status | Notes |
| --- | --- | --- |
| Reachability (`verify:mp-prod`) | FAIL | fetch ENETUNREACH (curl OK) |
| Self-probe (`mp:self-probe`) | OK | signature validated, MP lookup omitted |
| Signature validation | OK | secret present; signed probe |
| Preferences/notification_url | OK | uses production `MP_NOTIFICATION_URL` |
| Events (payments & merchant_orders) | OK | `processNotification` covers both |
| Status mapping | OK | shared `mpStatusMap.js` |
| Idempotent order update | OK | `upsertOrder` deduplicates by id |
| Stock descontado una sola vez | OK | `inventoryApplied` flag |
| Real payment log | TODO | no payment captured |

Health endpoint disabled (`ENABLE_MP_WEBHOOK_HEALTH=0`) after this check.
