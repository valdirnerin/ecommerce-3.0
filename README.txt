INSTRUCCIONES RÁPIDAS
=====================

1. Entrá en la carpeta `backend`:

   ```bash
   cd backend
   ```

2. Las credenciales de Mercado Pago ya están definidas en `frontend/config.js`
   y `backend/.env`. Si necesitás otras, editá esos archivos. Instalá las
   dependencias y ejecutá el servidor:

   ```bash
   npm install
   node server.js
   ```

3. Abrí `frontend/index.html` en tu navegador y presioná el botón para pagar.

El backend quedará disponible en `http://localhost:3000` y podés cambiar los
datos del producto directamente en `frontend/index.html`.

VARIABLES DE ENTORNO
-------------------

Se utilizan las siguientes variables para la integración con Mercado Pago:

- `MP_ACCESS_TOKEN`: token privado. Los que empiezan con `TEST-` sirven para el sandbox; para producción se necesita un token que comience con `APP_USR-`.
- `MP_CLIENT_ID` y `MP_CLIENT_SECRET`: credenciales OAuth asociadas a la cuenta.
- `PUBLIC_URL`: URL pública del servidor utilizada para las redirecciones. El webhook de Mercado Pago debe configurarse en el panel de IPN apuntando a `https://ecommerce-3-0.onrender.com/api/webhooks/mp`.

PRUEBAS AUTOMÁTICAS
-------------------

Para ejecutar las pruebas básicas del webhook ejecutá:

```bash
npm install
npm test
```

RENDER ROUTING
--------------

Si desplegás la aplicación en Render, configurá la siguiente regla de routing para redirigir las solicitudes del frontend:

```
/api/*  https://ecommerce-3-0.onrender.com/api/:splat  200
```

El frontend realiza los `fetch` utilizando rutas relativas (por ejemplo, `fetch('/api/productos')`), por lo que las peticiones a `/api/...` serán reenviadas al backend mediante la regla anterior.

