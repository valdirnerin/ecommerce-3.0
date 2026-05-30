# Auditoria NERINParts

> **Alcance:** auditoria tecnica y remediacion segura de produccion dentro de `nerin_final_updated`. Este PR evita cambios destructivos en checkout, Mercado Pago, admin, `.env` y datos reales.
>
> **Resultado aplicado:** limpieza del comando `start`, healthchecks `/healthz` y `/readyz`, limite de body size, cache corto para catalogo/busqueda/feeds, facets opcionales con `includeFacets=1`, sitemap de stock real y checklist de deploy Render.

## Prioridad Ejecutiva

Los 5 riesgos mas urgentes son:

1. **Startup mutante:** `package.json` ejecuta scripts de parcheo/hotfix antes de levantar el servidor. Eso vuelve fragil cada deploy y puede hacer que Render muera antes de escuchar el puerto.
2. **Memoria Render:** `--max-old-space-size=512`, SQLite, buffers, streams, Sharp, XLSX, feeds y strings grandes compiten dentro del mismo proceso.
3. **Endpoints publicos sin cache:** `/api/products` y el frontend fuerzan `no-store`, impidiendo cachear el catalogo aunque sea por segundos.
4. **Feeds y sitemaps en runtime:** Merchant feeds, Meta feed, sitemaps y paginas SEO pueden leer/consultar catalogo bajo demanda; bots pueden disparar trabajo caro.
5. **Logs sensibles y ruidosos:** hay logs de productos, checkout, carrito, cuerpos de request y analytics que afectan performance, privacidad y lectura operativa.

## 1. Problemas Criticos Encontrados

### Backend con entrypoints confusos

- **Hecho observado:** `package.json` declara `"main": "backend/index.js"`, pero `start` ejecuta `backend/server.js`.
- **Impacto:** un desarrollador puede editar el Express viejo (`backend/index.js`) creyendo que es produccion, cuando Render ejecuta el servidor HTTP manual.
- **Recomendacion:** dejar un solo entrypoint documentado y reducir `backend/index.js` a compatibilidad o retirarlo cuando sea seguro.

### `backend/server.js` concentra demasiadas responsabilidades

- **Hecho observado:** `backend/server.js` concentra catalogo, busqueda, admin, checkout, Mercado Pago, analytics, uploads, sitemaps, Merchant feeds, Meta feed, SSR de producto y SSR de shop.
- **Impacto:** cualquier cambio pequeno exige leer miles de lineas y aumenta el riesgo de romper checkout, admin o SEO por accidente.
- **Recomendacion:** modularizar por dominios en fases, manteniendo URLs y contratos de respuesta.

### Scripts de parcheo en produccion

- **Hecho observado:** el `start` ejecuta `scripts/applyCodexSeoBulkPatch.js` y `scripts/applySitemapHotfix.js` antes del servidor.
- **Impacto:** el codigo que corre en Render puede diferir del repo, el arranque se vuelve mas lento y una falla en un script deja la web abajo.
- **Recomendacion:** quitar scripts mutantes del `start`; los hotfixes deben estar aplicados al codigo fuente o eliminados.

### Ruteo manual y duplicaciones

- **Hecho observado:** el servidor resuelve rutas con muchas condiciones `pathname === ...` y contiene una ruta temprana de sitemap-hotfix ademas de handlers historicos posteriores.
- **Impacto:** es facil crear rutas pisadas, comportamientos distintos segun orden y bugs dificiles de localizar.
- **Recomendacion:** separar routers/handlers por area: productos, busqueda, sitemaps, feeds, SSR, checkout, admin y analytics.

### Seguridad y privacidad pendientes

- **Hecho observado:** hay logs de checkout y carritos; `.env.example` fue marcado como sospechoso de contener una clave con formato real; hay parsing manual de body sin limite global.
- **Impacto:** riesgo de PII en logs, payloads grandes en memoria y credenciales mal higienizadas.
- **Recomendacion:** rotar credenciales sospechosas, reemplazar valores reales por placeholders y centralizar `parseBody` con limite.

