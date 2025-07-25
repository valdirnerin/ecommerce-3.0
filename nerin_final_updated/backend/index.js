/*
 * Servidor backend básico para el sistema ERP + E‑commerce de NERIN.
 *
 * Este servidor utiliza Express para exponer una API sencilla y servir
 * los archivos estáticos del frontend y de las imágenes. Está pensado
 * como punto de partida y puede ampliarse según las necesidades.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Ruta para servir los archivos del frontend (HTML, CSS, JS)
app.use('/', express.static(path.join(__dirname, '../frontend')));

// Ruta para servir las imágenes de productos y otros activos
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Leer productos desde el archivo JSON
function getProducts() {
  const dataPath = path.join(__dirname, '../data/products.json');
  const file = fs.readFileSync(dataPath, 'utf8');
  return JSON.parse(file).products;
}

// API: obtener la lista de productos
app.get('/api/products', (_req, res) => {
  try {
    const products = getProducts();
    res.json({ products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar los productos' });
  }
});

// API: checkout / confirmar pedido
// Este endpoint recibe el contenido del carrito y devuelve un mensaje de éxito.
// En un ERP completo se podría almacenar el pedido en la base de datos,
// generar una factura o iniciar la integración de pago. Por ahora solo
// registra el pedido en la consola y devuelve un ok.
app.post('/api/checkout', (req, res) => {
  try {
    const { cart } = req.body;
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: 'El carrito está vacío o no es válido' });
    }
    console.log('Nuevo pedido recibido:');
    cart.forEach((item) => {
      console.log(`- ${item.name} x${item.quantity} (precio unitario: $${item.price})`);
    });
    return res.json({ success: true, message: 'Pedido registrado' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al procesar el pedido' });
  }
});

// Usuarios de ejemplo para login
const USERS = [
  {
    email: 'admin@nerin.com',
    password: 'admin123',
    role: 'admin',
    name: 'Valdir'
  },
  {
    email: 'mayorista@nerin.com',
    password: 'clave123',
    role: 'mayorista',
    name: 'Cliente Mayorista'
  }
];

// API: login de usuario
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = USERS.find((u) => u.email === email && u.password === password);
  if (user) {
    // Generar un token simple (no seguro, solo para demostración)
    const token = Buffer.from(`${user.email}:${Date.now()}`).toString('base64');
    res.json({ success: true, token, role: user.role, name: user.name });
  } else {
    res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
  }
});

// Fallback para rutas del frontend (permite recargar en rutas relativas)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor de NERIN corriendo en http://localhost:${PORT}`);
});