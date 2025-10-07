# Calculadora de costos de importación y pricing para repuestos

Este módulo incorpora una API en FastAPI y una interfaz web responsive para estimar el costo puesto en Argentina y el precio de venta necesario para alcanzar un margen objetivo en repuestos importados (pantallas, baterías, etc.). Todo el flujo es parametrizable (alícuotas, comisiones, presets por NCM) y admite actualización automática del margen al recibir el fee real de un proveedor de cobros.

## Componentes

- **Backend (`import_calc_backend/`)**: FastAPI + SQLModel + SQLite.
  - Endpoints REST para cálculos, presets y notificaciones de cobro.
  - Logging estructurado, exportación CSV/XLSX y almacenamiento histórico en base de datos.
  - Configurable por variables de entorno (`IMPORT_CALC_*`).
- **Frontend (`import_calc_frontend/`)**: HTML + CSS + JavaScript vanilla.
  - Formulario completo para cargar costos en USD/ARS, configurar tributos, comisiones y redondeos.
  - Presets guardados por NCM, desglose en tabla y exportación.
  - Formulario para registrar fee real y recalcular margen.
- **Pruebas**: `pytest` con 6 escenarios que cubren tasa estadística, distintos DI, cálculo por margen/precio y uso de fee real.

## Requisitos

1. Python 3.11+
2. Node opcional para servir el frontend estático (puede usarse cualquier servidor estático).

## Puesta en marcha

```bash
cd nerin_final_updated/import_calc_backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

La API queda disponible en `http://localhost:8000`. Endpoints principales:

- `POST /api/calculations`: genera un cálculo y devuelve el desglose.
- `GET /api/calculations/{id}`: obtiene un cálculo previo.
- `GET /api/calculations/{id}/export?format=csv|xlsx`: exporta el desglose.
- `GET /api/presets`: lista presets disponibles.
- `POST /api/presets`: crea un nuevo preset.
- `POST /api/payments/notify`: registra un fee real y recalcula el margen.
- `GET /health`: healthcheck con timestamp en `America/Argentina/Buenos_Aires`.

El backend crea `import_calculator.db` en el directorio del proyecto y registra logs rotativos en `logs/app.log`.

## Frontend

Servir los archivos estáticos de `import_calc_frontend/` (por ejemplo, con `python -m http.server`). La interfaz asume que la API corre en `http://localhost:8000`; puede sobreescribirse configurando `window.API_BASE` en el HTML. Si preferís unificar todo en el panel de administración existente, abrí `frontend/admin.html`: ahora incluye una pestaña "Calculadora de importación" que embebe la herramienta y ofrece un enlace directo por si querés abrirla en otra ventana.

### Funcionalidades principales

- **Costos base**: ingreso de FOB, flete y seguro en USD o ARS. Conversión automática según `tc_aduana`.
- **Tributos**: DI parametrizable, tasa estadística opcional, IVA, percepciones, lista libre de impuestos adicionales (por CIF/Base IVA/fijo en ARS).
- **Gastos locales y de salida**: sumatoria en ARS.
- **Comisiones**: porcentaje y IVA asociados (p. ej., Mercado Pago).
- **Modo objetivo**: `margen` (calcula precio neto) o `precio` (devuelve margen real). Para `margen` se utiliza la fórmula indicada en el enunciado.
- **Redondeos**: pasos de $1/$10/$100 con terminaciones psicológicas opcionales (.99, .90, etc.).
- **Cantidad**: cálculo de totales y unitarios.
- **Fee real**: formulario que recibe `payment_id`, `order_reference`, `fee_total` y desglose opcional en JSON. El margen se recalcula reemplazando la simulación del fee.
- **Exportación**: CSV/XLSX para el desglose completo.

## Variables de entorno relevantes

- `IMPORT_CALC_DATABASE_URL`: cadena de conexión SQLAlchemy (por defecto SQLite local).
- `IMPORT_CALC_DEFAULT_TIMEZONE`: zona horaria (por defecto `America/Argentina/Buenos_Aires`).
- `IMPORT_CALC_LOG_LEVEL`: nivel de logging.
- `IMPORT_CALC_PAYMENT_PROVIDER_TOKEN`: credencial opcional si se integra con proveedores externos.

## Presets y parámetros por defecto

`config/defaults.yaml` contiene presets editables. Cada elemento define:

```yaml
- name: "Pantallas-Importadas"
  di_rate: "0.08"
  iva_rate: "0.21"
  perc_iva_rate: "0.20"
  perc_ganancias_rate: "0.06"
  apply_tasa_estadistica: true
  mp_rate: "0.05"
  mp_iva_rate: "0.21"
  notes: "Preset genérico para displays"
```

Los presets se importan en el `startup` del API la primera vez.

## Pruebas automáticas

```bash
cd nerin_final_updated/import_calc_backend
pytest
```

Casos cubiertos:

1. Caso base con tasa estadística activa.
2. Caso exento de tasa estadística.
3. Arancel DI distinto.
4. `target="margen"` con margen objetivo 25%.
5. `target="precio"` con fee real aplicado.
6. Impuestos adicionales + redondeo psicológico.

## Ejemplos manuales sugeridos

Utilizar los datos del enunciado (Ejemplo A/B/C) en el formulario web o vía `curl`:

```bash
curl -X POST http://localhost:8000/api/calculations \
  -H "Content-Type: application/json" \
  -d '{
    "parameters": {
      "costs": {
        "fob": {"amount": "100", "currency": "USD"},
        "freight": {"amount": "5", "currency": "USD"},
        "insurance": {"amount": "1", "currency": "USD"}
      },
      "tc_aduana": "980",
      "di_rate": "0.08",
      "apply_tasa_estadistica": true,
      "iva_rate": "0.21",
      "perc_iva_rate": "0.20",
      "perc_ganancias_rate": "0.06",
      "gastos_locales_ars": "8000",
      "costos_salida_ars": "2500",
      "mp_rate": "0.05",
      "mp_iva_rate": "0.21",
      "target": "margen",
      "margen_objetivo": "0.25"
    }
  }'
```

Para `target="precio"` basta con enviar `"precio_neto_input_ars": "75000"`.

## Integración con notificaciones de pago

- Enviar un `POST /api/payments/notify` con el `fee_total` exacto.
- La API guarda la notificación (idempotente por `payment_id`) y busca el cálculo asociado por `order_reference`.
- Se recalcula el margen real con el fee informado y se persiste el nuevo desglose.
- La respuesta incluye el cálculo actualizado para mostrarlo en el frontend.

## Exportación

Cada cálculo guarda el detalle en SQLite. Puede exportarse desde la UI o con `GET /api/calculations/{id}/export?format=csv|xlsx`.

## Logging y auditoría

- Los cálculos se registran con `logger.info` incluyendo `order_reference` y `calculation_id`.
- Las notificaciones de pago registran si se actualizó el cálculo.
- Los archivos se rotan automáticamente (`logs/app.log`).

---

Diseñado para brindar transparencia sobre cada componente (CIF, DI, tasas, comisiones) y adaptarse rápidamente a cambios regulatorios mediante parámetros o presets.