## 2. Consumo De Memoria Y Caidas En Render

### Start command riesgoso

- **Hecho observado:** `start` usa `node --max-old-space-size=512 -r ./backend/utils/preloadProductAvailability.js backend/server.js`.
- **Impacto:** 512 MB de heap no equivalen a 512 MB totales. SQLite, librerias nativas, buffers, strings grandes y streams consumen memoria fuera del heap de V8.
- **Recomendacion:** medir RSS real en Render y bajar margen de heap si el plan es chico. Evitar trabajo previo al listen.

### Rebuild SQLite ligado al runtime

- **Hecho observado:** al iniciar, `productsSqliteRepo.ensureProductsDbInBackground("startup-after-listen")` puede reconstruir o validar catalogo.
- **Impacto:** durante rebuild/indexacion, trafico real, Googlebot o Merchant Center compiten con CPU/memoria del mismo servicio.
- **Recomendacion:** mover rebuilds grandes a job o comando operativo; el servidor web debe servir ultimo SQLite valido y reportar estado en `/readyz`.

### Fallbacks a JSON completo

- **Hecho observado:** existen guardas para catalogo grande, pero todavia hay fallbacks que pueden llamar `loadProducts()` o leer `products.json` en rutas SSR o legacy.
- **Impacto:** si SQLite inicializa o falla, una ruta publica puede intentar cargar/filtrar catalogo completo y disparar memoria.
- **Recomendacion:** en produccion, fallar controlado o mostrar estado minimo antes que cargar todo JSON.

### Feeds, sitemaps y TSV en memoria

- **Hecho observado:** los feeds Merchant/Meta y sitemaps arman strings grandes (`rows`, CSV/TSV/XML) en request.
- **Impacto:** bots y fetchers externos pueden ejecutar trabajo caro en paralelo y elevar memoria rapidamente.
- **Recomendacion:** generar feeds/sitemaps offline o cachearlos en DATA_DIR; servir ultimo artefacto valido.

### Logs excesivos

- **Hecho observado:** hay `console.log/info/warn` para productos, filtros, checkout, carrito, cuerpos crudos y analytics.
- **Impacto:** mas I/O, mas ruido, mas latencia y mayor riesgo de datos sensibles en logs.
- **Recomendacion:** dejar logs estructurados, cortos y sin PII; activar debug solo por flag y fuera de produccion.

## 3. Endpoints Pesados

### `/api/products`

- **Hecho observado:** usa SQLite/search index, pagina productos, calcula totales/facets y responde con `Cache-Control: no-store`.
- **Impacto:** cada navegacion del catalogo pega al backend; no hay cache compartido para trafico publico.
- **Recomendacion:** cache publico corto para listados sin datos privados; facets opcionales con `includeFacets=1`.

### `/api/search`

- **Hecho observado:** delega en `productsSqliteRepo.queryProducts()` con ranking y candidatos.
- **Impacto:** busquedas frecuentes pueden ordenar candidatos en memoria y recalcular facets.
- **Recomendacion:** priorizar exact match por SKU/codigo/MPN, limitar candidatos y cachear busquedas populares cortas.

### `/api/admin/products`

- **Hecho observado:** comparte infraestructura con catalogo publico, pero agrega filtros admin, visibilidad, missing fields y auditorias.
- **Impacto:** admin puede competir con tienda publica y checkout.
- **Recomendacion:** mantener `no-store` aqui, pero separar ruta/admin service y evitar que tareas masivas bloqueen trafico publico.

### Merchant feeds

- **Endpoints:** `/merchant-feed.tsv`, `/merchant-feed-debug.json`, `/api/merchant/screens-feed.csv`, `/google-merchant-screens-feed.csv`, `/api/merchant/screen-adhesives-feed.csv`, `/google-merchant-screen-adhesives-feed.csv`.
- **Impacto:** pueden escanear muchos productos y construir archivos grandes en memoria.
- **Recomendacion:** generacion offline/cacheada con ultimo feed valido y health/debug liviano.

