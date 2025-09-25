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
- Verificá el dominio remitente en Resend (registros SPF y DKIM) antes de enviar correos en producción.
- Probar envío local: `GET /test-email?to=TU_EMAIL&type=confirmed`.
