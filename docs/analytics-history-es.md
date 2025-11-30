# Historial y métricas de analíticas (NERIN)

Este resumen explica cómo funciona la persistencia de analíticas incorporada en `nerin_final_updated/backend/server.js` para que puedas verificar qué datos se guardan y dónde quedan almacenados.

## Qué se guarda
- **Eventos de tracking** (`/api/analytics/track`): cada evento se registra en memoria y también se copia en `analytics_history.json` para no perder datos entre deploys.
- **Sesiones y tráfico por hora**: se conservan contadores de sesiones activas, visitas totales y tráfico horario para sostener los gráficos aunque se purgue la RAM.
- **Embudo y pasos de checkout**: se almacenan pasos relevantes (inicio, catálogo, producto, carrito, checkout) evitando duplicar el conteo cuando el tipo de evento y la URL ya indican checkout.

## Dónde se almacena
- El archivo principal es `analytics_history.json` dentro del directorio de datos configurado (`DATA_DIR`).
- Si usas Render, el disco persistente debe montarse y apuntarse en la variable `DATA_DIR` (por defecto, el repo local si no hay disco persistente).
- El servidor indica en logs si detecta un directorio persistente o solo local.

## Retención y peso de los datos
- La historia conserva hasta **35 días** (`MAX_ANALYTICS_HISTORY_DAYS`) para equilibrar rendimiento y visibilidad semanal/mensual.
- Se limita el número de IDs de sesión guardados (`MAX_HISTORY_SESSION_IDS = 2000`) para que el archivo no crezca sin control.
- Los eventos en memoria se podan a **7 días** para que la RAM no crezca; los contadores resumidos quedan en el historial persistente.

## Cómo consultar y ajustar
- La ruta `/api/analytics/detailed` ya mezcla datos en vivo y el historial guardado para devolver métricas consistentes.
- Puedes reducir o ampliar la retención cambiando las constantes en `server.js`:
  - `MAX_ANALYTICS_HISTORY_DAYS` para días retenidos en disco.
  - `MAX_HISTORY_SESSION_IDS` para limitar IDs de sesión guardados.
  - `ACTIVITY_SESSION_RETENTION_MS` y `MAX_ACTIVITY_EVENTS`/`MAX_ACTIVITY_SESSIONS` para la ventana en memoria.

Con estas pautas deberías obtener estadísticas semanales/mensuales más estables sin sacrificar rendimiento ni ocupar demasiado espacio en disco.