### Meta feed

- **Endpoint:** `/meta-feed.csv`.
- **Hecho observado:** ya bloquea catalogos grandes, lo cual es positivo.
- **Recomendacion:** aplicar el mismo criterio a Merchant feeds y sitemaps grandes.

### Sitemaps

- **Endpoints:** `/sitemap.xml`, `/sitemap-static.xml`, `/sitemap-products-*.xml`.
- **Impacto:** estan mejor que un sitemap unico, pero siguen consultando/armando XML en runtime.
- **Recomendacion:** cachear sitemaps generados y separar `sitemap-stock.xml`, categorias SEO y productos por prioridad.

### SSR publico

- **Endpoints:** `/shop.html`, `/shop`, `/p/:slug`.
- **Impacto:** `shop` puede caer a fallback JSON si SQLite falla; producto SSR es bueno para SEO, pero bots masivos pueden llenar caches y memoria.
- **Recomendacion:** evitar fallback completo en produccion, limitar cache de producto y mantener canonical unico.

## 4. SEO Mal O Incompleto

### Base positiva

- Existe SSR real para `/p/:slug`, con `Product`, `Offer`, canonical, Open Graph, Twitter y breadcrumbs.
- Existe sitemap paginado y robots dinamico.
- Hay logica de SEO organico y Merchant feed.

### Problemas principales

- **URLs duplicadas:** conviven `/p/:slug` y `product.html?id=...`.
- **Canonical de filtros:** `/shop.html` puede construir canonical con query params. Esto puede indexar combinaciones de filtros sin valor SEO.
- **Sitemap incompleto comercialmente:** falta separar productos con stock real, categorias estrategicas y landings comerciales.
- **Merchant feed sensible:** productos sin imagen/precio/slug o con disponibilidad mal mapeada pueden perjudicar Merchant Center.
- **Offer con precio 0:** si falta precio y se emite `0.00`, puede dañar SEO/Merchant.
- **Tracking contaminado:** GA4/Meta hardcodeado en admin puede mezclar trafico interno con trafico comercial.

### Recomendaciones SEO

- Usar `/p/:slug` como canonical unico de producto.
- Dejar `product.html?id=` como compatibilidad, no como URL indexable principal.
- Noindex para busquedas internas y filtros no estrategicos.
- Crear categorias/landings SEO reales: pantallas, baterias, modulos, tapas, flex, adhesivos, repuestos Samsung, stock real, envios.
- Crear `sitemap-stock.xml` para productos con stock real.
- Generar feeds Merchant desde datos validados y cacheados.

## 5. Problemas Que Afectan La Conversion

### Catalogo lento o inestable

- **Hecho observado:** la tienda depende de `/api/products` sin cache y de SQLite/search index.
- **Impacto cliente:** demora, errores de carga o catalogo vacio reducen confianza y compras.
- **Recomendacion:** cache corto, respuesta estable y fallback visual controlado.

### Filtros incompletos

- **Hecho observado:** `frontend/js/shop.js` inicializa filtros/facets segun respuesta actual.
- **Impacto cliente:** el usuario puede no ver todo el universo de opciones, o sentir que el catalogo es chico/desordenado.
- **Recomendacion:** facets desde backend, cacheadas y opcionales.

### Stock, precio y disponibilidad necesitan mas claridad

- **Hecho observado:** existe logica de stock real, remoto, preorder/backorder y disponibilidad.
- **Impacto cliente:** si la card no diferencia compra inmediata vs pedido remoto, baja la decision de compra.
- **Recomendacion:** priorizar productos con stock real, CTA especifico y mensajes claros de envio/garantia.

### Logs/debug en frontend

