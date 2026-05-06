# Auditoría técnica FASE 1 — NERIN Parts

Fecha: 2026-05-05

## 1) Estructura y stack detectado
- **Backend principal:** Node.js + Express (CommonJS), con entrypoints en `backend/server.js` y `backend/index.js`.
- **Frontend principal:** HTML + CSS + JavaScript vanilla en `frontend/` (no Next.js, no React SPA).
- **Datos:** repositorios en `backend/data/*`, con soporte híbrido JSON y SQL según disponibilidad de `db.getPool()`.
- **Pagos:** Mercado Pago activo con webhook en `backend/routes/mercadoPago.js`.
- **Email:** Resend ya está presente en dependencias y en servicios/templates existentes (`src/` y `backend/`).

## 2) Flujo actual de pedidos, checkout y pagos
- El checkout envía pedidos al backend por rutas `/api/orders` y `/api/checkout` (servidor Express).
- Las órdenes se persisten y normalizan desde `backend/data/ordersRepo.js`.
- El webhook de Mercado Pago actualiza estado de pago y aplica lógica de inventario desde `backend/routes/mercadoPago.js`.
- El panel admin consume `/api/orders` con resumen/filtros básicos ya implementados.

## 3) Ubicación de dominios clave
- **Pedidos:** `backend/data/ordersRepo.js`.
- **Facturas:** `backend/data/invoicesRepo.js`.
- **Clientes/usuarios:** `backend/data/clientsRepo.js` + endpoints auth en backend.
- **Estados de pago:** utilidades en `backend/utils/paymentStatus.js` + uso en repo/webhook.
- **Estados de envío:** utilidades en `backend/utils/shippingStatus.js` y consumo en frontend cuenta/admin.
- **Admin frontend:** `frontend/admin.html` + `frontend/js/admin.js`.
- **Cuenta / Mis pedidos:** `frontend/js/account.js`, `frontend/js/account-minorista.js`, `frontend/js/order-status.js`.

## 4) Hallazgos importantes para las próximas fases
1. **No React en frontend principal:** no aplica instalar `lucide-react` directamente sin migración; conviene usar **Lucide vía SVG/JS compatible con vanilla** o crear una capa de componentes UI en el stack actual.
2. **Webhook MP ya existe y es crítico:** cualquier ajuste debe conservar idempotencia y evitar duplicados de email/evento purchase.
3. **Resend parcialmente implementado:** se debe unificar en un único servicio backend para trazabilidad (`EmailLog`) y plantillas estandarizadas.
4. **Shipping Andreani aún no está modularizado:** falta crear servicio dedicado y endpoints internos.
5. **Analytics ecommerce:** hay tracking actual, pero se requiere estandarización completa GA4/GTM con `dataLayer` y control anti-duplicado en `purchase`.

## 5) Plan de implementación seguro (sin romper checkout actual)
- **Fase 2 (UI estados):** crear badges reutilizables en vanilla JS/CSS (`OrderStatusBadge`, `PaymentStatusBadge`, `ShipmentStatusBadge`) y usarlos en admin + cuenta.
- **Fase 3 (Resend):** consolidar `backend/services/emailService.js`, mover templates y registrar logs de envío.
- **Fase 4 (MP webhook):** reforzar transición a `PAYMENT_APPROVED`, deduplicación por `payment_id/order_id`, y disparo único de email + purchase.
- **Fase 5 (Andreani):** implementar `backend/services/andreaniService.js` y endpoints quote/create/track.
- **Fase 6 (GA4/GTM):** definir capa única `dataLayer.push` y eventos ecommerce obligatorios en los puntos reales del funnel.
- **Fase 7 (Admin):** ampliar tabla, filtros y acciones operativas.
- **Fase 8 (Seguridad):** validación estricta webhooks, recálculo backend de totales y logging estructurado de errores externos.

## 6) Decisiones de compatibilidad
- Se prioriza enfoque incremental sobre arquitectura actual para evitar regresiones en:
  - checkout
  - carrito
  - Mercado Pago
  - login
  - panel admin
  - catálogo/productos

