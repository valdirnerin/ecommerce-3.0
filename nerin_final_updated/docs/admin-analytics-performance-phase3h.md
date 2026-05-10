# FASE 3H — Rendimiento de analíticas internas del admin

## Problema detectado
El dashboard de `/admin.html` recargaba todo el árbol DOM y destruía/recreaba gráficos en cada refresh, generando parpadeo, sensación de reset y latencia percibida.

## Endpoints modificados/agregados
- **Nuevo** `GET /api/analytics/live`: respuesta liviana para tiempo real.
- **Modificado** `GET /api/analytics/detailed`: mantiene datos pesados, ahora con cache en memoria por rango.

## Estrategia live vs detailed
- **Live (rápido, 8s):** sesiones activas, checkout en curso, sesiones resumidas, `lastEventAt`, `eventsLastHour`, salud básica y `updatedAt`.
- **Detailed (45s):** gráficos, tendencias, embudos, históricos e ingresos.

## Cache TTL
- `today`: 15s
- `7d`: 30s
- `30d`: 60s
- `custom`: 60s
- `live`: 4s

## Cambios frontend
- Se evita mostrar `Cargando...` en refresh automático si el panel ya está montado.
- Se actualizan tarjetas live por ID sin reset total.
- Se agrega actualización en vivo cada 8s y texto de “Última actualización”.
- Se evita disparar refresh live simultáneos usando flags + AbortController.

## Cambios backend
- Cache en memoria para `/api/analytics/detailed` con key por `range/from/to`.
- Endpoint `/api/analytics/live` con cache corta y lectura optimizada.
- Optimización en `analyticsStore.getEventsByRange` para soportar `skipArchive` y evitar lectura gzip en modo live.
- Logs de performance:
  - `[analytics:live]` con `activeSessions`, `eventsLastHour`, `durationMs`, `cacheHit`.
  - `[analytics:detailed]` con `range`, `durationMs`, `cacheHit`, `eventsCount`.

## Cómo probar
1. Abrir `/admin.html` y entrar a Analytics.
2. Verificar carga inicial completa.
3. Esperar refresh live (8s): confirmar que no se borra el dashboard.
4. Verificar que gráficos no se redibujan cada refresh live.
5. Confirmar en logs `cacheHit`/`durationMs`.
6. Verificar que módulos de checkout/carrito/precios/pedidos no cambian.

## Qué NO se tocó
No se tocó Google Analytics, GA4, Meta Pixel, checkout, carrito, precios, productos, Mercado Pago, Andreani, Resend, emails ni pedidos.

## Próximo paso recomendado
Agregar invalidación selectiva de charts (update datasets en lugar de reconstruir) para también optimizar el refresh detallado.
