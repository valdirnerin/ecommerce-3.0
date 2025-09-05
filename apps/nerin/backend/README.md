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

## Reconciliación de pagos

Si un webhook final no llega, se puede reconciliar el estado y stock en forma
idempotente:

- Revisar las últimas 24 h:
  ```bash
  npm run mp:reconcile
  ```
- Reconciliar una orden específica por `payment_id` o `external_reference`:
  ```bash
  npm run mp:reconcile -- --payment 123456789
  npm run mp:reconcile -- --order NRN-0001
  ```

El comando consulta la API de Mercado Pago y actualiza la orden aplicando o
revirtiendo stock solo una vez.
