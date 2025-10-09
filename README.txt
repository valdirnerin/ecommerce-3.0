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
- `DATABASE_URL`: cadena de conexión PostgreSQL utilizada por Prisma. Asegurate de definirla en Render (Dashboard → servicio → **Environment → Environment Variables**) con el mismo valor que en tu entorno local para que el despliegue se conecte correctamente a la base de datos.

Después de crear o actualizar las variables recordá volver a desplegar la aplicación para que Next.js reconstruya las páginas con la conexión activa.

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

GESTIÓN DE MAYORISTAS DESDE EL ADMIN
------------------------------------

El panel de administración (`/admin`) incorpora una sección dedicada a las
solicitudes mayoristas. Desde allí podés:

- Filtrar y buscar solicitudes por estado, razón social, CUIT o correo.
- Revisar los datos enviados por el postulante, incluyendo historial y notas
  internas.
- Adjuntar o eliminar documentación respaldatoria.
- Cambiar el estado (pendiente, requiere documentación, aprobada, rechazada o
  archivada) y enviar el correo correspondiente desde el mismo formulario.
- Crear la cuenta del cliente con credenciales provisorias al aprobar la
  solicitud.

Para probar el flujo end-to-end:

1. Generá una solicitud mayorista desde `/register.html` completando la sección
   "Mayoristas".
2. Ingresá en `/admin`, abrí la pestaña **Mayoristas** y actualizá la tabla.
3. Seleccioná la solicitud para revisar los datos, subir documentos o dejar
   notas internas.
4. Cambiá el estado según corresponda; si seleccionás *Aprobada* marcá la
   opción *Crear cuenta y enviar clave provisoria* para generar el usuario.

RENDER ROUTING
--------------

Si desplegás la aplicación en Render, configurá la siguiente regla de routing para redirigir las solicitudes del frontend:

```
/api/*  https://ecommerce-3-0.onrender.com/api/:splat  200
```

El frontend realiza los `fetch` utilizando rutas relativas (por ejemplo, `fetch('/api/productos')`), por lo que las peticiones a `/api/...` serán reenviadas al backend mediante la regla anterior.

