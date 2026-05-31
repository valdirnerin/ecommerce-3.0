# Render + SQLite Optimization (sin PostgreSQL pago)

## Objetivo

Mantener NERINParts en Render usando SQLite con Persistent Disk, sin migrar a PostgreSQL pago ni cambiar de hosting. Esta optimización prioriza estabilidad, bajo costo y compatibilidad con checkout, catálogo, stock, pedidos, Mercado Pago y Resend.

## Problemas encontrados

- El catálogo convive con varias fuentes: JSON locales para entidades operativas (`data/*.json`), `products.json` como origen de importación y SQLite/search index para consultas rápidas de productos.
- Ya existía protección contra parseos completos de `products.json`, pero el SQLite usaba una ruta derivada de `DATA_DIR`; en Render eso puede terminar en almacenamiento efímero si no se configura explícitamente.
- Los endpoints públicos tenían paginación, pero el límite interno de repositorio no estaba centralizado y admin aceptaba hasta 250 ítems por página.
- El sitemap ya estaba dividido en índice y páginas parciales; faltaba cache persistente en disco para no regenerar XML pesado en caliente después de reinicios.
- Merchant feed tenía cache en memoria, pero no cache en disco. Un restart de Render obligaba a regenerar el TSV.
- Había índices básicos, pero faltaban índices explícitos para `model`, `availability` y combinaciones comunes de búsqueda técnica/modelo/stock/precio.
- No había script operativo de backup rotativo de SQLite en `/var/data/backups`.

## Archivos modificados

- `backend/data/productsSqliteRepo.js`
  - Centraliza SQLite con `DATABASE_PATH`.
  - Mantiene fallback local seguro con `dataPath("products.sqlite")` para desarrollo.
  - Activa WAL, `synchronous=NORMAL`, `busy_timeout=5000` y serialización de operaciones en la conexión compartida.
  - Agrega columna `availability` e índices para SKU, slug, brand, model, category, availability, stock, price y combinaciones críticas.
  - Limita internamente `pageSize` a 100.
  - Registra cierre de conexión ante `SIGINT`/`SIGTERM`.
- `backend/server.js`
  - Reduce el máximo de página admin a 100.
  - Agrega cache en disco para sitemap y Merchant feed usando el directorio persistente de datos.
  - Configura `busy_timeout` también para conexiones SQLite readonly auxiliares.
- `scripts/backup-sqlite.js`
  - Crea backups seguros con checkpoint WAL.
  - Guarda copias rotativas en `/var/data/backups` cuando `DATABASE_PATH=/var/data/nerinparts.sqlite`.
- `package.json`
  - Agrega `npm run backup:sqlite`.

## Configuración recomendada en Render

### Root directory

Configurar el servicio con:

```txt
Root Directory: nerin_final_updated
```

### Build command

```bash
npm install
```

### Start command

```bash
npm start
```

El script `start` ejecuta `node backend/server.js` y no debe correr reconstrucciones pesadas, importaciones ni hotfixes en cada arranque.

### Persistent Disk

Crear un **Persistent Disk** en el servicio de Render:

```txt
Mount path: /var/data
```

### Variables de entorno

Configurar:

```txt
DATABASE_PATH=/var/data/nerinparts.sqlite
DATA_DIR=/var/data
```

`DATABASE_PATH` es la fuente de verdad para SQLite. Si no existe, la app usa un fallback local solo para desarrollo; en producción no conviene depender de ese fallback porque puede quedar en disco efímero.

## Health checks recomendados

- Health liviano para Render:

```txt
/healthz
```

- Readiness real del catálogo:

```txt
/readyz
```

`/healthz` no fuerza lecturas pesadas de catálogo. `/readyz` puede devolver `503` mientras SQLite inicializa o reconstruye.

## Backups

### Crear backup manual

En Render Shell o como Job manual:

```bash
cd /opt/render/project/src/nerin_final_updated
DATABASE_PATH=/var/data/nerinparts.sqlite npm run backup:sqlite
```

Por defecto guarda en:

```txt
/var/data/backups
```

Conserva 7 manifiestos/backups por defecto. Se puede cambiar con:

```txt
SQLITE_BACKUP_KEEP=14
SQLITE_BACKUP_DIR=/var/data/backups
```

### Restaurar backup

1. Detener temporalmente el servicio web en Render o evitar tráfico mientras se restaura.
2. Identificar el backup deseado en `/var/data/backups`, por ejemplo:

```txt
nerinparts-2026-05-31T12-00-00-000Z.sqlite
```

3. Copiar el backup al path principal:

```bash
cp /var/data/backups/nerinparts-YYYY-MM-DDTHH-MM-SS-000Z.sqlite /var/data/nerinparts.sqlite
```

4. Si el backup incluye archivos WAL/SHM asociados, copiarlos también con nombres compatibles:

```bash
cp /var/data/backups/nerinparts-YYYY-MM-DDTHH-MM-SS-000Z.sqlite-wal /var/data/nerinparts.sqlite-wal
cp /var/data/backups/nerinparts-YYYY-MM-DDTHH-MM-SS-000Z.sqlite-shm /var/data/nerinparts.sqlite-shm
```

5. Reiniciar el servicio.
6. Verificar:

```bash
curl https://TU-DOMINIO/readyz
curl https://TU-DOMINIO/api/products?page=1&pageSize=24
```

## Feed y sitemap

- `sitemap.xml` sigue funcionando como sitemap index.
- Productos se dividen en `sitemap-products-N.xml`.
- `sitemap-stock.xml` mantiene cache de stock real.
- Las respuestas XML se cachean en disco bajo el directorio persistente de datos para evitar recomputar en caliente después de reinicios.
- Merchant feed mantiene campos críticos de Google Merchant Center: `availability`, `availability_date`, `preorder`, landing page y datos derivados usados por JSON-LD.
- Merchant feed ahora tiene cache en memoria y disco; la cache en disco sobrevive reinicios si `DATA_DIR=/var/data`.

## Riesgos de SQLite en producción

SQLite en Render con Persistent Disk es válido para una tienda chica/mediana con un solo proceso web, pero tiene límites:

- Una sola escritura fuerte a la vez. WAL mejora lectura concurrente, pero no convierte SQLite en un motor multi-writer.
- No conviene ejecutar múltiples instancias web escribiendo el mismo archivo SQLite.
- Rebuilds grandes de catálogo pueden consumir CPU/IO; deben hacerse con cuidado y fuera de picos de tráfico.
- El Persistent Disk debe estar correctamente montado; sin eso, datos críticos pueden perderse en deploys/restarts.
- Backups son obligatorios. No depender únicamente del archivo principal.

## Cuándo convendría pasar a PostgreSQL en el futuro

Considerar Postgres cuando ocurra una o más de estas condiciones:

- Necesidad de múltiples instancias web escribiendo en paralelo.
- Volumen alto de pedidos, cambios de stock o administración concurrente.
- Catálogo muy grande con búsquedas/filtros que ya no respondan bien con SQLite/FTS5.
- Necesidad de transacciones complejas, auditoría avanzada, roles o replicación.
- Backups/restores y observabilidad requieren herramientas administradas.

Hasta entonces, SQLite + Persistent Disk + WAL + backups rotativos permite mantener Render sin pagar PostgreSQL.
