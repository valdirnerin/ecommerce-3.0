INSTRUCCIONES RÁPIDAS
=====================

1. Entrá en la carpeta `backend`:

   ```bash
   cd backend
   ```

2. Copiá `frontend/config.example.js` a `frontend/config.js` y completa tu
   clave pública de Mercado Pago. Luego copiá `backend/.env.example` a
   `backend/.env` y define tu `MP_ACCESS_TOKEN`. Instalá las dependencias y
   ejecutá el servidor:

   ```bash
   npm install
   node server.js
   ```

3. Abrí `frontend/index.html` en tu navegador y presioná el botón para pagar.

El backend quedará disponible en `http://localhost:3000` y podés cambiar los
datos del producto directamente en `frontend/index.html`.

VARIABLES DE ENTORNO
-------------------

Se utilizan tres variables principales para la integración con Mercado Pago:

- `MP_ACCESS_TOKEN`: token privado. Los que empiezan con `TEST-` sirven para el sandbox; para producción se necesita un token que comience con `APP_USR-`.
- `PUBLIC_URL`: URL pública del servidor. Se usa para redireccionar y para el webhook. En producción suele ser `https://ecommerce-3-0.onrender.com`.
- `MP_WEBHOOK_URL`: URL donde Mercado Pago enviará notificaciones. Si no se define, se construye como `${PUBLIC_URL}/api/mercado-pago/webhook`. Un ejemplo en producción es `https://ecommerce-3-0.onrender.com/api/mercado-pago/webhook`.

PRUEBAS AUTOMÁTICAS
-------------------

Para ejecutar las pruebas básicas del webhook ejecutá:

```bash
npm install
npm test
```

