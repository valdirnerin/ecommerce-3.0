INSTRUCCIONES RÁPIDAS
=====================

1. Entrá en la carpeta `nerin_final_updated`:

   ```bash
   cd nerin_final_updated
   ```

2. Instalá las dependencias y ejecutá el servidor completo (frontend + backend
   con la nueva PDP):

   ```bash
   npm install
   npm start
   ```

   También podés lanzar el servidor desde la raíz del repositorio con
   `npm start`; internamente invoca a `nerin_final_updated/backend/server.js`.

3. Abrí `http://localhost:3000` para navegar el storefront actualizado. El
   panel de administración sigue estando en la misma URL (`/admin`).

Las credenciales de Mercado Pago continúan configuradas en
`nerin_final_updated/frontend/config.js` y `nerin_final_updated/backend/.env`.

VARIABLES DE ENTORNO
-------------------

Se utilizan las siguientes variables para la integración con Mercado Pago:

- `MP_ACCESS_TOKEN`: token privado. Los que empiezan con `TEST-` sirven para el sandbox; para producción se necesita un token que comience con `APP_USR-`.
- `MP_CLIENT_ID` y `MP_CLIENT_SECRET`: credenciales OAuth asociadas a la cuenta.
- `PUBLIC_URL`: URL pública del servidor utilizada para las redirecciones. El webhook de Mercado Pago debe configurarse en el panel de IPN apuntando a `https://ecommerce-3-0.onrender.com/api/webhooks/mp`.

VERIFICAR WEBHOOKS
--------------------

Para listar los webhooks configurados en tu cuenta ejecutá:

```bash
npm run list:webhooks
```

Necesitás tener `MP_ACCESS_TOKEN` configurado en tu entorno.

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