- **Hecho observado:** `shop.js`, `product.js` y checkout tienen logs visibles en consola.
- **Impacto cliente:** no siempre afecta UX directa, pero ensucia diagnostico, puede exponer datos y baja calidad percibida si hay errores.
- **Recomendacion:** remover logs de produccion o activarlos por flag.

### Checkout depende de resolucion backend de productos

- **Hecho observado:** el backend vuelve a resolver productos antes de crear preferencia MP.
- **Impacto:** es correcto para seguridad de precio, pero si catalogo inicializa/falla, el checkout puede fallar aunque el carrito se vea bien.
- **Recomendacion:** no tocar checkout en Fase 1 salvo logs/body limits; agregar metricas de errores.

### Medicion comercial contaminada

- **Hecho observado:** analytics y pixels aparecen en varias paginas, incluso admin.
- **Impacto:** conversion rate falso, retargeting a usuarios internos y decisiones comerciales malas.
- **Recomendacion:** excluir admin/cuenta/checkout interno segun corresponda y unificar tracking.

## 6. Archivos Que Habria Que Tocar

### Alta prioridad, Fase 1

- `package.json`: limpiar `start`, retirar scripts mutantes y ajustar memoria con medicion.
- `backend/server.js`: reducir logs, cache headers, body limits, healthchecks, evitar fallback JSON completo.
- `backend/data/productsSqliteRepo.js`: facets opcionales/cacheadas, conteos y ranking mas controlados.
- `backend/data/productsStreamRepo.js`: mantener solo como fallback controlado/diagnostico, no como camino publico caro.
- `backend/utils/merchantFeed.js`: validar datos, separar generacion de servido.
- `frontend/js/shop.js`: evitar `no-store` cuando no corresponde y consumir facets de forma estable.
- `frontend/js/product.js`: limpiar logs y asegurar canonical/slug.
- `frontend/js/checkout-steps.js` y `frontend/js/checkout.js`: solo logs/body/telemetria; no cambiar flujo de pago.

### Media prioridad

- `backend/utils/productSeo.js`
- `backend/utils/organicSeo.js`
- `backend/utils/productAvailability.js`
- `frontend/js/index.js`
- `frontend/js/cart.js`
- `frontend/js/analytics.js`
- `frontend/js/analytics-autotrack.js`
- HTMLs con GA4/Meta hardcodeados, especialmente `frontend/admin.html`.

### No tocar al inicio salvo necesidad

- `backend/routes/mercadoPago.js`
- preferencias y webhook de Mercado Pago
- logica de ordenes/inventario asociada a pagos
- admin bulk/importacion masiva
- datos reales, `.env`, archivos persistentes de Render

## 7. Plan De Refactor En Fases Chicas

### Fase 1: Estabilidad Render y performance publica

Objetivo: maximo impacto con minimo riesgo, sin cambiar contratos publicos.

- Quitar scripts de parcheo del `start`.
- Ajustar memoria con medicion real de RSS.
- Reducir logs sensibles y ruidosos.
- Agregar `healthz` liviano y `readyz` con estado de catalogo.
- Cache publico corto para `/api/products` cuando no hay datos privados.
- Hacer facets opcionales.
- Evitar fallback JSON completo en produccion.
- Limitar body size de JSON.
- Poner limites/cache a feeds y sitemaps.

### Fase 2: Modularizacion sin cambiar contratos

- Dejar `server.js` como bootstrap/request dispatcher.
- Extraer rutas a modulos: productos publicos, admin productos, busqueda, sitemaps, feeds, producto SSR, shop SSR, checkout, Mercado Pago, analytics.
- Mantener mismas URLs y response shapes.

### Fase 3: Catalogo, busqueda y facets

- Revisar indices SQLite.
- Usar FTS/search index para busqueda textual.
- Cachear conteos/facets con invalidacion controlada.
- Separar DTO publico y DTO admin.
- Evitar parsear `raw_json` salvo necesidad.

### Fase 4: Feeds y sitemaps offline/cacheados

