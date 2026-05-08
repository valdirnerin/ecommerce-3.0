# Fix: Resend HTTP 422 por tags inválidos

## Causa real del error
Resend rechazaba algunos envíos con HTTP `422` porque los `tags` incluían caracteres no permitidos (por ejemplo `:`).

Ejemplos reales que rompían:
- `logicalKey: "order_preparing:NRN-080526-2796"`
- `idempotencyKey: "email:order_preparing:NRN-080526-2796"`

## Formato permitido por Resend
Para `tags.name` y `tags.value` solo se permiten caracteres ASCII:
- letras `A-Z` / `a-z`
- números `0-9`
- guion bajo `_`
- guion medio `-`

## Cómo se corrige
En `backend/services/emailService.js` se agregaron helpers:
- `sanitizeResendTagValue(value, maxLength)`
- `buildSafeResendTags(metadata)`

Reglas de sanitización:
1. Convierte a string con trim.
2. Reemplaza caracteres no permitidos por `-`.
3. Compacta guiones repetidos.
4. Recorta largo máximo (`name` 64, `value` 128).
5. Si queda vacío, devuelve `null`.
6. Se excluyen tags inválidos/vacíos antes de llamar a Resend.

## Ejemplo antes/después
- Antes: `order_preparing:NRN-080526-2796`
- Después: `order_preparing-NRN-080526-2796`

- Antes: `email:order_preparing:NRN-080526-2796`
- Después: `email-order_preparing-NRN-080526-2796`

## Idempotencia y logs internos
- `logicalKey` e `idempotencyKey` internos se mantienen en logs/repositorio sin alterar su semántica.
- Solo su representación en `tags` enviados a Resend se sanitiza.
- Se añadió log seguro para errores de envío:

```txt
[email-send-error] { emailType, logicalKey, status, error }
```

Sin exponer `RESEND_API_KEY`, tokens ni secretos.

## Normalización de base URL
Se actualizó `resolveBaseUrl()` para tomar fallbacks:
- `APP_BASE_URL`
- `PUBLIC_BASE_URL`
- `FRONTEND_BASE_URL`
- `PUBLIC_URL`

Y normaliza casos como:
- `nerinparts.com.ar` → `https://nerinparts.com.ar`
- `//nerinparts.com.ar` → `https://nerinparts.com.ar`

Con esto, el enlace de seguimiento queda como `https://nerinparts.com.ar/seguimiento.html`.
