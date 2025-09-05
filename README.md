# Ecommerce 3.0

Este repositorio organiza el código en dos áreas principales:

## Estructura

- **`apps/`** – contiene los módulos activos del proyecto:
  - `backend`: API Express y utilidades de servidor.
  - `frontend`: página de checkout y ejemplo de integración.
  - `nerin`: módulo ERP + E‑commerce de NERIN.
- **`legacy/`** – conserva el código original para referencia histórica:
  - `backend_orig`
  - `frontend_orig`
  - `nerin_orig`

## Dependencias y scripts

Todas las dependencias están unificadas en la raíz mediante un único `package.json`.
Desde la raíz se pueden ejecutar los siguientes comandos:

```bash
npm install        # instala las dependencias
npm start          # inicia el backend principal
npm run nerin:start  # inicia el módulo NERIN
npm run build      # paso de compilación (actualmente no realiza ninguna acción)
npm test           # ejecuta las pruebas automatizadas
```

Para instrucciones de uso detalladas, consultar `README.txt`.