- Generar Merchant feed, Meta feed y sitemaps con jobs.
- Escribir artefactos en DATA_DIR persistente.
- Servir ultimo archivo valido.
- Exponer estado de ultima generacion en admin/health.

### Fase 5: SEO y conversion

- Canonical unico `/p/:slug`.
- Landings/categorias SEO con intencion comercial.
- `sitemap-stock.xml`.
- Stock real primero.
- CTAs diferenciados por disponibilidad.
- Analytics limpio sin admin y tablero comercial real.

## 8. Riesgos De Romper Checkout, Admin O Mercado Pago

### Checkout

- Depende de identificadores de producto, precios, stock y resolucion backend.
- No cambiar payloads ni nombres de campos en Fase 1.
- Solo tocar logs, limites de body y metricas si se testea.

### Mercado Pago

- Zonas sensibles: creacion de preferencia, URLs de retorno, webhook, `external_reference`, `preference_id`, pagos aprobados y ajuste de inventario.
- No tocar sin tests especificos y entorno seguro.
- Mantener compatibilidad con rutas existentes: `/api/mercadopago/preference`, `/api/mercado-pago/crear-preferencia`, webhooks y rutas legacy si existen.

### Admin

- Comparte catalogo con tienda publica.
- Riesgo de romper filtros, publicacion masiva, importaciones, stock, Merchant/SEO flags y auditorias.
- Fase 1 no debe redisenar admin; solo proteger performance y observabilidad.

### Inventario y ordenes

- El checkout y webhooks pueden ajustar stock.
- Cualquier cambio en resolucion de producto debe probar compra, webhook, rollback y admin.

## 9. Primera Fase Recomendada

La primera fase conviene que sea **Estabilidad Render + cache publico + logs + startup limpio**, porque da el mayor impacto con el menor riesgo.

### Por que primero esta fase

- Reduce caidas sin redisenar checkout.
- Mejora velocidad percibida del catalogo.
- Baja presion de memoria/CPU.
- Evita que bots de Merchant/Google tiren abajo el servicio.
- Limpia logs sensibles sin cambiar logica de negocio.

### Definicion de terminado

1. Render arranca sin scripts mutantes en `start`.
2. `/healthz` responde aunque el catalogo este inicializando.
3. `/readyz` informa estado real de SQLite/catalogo.
4. `/api/products` publico no usa `no-store` por defecto.
5. `/api/products` no recalcula facets salvo solicitud explicita.
6. Feeds Merchant/screen no hacen scans gigantes bajo demanda sin cache.
7. No se loguea body de checkout ni sample completo de producto en produccion.
8. No se cambia contrato de checkout/Mercado Pago.
9. Admin sigue cargando productos.
10. Tests y checks pasan.
11. Queda documentado rollback.

### Validacion sugerida para una futura implementacion

```bash
node --check backend/server.js
node --check backend/data/productsSqliteRepo.js
node --check backend/data/productsStreamRepo.js
npm test -- --runInBand
npm run check:no-products-full-parse
```

Pruebas manuales:

- `/api/products?page=1&pageSize=24`
- `/api/search?q=pantalla+a52`
- `/shop.html`
- `/p/:slug`
- carrito
- checkout hasta antes de pago real
- creacion de preferencia MP en entorno seguro
- webhook MP si hay test disponible
- admin productos
- Merchant feed y sitemap

## Confirmacion De Cobertura

Este informe cubre los puntos solicitados:

- `package.json`
- `backend/server.js`
- `backend/data/productsSqliteRepo.js`
- `backend/data/productsStreamRepo.js`
- endpoints de productos
- endpoints de busqueda
- feeds Google Merchant y Meta
- sitemaps
- frontend de home, busqueda, categorias y producto
- checkout y Mercado Pago solo como dependencias/riesgos, sin proponer cambios funcionales inmediatos

Prioridad final: estabilizar Render y catalogo publico antes de hacer SEO profundo o redisenos. Si la tienda no responde rapido y de forma estable, cualquier mejora visual, SEO o comercial queda debilitada.
