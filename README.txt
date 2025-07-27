INSTRUCCIONES RÁPIDAS
=====================

1. Entrá en la carpeta `backend`:

   ```bash
   cd backend
   ```

2. Copiá `frontend/config.example.js` a `frontend/config.js` y completa tu
   clave pública de Mercado Pago. Luego instalá las dependencias y ejecutá el servidor
   (necesitás definir `MP_ACCESS_TOKEN` en tu entorno):

   ```bash
   npm install
   node server.js
   ```

3. Abrí `frontend/index.html` en tu navegador y presioná el botón para pagar.

El backend quedará disponible en `http://localhost:3000` y podés cambiar los
datos del producto directamente en `frontend/index.html`.

