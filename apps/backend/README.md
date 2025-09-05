# Backend

Servidor Express que expone las API necesarias para el flujo de pago. Migrado desde `legacy/backend_orig` a `apps/backend` como parte de la estructura unificada.

## Desarrollo

Desde la raíz del proyecto:

```bash
npm start
```

Las pruebas automatizadas se ejecutan con:

```bash
npm test
```

## Variables de entorno

- `MP_ACCESS_TOKEN`
- `WEBHOOK_SECRET`
- `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`
- `PUBLIC_URL`
