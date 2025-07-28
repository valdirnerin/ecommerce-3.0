/*
 * Servidor backend básico para el sistema ERP + E‑commerce de NERIN.
 *
 * Este servidor utiliza Express para exponer una API sencilla y servir
 * los archivos estáticos del frontend y de las imágenes. Está pensado
 * como punto de partida y puede ampliarse según las necesidades.
 */

const path = require("path");
const fs = require("fs");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { MercadoPagoConfig, Preference } = require("mercadopago");
let Resend;
try {
  ({ Resend } = require("resend"));
} catch {
  Resend = null;
}
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const MP_TOKEN = process.env.MP_ACCESS_TOKEN || "";
const mpClient = MP_TOKEN ? new MercadoPagoConfig({ accessToken: MP_TOKEN }) : null;
const mpPreference = mpClient ? new Preference(mpClient) : null;
const resendApiKey = process.env.RESEND_API_KEY || "";
const resend = Resend && resendApiKey ? new Resend(resendApiKey) : null;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Ruta para servir los archivos del frontend (HTML, CSS, JS)
app.use("/", express.static(path.join(__dirname, "../frontend")));

// Ruta para servir las imágenes de productos y otros activos
app.use("/assets", express.static(path.join(__dirname, "../assets")));

// Rutas de retorno de Mercado Pago
app.get("/success", (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/success.html"));
});
app.get("/failure", (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/failure.html"));
});
app.get("/pending", (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/pending.html"));
});

// Leer productos desde el archivo JSON
function getProducts() {
  const dataPath = path.join(__dirname, "../data/products.json");
  const file = fs.readFileSync(dataPath, "utf8");
  return JSON.parse(file).products;
}

function getOrders() {
  const dataPath = path.join(__dirname, "../data/orders.json");
  try {
    const file = fs.readFileSync(dataPath, "utf8");
    return JSON.parse(file).orders || [];
  } catch {
    return [];
  }
}

function saveOrders(orders) {
  const dataPath = path.join(__dirname, "../data/orders.json");
  fs.writeFileSync(dataPath, JSON.stringify({ orders }, null, 2), "utf8");
}

function sendOrderPaidEmail(order) {
  if (!resend || !order.cliente || !order.cliente.email) return;
  try {
    const tpl = path.join(__dirname, "../emails/orderPaid.html");
    let html = fs.readFileSync(tpl, "utf8");
    const url = `${PUBLIC_URL}/account.html?orderId=${encodeURIComponent(order.id)}`;
    html = html.replace("{{ORDER_URL}}", url);
    const to = [order.cliente.email];
    if (ADMIN_EMAIL) to.push(ADMIN_EMAIL);
    resend.emails
      .send({ from: "no-reply@nerin.com", to, subject: "Confirmación de compra", html })
      .catch((e) => console.error("Email error", e));
  } catch (e) {
    console.error("send email failed", e);
  }
}

// API: obtener la lista de productos
app.get("/api/products", (_req, res) => {
  try {
    const products = getProducts();
    res.json({ products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudieron cargar los productos" });
  }
});

// Crear un nuevo pedido y generar preferencia de Mercado Pago
app.post("/api/orders", async (req, res) => {
  try {
    const { cliente = {}, productos = [] } = req.body;
    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ error: "Carrito vacío" });
    }
    const id =
      "ORD-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1000);
    const total = productos.reduce(
      (t, it) => t + Number(it.price) * Number(it.quantity),
      0,
    );
    const order = {
      id,
      cliente,
      productos,
      estado_pago: "pendiente",
      estado_envio: "pendiente",
      fecha: new Date().toISOString(),
      total,
    };
    const orders = getOrders();
    orders.push(order);
    saveOrders(orders);

    let initPoint = null;
    if (mpPreference) {
      try {
        const pref = {
          items: productos.map((p) => ({
            title: p.name,
            quantity: Number(p.quantity),
            unit_price: Number(p.price),
          })),
          back_urls: {
            success: `${PUBLIC_URL}/success`,
            failure: `${PUBLIC_URL}/failure`,
            pending: `${PUBLIC_URL}/pending`,
          },
          auto_return: "approved",
          external_reference: id,
        };
        if (PUBLIC_URL) {
          pref.notification_url = `${PUBLIC_URL}/api/webhooks/mp`;
        }
        const prefRes = await mpPreference.create({ body: pref });
        initPoint = prefRes.init_point;
      } catch (e) {
        console.error("MP preference error", e);
      }
    }

    return res.status(201).json({ orderId: id, init_point: initPoint });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se pudo crear el pedido" });
  }
});

// Obtener pedido por ID
app.get("/api/orders/:id", (req, res) => {
  const orders = getOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
  res.json({ order });
});

// Webhook de Mercado Pago para actualizar estado de pedido
app.post("/api/webhooks/mp", (req, res) => {
  try {
    const event = req.body || {};
    const payment = event.data && event.data.id ? event.data : null;
    if (!payment) return res.json({ received: true });
    const orders = getOrders();
    const order = orders.find((o) => o.id === payment.external_reference);
    if (order) {
      if (payment.status === "approved") {
        order.estado_pago = "pagado";
        order.paymentId = payment.id;
        saveOrders(orders);
        sendOrderPaidEmail(order);
      } else if (payment.status === "rejected") {
        order.estado_pago = "rechazado";
        saveOrders(orders);
      }
    }
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: "Webhook inválido" });
  }
});

// API: checkout / confirmar pedido
// Este endpoint recibe el contenido del carrito y devuelve un mensaje de éxito.
// En un ERP completo se podría almacenar el pedido en la base de datos,
// generar una factura o iniciar la integración de pago. Por ahora solo
// registra el pedido en la consola y devuelve un ok.
app.post("/api/checkout", (req, res) => {
  try {
    const { cart } = req.body;
    if (!Array.isArray(cart) || cart.length === 0) {
      return res
        .status(400)
        .json({ error: "El carrito está vacío o no es válido" });
    }
    console.log("Nuevo pedido recibido:");
    cart.forEach((item) => {
      console.log(
        `- ${item.name} x${item.quantity} (precio unitario: $${item.price})`,
      );
    });
    return res.json({ success: true, message: "Pedido registrado" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error al procesar el pedido" });
  }
});

// Usuarios de ejemplo para login
const USERS = [
  {
    email: "admin@nerin.com",
    password: "admin123",
    role: "admin",
    name: "Valdir",
  },
  {
    email: "mayorista@nerin.com",
    password: "clave123",
    role: "mayorista",
    name: "Cliente Mayorista",
  },
];

// API: login de usuario
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const user = USERS.find((u) => u.email === email && u.password === password);
  if (user) {
    // Generar un token simple (no seguro, solo para demostración)
    const token = Buffer.from(`${user.email}:${Date.now()}`).toString("base64");
    res.json({ success: true, token, role: user.role, name: user.name });
  } else {
    res
      .status(401)
      .json({ success: false, message: "Credenciales incorrectas" });
  }
});

// Fallback para rutas del frontend (permite recargar en rutas relativas)
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.listen(PORT, () => {
  console.log(`Servidor de NERIN corriendo en http://localhost:${PORT}`);
});
