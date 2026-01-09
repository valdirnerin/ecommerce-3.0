# Ordenes y logistica

Esta actualización agrega persistencia básica de pedidos y soporte de seguimiento.

## Nuevos archivos
- `data/order_items.json`: almacena las líneas de cada pedido.

## Endpoints
- `POST /api/orders` crea la preferencia y guarda el pedido en `orders.json` y sus
  líneas en `order_items.json`.
- `GET /api/orders?payment_status=` lista pedidos para el panel admin con
  filtros `all|pending|approved|rejected`.
- `POST /api/track-order` devuelve datos de seguimiento de un pedido.
- `PUT /api/orders/:orderNumber/ship` registra transportista y seguimiento.
- `PUT /api/orders/:orderNumber/cancel` marca un pedido como cancelado.
- Webhook `/api/webhooks/mp` actualiza `payment_status` y descuenta stock una
  sola vez.
- `GET /meta-feed.csv` entrega el feed de productos para Meta Commerce Manager.
- `GET /meta-feed/health` devuelve el estado del feed (cantidad total y con stock).

## Feed Meta (Commerce Manager)

### URL pública del feed
- `https://<tu-dominio>/meta-feed.csv`

### Campos incluidos (CSV)
`id,title,description,availability,condition,price,link,image_link,brand,gtin,mpn`

### Cómo cargarlo en Meta
1. En Meta Commerce Manager ir a **Catalog > Data sources > Scheduled feed**.
2. Usar la URL del feed anterior.
3. Programar la frecuencia (recomendado cada día).

### Probar localmente
```bash
curl -s http://localhost:3000/meta-feed.csv | head -n 3
```
```bash
curl -s http://localhost:3000/meta-feed/health | jq
```

## Prueba rápida
1. Crear una orden:
   ```bash
   curl -s -X POST http://localhost:3000/api/orders \
     -H 'Content-Type: application/json' \
     -d '{"productos":[{"id":"1","name":"Pantalla","price":100,"quantity":1}],"cliente":{"email":"a@b.com"}}'
   ```
2. Verla en el listado:
   ```bash
   curl -s http://localhost:3000/api/orders | jq
   ```
3. Simular webhook aprobando el pago:
   ```bash
   curl -s -X POST http://localhost:3000/api/webhooks/mp \
     -H 'Content-Type: application/json' \
     -d '{"data":{"id":"PAYID"}}'
   ```
4. Seguir el pedido:
   ```bash
   curl -s -X POST http://localhost:3000/api/track-order \
     -H 'Content-Type: application/json' \
     -d '{"email":"a@b.com","id":"<NRN>"}' | jq
   ```

## Emails (Resend)

- Configurá las variables en tu `.env`:
  - `RESEND_API_KEY`: API key de Resend con permisos para enviar emails.
  - `FROM_EMAIL`: remitente verificado que verán los clientes.
  - `SUPPORT_EMAIL`: casilla que recibirá respuestas o consultas.
  - `RESEND_WEBHOOK_SECRET`: secret del webhook inbound configurado en Resend.
- Verificá el dominio remitente en Resend (registros SPF y DKIM) antes de enviar correos en producción.
- Probar envío local: `GET /test-email?to=TU_EMAIL&type=confirmed`.

### Inbound (email.received)

- Webhook público: `POST /api/webhooks/resend`.
- El endpoint valida la firma Svix (`svix-id`, `svix-timestamp`, `svix-signature`) usando
  el `RESEND_WEBHOOK_SECRET` y luego consulta el email recibido con
  `resend.emails.receiving.get(email_id)`.

#### Cómo probar en Render
1. Configurá en Render:
   - `RESEND_API_KEY`
   - `RESEND_WEBHOOK_SECRET`
2. En Resend, configurá el webhook de inbound con el evento `email.received`
   apuntando al URL público de Render `/api/webhooks/resend`.
3. Enviá un email a `test@diadol.resend.app`.
4. Revisá los logs de Render: deberían verse `from`, `to`, `subject`,
   `created_at` y el contenido `html/text`.
