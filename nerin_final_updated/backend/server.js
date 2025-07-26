/*
 * Servidor Node sin dependencias externas para el sistema ERP + E‑commerce de NERIN.
 *
 * Este servidor expone una API sencilla y sirve los archivos estáticos del
 * frontend. Está diseñado para funcionar sin necesidad de instalar paquetes
 * adicionales (`npm install`), de modo que puedas ejecutar la aplicación
 * inmediatamente con `node backend/server.js`. Para ampliar funcionalidades
 * (bases de datos, autenticación robusta, facturación, etc.) se recomienda
 * utilizar frameworks como Express y bibliotecas adecuadas.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const mercadopago = require("mercadopago");
const { Afip } = require("afip.ts");
const { Resend } = require("resend");
const CONFIG = getConfig();
const APP_PORT = process.env.PORT || 3000;
const resend = CONFIG.resendApiKey ? new Resend(CONFIG.resendApiKey) : null;
const MP_TOKEN =
  process.env.ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || CONFIG.mercadoPagoToken;
if (MP_TOKEN) {
  mercadopago.configure({ access_token: MP_TOKEN });
}

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
  // Usuario vendedor que puede gestionar productos y pedidos pero no ver métricas ni clientes
  {
    email: "vendedor@nerin.com",
    password: "vendedor123",
    role: "vendedor",
    name: "Vendedor",
  },
  // Cliente VIP con acceso a productos exclusivos y descuentos especiales
  {
    email: "vip@nerin.com",
    password: "vip123",
    role: "vip",
    name: "Cliente VIP",
  },
];

// ------------------------ Gestión de usuarios registrados ------------------------

/**
 * Leer usuarios registrados desde el archivo JSON. Retorna un array de objetos
 * { email, password, role, name }. Si no existe, devuelve un array vacío.
 */
function getUsers() {
  const dataPath = path.join(__dirname, "../data/users.json");
  try {
    const file = fs.readFileSync(dataPath, "utf8");
    return JSON.parse(file).users || [];
  } catch (e) {
    return [];
  }
}

/**
 * Guardar usuarios registrados. Se almacena bajo la clave "users".
 */
function saveUsers(users) {
  const dataPath = path.join(__dirname, "../data/users.json");
  fs.writeFileSync(dataPath, JSON.stringify({ users }, null, 2), "utf8");
}

// ========================= NUEVAS UTILIDADES PARA MÓDULOS AVANZADOS =========================

/**
 * Leer proveedores desde el archivo JSON. Cada proveedor contiene al menos un ID,
 * nombre, contacto y condiciones de pago. Se puede ampliar con información
 * adicional como dirección, email y tiempo de entrega.
 */
function getSuppliers() {
  const dataPath = path.join(__dirname, "../data/suppliers.json");
  try {
    const file = fs.readFileSync(dataPath, "utf8");
    return JSON.parse(file).suppliers;
  } catch (e) {
    // Si el archivo no existe, devolver lista vacía
    return [];
  }
}

/**
 * Guardar la lista de proveedores. La estructura del archivo es
 * { "suppliers": [ ... ] } para que sea similar a otros ficheros del sistema.
 */
function saveSuppliers(suppliers) {
  const dataPath = path.join(__dirname, "../data/suppliers.json");
  fs.writeFileSync(dataPath, JSON.stringify({ suppliers }, null, 2), "utf8");
}

/**
 * Leer órdenes de compra (Purchase Orders) del archivo JSON. Cada orden
 * contiene un ID, proveedor, lista de ítems (SKU, cantidad, coste), fecha de
 * creación, estado (pendiente, aprobada, recibida) y fecha estimada de llegada.
 */
function getPurchaseOrders() {
  const dataPath = path.join(__dirname, "../data/purchase_orders.json");
  try {
    const file = fs.readFileSync(dataPath, "utf8");
    return JSON.parse(file).purchaseOrders;
  } catch (e) {
    return [];
  }
}

/**
 * Guardar órdenes de compra en el archivo JSON.
 */
function savePurchaseOrders(purchaseOrders) {
  const dataPath = path.join(__dirname, "../data/purchase_orders.json");
  fs.writeFileSync(
    dataPath,
    JSON.stringify({ purchaseOrders }, null, 2),
    "utf8",
  );
}

/**
 * Calcular métricas avanzadas a partir de pedidos, devoluciones y productos. Devuelve
 * un objeto que agrega ventas por categoría, ventas totales por producto, tasa de
 * devoluciones y clientes principales. Estas métricas pueden utilizarse para
 * gráficos y análisis de negocio.
 */
function calculateDetailedAnalytics() {
  const orders = getOrders();
  const returns = getReturns();
  const products = getProducts();
  const salesByCategory = {};
  const salesByProduct = {};
  const returnsByProduct = {};
  const customerTotals = {};
  const monthlySales = {};
  let totalSales = 0;
  let totalUnitsSold = 0;
  let totalReturns = 0;
  orders.forEach((order) => {
    totalSales += order.total || 0;
    // Agrupar ventas por mes
    if (order.date) {
      const month = order.date.slice(0, 7); // YYYY-MM
      monthlySales[month] = (monthlySales[month] || 0) + (order.total || 0);
    }
    order.items.forEach((item) => {
      const prod = products.find((p) => p.id === item.id);
      if (prod) {
        // Categoría
        const cat = prod.category || "Sin categoría";
        salesByCategory[cat] =
          (salesByCategory[cat] || 0) +
          item.quantity * (item.price || prod.price_minorista);
        // Producto
        salesByProduct[prod.name] =
          (salesByProduct[prod.name] || 0) + item.quantity;
      }
      totalUnitsSold += item.quantity;
    });
    // Total por cliente
    if (order.customer && order.customer.email) {
      const email = order.customer.email;
      customerTotals[email] = (customerTotals[email] || 0) + order.total;
    }
  });
  // Devoluciones
  returns.forEach((ret) => {
    ret.items.forEach((item) => {
      const prod = products.find((p) => p.id === item.id);
      if (prod) {
        returnsByProduct[prod.name] =
          (returnsByProduct[prod.name] || 0) + item.quantity;
      }
      totalReturns += item.quantity;
    });
  });
  // Top clientes
  const topCustomers = Object.entries(customerTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([email, total]) => ({ email, total }));
  const averageOrderValue = orders.length ? totalSales / orders.length : 0;
  const returnRate = totalUnitsSold > 0 ? totalReturns / totalUnitsSold : 0;
  const mostReturnedEntry = Object.entries(returnsByProduct).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const mostReturnedProduct = mostReturnedEntry ? mostReturnedEntry[0] : null;
  return {
    salesByCategory,
    salesByProduct,
    returnsByProduct,
    topCustomers,
    monthlySales,
    averageOrderValue,
    returnRate,
    mostReturnedProduct,
  };
}

// Leer productos desde el archivo JSON
function getProducts() {
  const dataPath = path.join(__dirname, "../data/products.json");
  const file = fs.readFileSync(dataPath, "utf8");
  return JSON.parse(file).products;
}

// Guardar productos en el archivo JSON
function saveProducts(products) {
  const dataPath = path.join(__dirname, "../data/products.json");
  fs.writeFileSync(dataPath, JSON.stringify({ products }, null, 2), "utf8");
}

// Leer pedidos desde el archivo JSON
function getOrders() {
  const dataPath = path.join(__dirname, "../data/orders.json");
  const file = fs.readFileSync(dataPath, "utf8");
  return JSON.parse(file).orders;
}

// Guardar pedidos en el archivo JSON
function saveOrders(orders) {
  const dataPath = path.join(__dirname, "../data/orders.json");
  fs.writeFileSync(dataPath, JSON.stringify({ orders }, null, 2), "utf8");
}

// Leer clientes desde el archivo JSON
function getClients() {
  const dataPath = path.join(__dirname, "../data/clients.json");
  const file = fs.readFileSync(dataPath, "utf8");
  return JSON.parse(file).clients;
}

// Guardar clientes en el archivo JSON
function saveClients(clients) {
  const dataPath = path.join(__dirname, "../data/clients.json");
  fs.writeFileSync(dataPath, JSON.stringify({ clients }, null, 2), "utf8");
}

// Leer facturas desde el archivo JSON
function getInvoices() {
  const dataPath = path.join(__dirname, "../data/invoices.json");
  const file = fs.readFileSync(dataPath, "utf8");
  return JSON.parse(file).invoices;
}

// Leer configuración general (ID de Google Analytics, Meta Pixel, WhatsApp, etc.)
function getConfig() {
  const dataPath = path.join(__dirname, "../data/config.json");
  try {
    const file = fs.readFileSync(dataPath, "utf8");
    return JSON.parse(file);
  } catch (e) {
    // Si el archivo no existe o está corrupto, devolver configuración vacía
    return {};
  }
}

// Guardar configuración general
function saveConfig(cfg) {
  const dataPath = path.join(__dirname, "../data/config.json");
  fs.writeFileSync(dataPath, JSON.stringify(cfg, null, 2), "utf8");
}

// Leer devoluciones desde el archivo JSON
function getReturns() {
  const dataPath = path.join(__dirname, "../data/returns.json");
  const file = fs.readFileSync(dataPath, "utf8");
  return JSON.parse(file).returns;
}

// Guardar devoluciones en el archivo JSON
function saveReturns(returns) {
  const dataPath = path.join(__dirname, "../data/returns.json");
  fs.writeFileSync(dataPath, JSON.stringify({ returns }, null, 2), "utf8");
}

// Guardar facturas en el archivo JSON
function saveInvoices(invoices) {
  const dataPath = path.join(__dirname, "../data/invoices.json");
  fs.writeFileSync(dataPath, JSON.stringify({ invoices }, null, 2), "utf8");
}

// Obtener el siguiente número de factura (persistente)
function getNextInvoiceNumber() {
  const filePath = path.join(__dirname, "../data/invoice_counter.txt");
  let counter = 0;
  try {
    counter = parseInt(fs.readFileSync(filePath, "utf8"), 10);
  } catch (e) {
    counter = 0;
  }
  counter += 1;
  fs.writeFileSync(filePath, String(counter), "utf8");
  // Formato: 0000001, 0000002, ...
  return counter.toString().padStart(7, "0");
}

// Helper para enviar respuestas JSON con CORS y cabeceras básicas
function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}

// Enviar email de confirmación cuando un pedido se marca como pagado
function sendOrderPaidEmail(order) {
  if (!resend || !order.customer || !order.customer.email) return;
  try {
    const tplPath = path.join(__dirname, "../emails/orderPaid.html");
    let html = fs.readFileSync(tplPath, "utf8");
    const urlBase = CONFIG.publicUrl || `http://localhost:${APP_PORT}`;
    const orderUrl = `${urlBase}/account.html?orderId=${encodeURIComponent(order.id)}`;
    html = html.replace("{{ORDER_URL}}", orderUrl);
    resend.emails
      .send({
        from: "no-reply@nerin.com",
        to: order.customer.email,
        subject: "Confirmación de compra",
        html,
      })
      .catch((e) => console.error("Email error", e));
  } catch (e) {
    console.error("send email failed", e);
  }
}

// Servir archivos estáticos (HTML, CSS, JS, imágenes)
function serveStatic(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    }
  });
}

// Crear servidor HTTP
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Soportar solicitudes OPTIONS para CORS
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  // API: obtener productos
  if (pathname === "/api/products" && req.method === "GET") {
    try {
      const products = getProducts();
      return sendJson(res, 200, { products });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron cargar los productos",
      });
    }
  }

  // API: login
  if (pathname === "/api/login" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { email, password } = JSON.parse(body || "{}");
        // Buscar en usuarios de ejemplo y usuarios registrados
        let user = USERS.find(
          (u) => u.email === email && u.password === password,
        );
        if (!user) {
          const regUsers = getUsers();
          user = regUsers.find(
            (u) => u.email === email && u.password === password,
          );
        }
        if (user) {
          // Generar token simple (base64) para demostración
          const token = Buffer.from(`${user.email}:${Date.now()}`).toString(
            "base64",
          );
          return sendJson(res, 200, {
            success: true,
            token,
            role: user.role || "mayorista",
            name: user.name || "Cliente",
          });
        } else {
          return sendJson(res, 401, {
            success: false,
            message: "Credenciales incorrectas",
          });
        }
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: registro de un nuevo usuario (clientes)
  if (pathname === "/api/register" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { email, password, name, role } = JSON.parse(body || "{}");
        if (!email || !password) {
          return sendJson(res, 400, {
            error: "Correo y contraseña son obligatorios",
          });
        }
        // Verificar si ya existe el usuario (solo en usuarios predefinidos o registrados)
        const inPredefined = USERS.some((u) => u.email === email);
        const regUsers = getUsers();
        const inRegistered = regUsers.some((u) => u.email === email);
        if (inPredefined || inRegistered) {
          return sendJson(res, 409, {
            error: "Ya existe una cuenta con ese correo",
          });
        }
        const clients = getClients();

        const userRole = role === "minorista" ? "minorista" : "mayorista";

        // Agregar a usuarios registrados
        const newUser = { email, password, role: userRole, name: name || "" };
        regUsers.push(newUser);
        saveUsers(regUsers);

        // Actualizar cliente existente o crearlo si no existe
        const clientIdx = clients.findIndex((c) => c.email === email);
        if (clientIdx === -1) {
          clients.push({
            email,
            name: name || "Cliente",
            cuit: "",
            condicion_iva: "",
            balance: 0,
            limit: 100000,
          });
        } else {
          clients[clientIdx].name =
            name || clients[clientIdx].name || "Cliente";
        }
        saveClients(clients);
        // Generar token
        const token = Buffer.from(`${email}:${Date.now()}`).toString("base64");
        return sendJson(res, 201, {
          success: true,
          token,
          role: userRole,
          name: name || "Cliente",
        });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: checkout / confirmar pedido
  if (pathname === "/api/checkout" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const cart = parsed.cart;
        const customer = parsed.customer;
        if (!Array.isArray(cart) || cart.length === 0) {
          return sendJson(res, 400, {
            error: "El carrito está vacío o no es válido",
          });
        }
        console.log("Nuevo pedido recibido:");
        cart.forEach((item) => {
          console.log(
            `- ${item.name} x${item.quantity} (precio unitario: $${item.price})`,
          );
        });
        // Verificar stock disponible antes de confirmar pedido
        try {
          const products = getProducts();
          for (const item of cart) {
            const prod = products.find((p) => p.id === item.id);
            if (!prod) {
              return sendJson(res, 400, {
                error: `Producto con ID ${item.id} no encontrado`,
              });
            }
            const available = typeof prod.stock === "number" ? prod.stock : 0;
            if (item.quantity > available) {
              return sendJson(res, 400, {
                error: `Stock insuficiente para ${prod.name}. Disponibles: ${available}`,
              });
            }
          }
        } catch (e) {
          console.error("Error al validar stock:", e);
          return sendJson(res, 500, { error: "Error al validar stock" });
        }
        // Generar un ID simple basado en timestamp y contador aleatorio
        const orderId =
          "ORD-" +
          Date.now().toString(36) +
          "-" +
          Math.floor(Math.random() * 1000);
        const orders = getOrders();
        // Calcular total del pedido (utilizando precio base del producto)
        let total = 0;
        cart.forEach((item) => {
          total += item.price * item.quantity;
        });
        // Registrar pedido con posible información del cliente
        const orderEntry = {
          id: orderId,
          date: new Date().toISOString(),
          // Clonar items para no mutar las cantidades al actualizar inventario
          items: cart.map((it) => ({ ...it })),
          status: "pendiente",
          total,
        };
        // Si existe información de cliente, agregarla
        if (customer) {
          orderEntry.customer = customer;
        }
        orders.push(orderEntry);
        saveOrders(orders);
        // Actualizar inventario: deducir cantidad comprada de cada producto
        try {
          const products = getProducts();
          let modified = false;
          cart.forEach((item) => {
            const index = products.findIndex((p) => p.id === item.id);
            if (index !== -1) {
              // Restar stock global
              if (typeof products[index].stock === "number") {
                products[index].stock = Math.max(
                  0,
                  products[index].stock - item.quantity,
                );
              }
              // Restar de almacenes si existen (no modificar el item original)
              if (products[index].warehouseStock) {
                const whs = products[index].warehouseStock;
                let remaining = item.quantity;
                // Restar primero del almacén principal "central"
                if (whs.central && whs.central > 0) {
                  const toDeduct = Math.min(remaining, whs.central);
                  whs.central -= toDeduct;
                  remaining -= toDeduct;
                }
                // Si aún queda por descontar, recorrer otros almacenes
                for (const w in whs) {
                  if (remaining <= 0) break;
                  if (w === "central") continue;
                  const avail = whs[w];
                  const deduct = Math.min(remaining, avail);
                  whs[w] -= deduct;
                  remaining -= deduct;
                }
              }
              modified = true;
            }
          });
          if (modified) {
            saveProducts(products);
          }
        } catch (e) {
          console.error("Error al actualizar inventario:", e);
        }
        // Si el pedido proviene de un cliente identificado, actualizar saldo
        if (customer && customer.email) {
          const clients = getClients();
          let client = clients.find((c) => c.email === customer.email);
          if (!client) {
            // Crear cliente nuevo con saldo inicial 0 y límite por defecto
            client = {
              email: customer.email,
              name: customer.name || "Cliente",
              cuit: "",
              condicion_iva: "",
              balance: 0,
              limit: 100000,
            };
            clients.push(client);
          }
          client.balance += total;
          saveClients(clients);
        }
        return sendJson(res, 200, {
          success: true,
          message: "Pedido registrado",
          orderId,
        });
      } catch (err) {
        console.error(err);
        return sendJson(res, 500, { error: "Error al procesar el pedido" });
      }
    });
    return;
  }

  // API: crear nueva orden pendiente
  if (pathname === "/api/orders" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        const cart = data.items;
        if (!Array.isArray(cart) || cart.length === 0) {
          return sendJson(res, 400, { error: "Carrito vacío" });
        }
        const orderId =
          "ORD-" +
          Date.now().toString(36) +
          "-" +
          Math.floor(Math.random() * 1000);
        const orders = getOrders();
        const total = cart.reduce((t, it) => t + it.price * it.quantity, 0);
        const order = {
          id: orderId,
          date: new Date().toISOString(),
          items: cart,
          status: "pending",
          total,
          customer: data.customer || {},
        };
        orders.push(order);
        saveOrders(orders);
        return sendJson(res, 201, { orderId });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: obtener lista de pedidos
  if (pathname === "/api/orders" && req.method === "GET") {
    try {
      const orders = getOrders();
      return sendJson(res, 200, { orders });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron obtener los pedidos",
      });
    }
  }

  // API: obtener una orden por ID
  if (pathname.startsWith("/api/orders/") && req.method === "GET") {
    const id = pathname.split("/").pop();
    try {
      const orders = getOrders();
      const order = orders.find((o) => o.id === id);
      if (!order) return sendJson(res, 404, { error: "Pedido no encontrado" });
      return sendJson(res, 200, { order });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "Error al obtener pedido" });
    }
  }

  // API: actualizar pedido por ID (cambiar estado o agregar seguimiento)
  // Ruta esperada: /api/orders/{id}
  if (
    pathname.startsWith("/api/orders/") &&
    (req.method === "PUT" || req.method === "PATCH")
  ) {
    const id = pathname.split("/").pop();
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        const orders = getOrders();
        const index = orders.findIndex((o) => o.id === id);
        if (index === -1) {
          return sendJson(res, 404, { error: "Pedido no encontrado" });
        }
        orders[index] = { ...orders[index], ...update };
        saveOrders(orders);
        return sendJson(res, 200, { success: true, order: orders[index] });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: añadir un nuevo producto
  if (pathname === "/api/products" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const newProduct = JSON.parse(body || "{}");
        const products = getProducts();
        // Asignar un ID autoincremental sencillo
        const newId = (
          products.length
            ? Math.max(...products.map((p) => parseInt(p.id, 10))) + 1
            : 1
        ).toString();
        newProduct.id = newId;
        products.push(newProduct);
        saveProducts(products);
        return sendJson(res, 201, { success: true, product: newProduct });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: actualizar producto existente
  if (pathname.startsWith("/api/products/") && req.method === "PUT") {
    const id = pathname.split("/").pop();
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        const products = getProducts();
        const index = products.findIndex((p) => p.id === id);
        if (index === -1) {
          return sendJson(res, 404, { error: "Producto no encontrado" });
        }
        products[index] = { ...products[index], ...update, id };
        saveProducts(products);
        return sendJson(res, 200, { success: true, product: products[index] });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: eliminar producto
  if (pathname.startsWith("/api/products/") && req.method === "DELETE") {
    const id = pathname.split("/").pop();
    try {
      const products = getProducts();
      const index = products.findIndex((p) => p.id === id);
      if (index === -1) {
        return sendJson(res, 404, { error: "Producto no encontrado" });
      }
      const removed = products.splice(index, 1)[0];
      saveProducts(products);
      return sendJson(res, 200, { success: true, product: removed });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "Error al eliminar producto" });
    }
  }

  // API: métricas básicas
  if (pathname === "/api/metrics" && req.method === "GET") {
    try {
      const orders = getOrders();
      const salesByMonth = {};
      const productTotals = {};
      orders.forEach((order) => {
        const date = new Date(order.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        order.items.forEach((item) => {
          const qty = item.quantity;
          // total por mes (suma de cantidad * precio unitario); para simplificar usamos price sin descuento aplicado
          salesByMonth[monthKey] =
            (salesByMonth[monthKey] || 0) + qty * item.price;
          productTotals[item.name] = (productTotals[item.name] || 0) + qty;
        });
      });
      // Crear ranking de productos
      const topProducts = Object.entries(productTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, quantity]) => ({ name, quantity }));
      return sendJson(res, 200, {
        metrics: {
          totalOrders: orders.length,
          salesByMonth,
          topProducts,
        },
      });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron calcular las métricas",
      });
    }
  }

  // API: obtener lista de clientes
  if (pathname === "/api/clients" && req.method === "GET") {
    try {
      const clients = getClients();
      return sendJson(res, 200, { clients });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron obtener los clientes",
      });
    }
  }

  // API: actualizar un cliente (balance, límites, datos fiscales)
  // Ruta: /api/clients/{email}
  if (pathname.startsWith("/api/clients/") && req.method === "PUT") {
    const email = decodeURIComponent(pathname.split("/").pop());
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        const clients = getClients();
        const idx = clients.findIndex((c) => c.email === email);
        if (idx === -1) {
          return sendJson(res, 404, { error: "Cliente no encontrado" });
        }
        clients[idx] = { ...clients[idx], ...update };
        saveClients(clients);
        return sendJson(res, 200, { success: true, client: clients[idx] });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: crear factura para un pedido
  // Ruta: /api/invoices/{orderId}
  if (pathname.startsWith("/api/invoices/") && req.method === "POST") {
    const orderId = decodeURIComponent(pathname.split("/").pop());
    try {
      const orders = getOrders();
      const order = orders.find((o) => o.id === orderId);
      if (!order) {
        return sendJson(res, 404, { error: "Pedido no encontrado" });
      }
      // Buscar si ya existe factura para este pedido
      let invoices = getInvoices();
      let existing = invoices.find((inv) => inv.orderId === orderId);
      if (existing) {
        return sendJson(res, 200, { invoice: existing });
      }
      // Determinar tipo de factura según condición fiscal del cliente
      let type = "B";
      let clientInfo = null;
      if (order.customer && order.customer.email) {
        const clients = getClients();
        const client = clients.find((c) => c.email === order.customer.email);
        if (client) {
          clientInfo = { ...client };
          if (
            client.condicion_iva &&
            client.condicion_iva.toLowerCase().includes("responsable")
          ) {
            type = "A";
          }
        }
      }
      const invoiceNumber = getNextInvoiceNumber();
      const invoice = {
        id: invoiceNumber,
        orderId,
        date: new Date().toISOString(),
        type,
        client: clientInfo,
        items: order.items,
        total: order.total,
      };
      invoices.push(invoice);
      saveInvoices(invoices);
      return sendJson(res, 201, { invoice });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "No se pudo crear la factura" });
    }
  }

  // API: obtener factura de un pedido
  // Ruta: /api/invoices/{orderId}
  if (pathname.startsWith("/api/invoices/") && req.method === "GET") {
    const orderId = decodeURIComponent(pathname.split("/").pop());
    try {
      const invoices = getInvoices();
      const invoice = invoices.find((inv) => inv.orderId === orderId);
      if (!invoice) {
        return sendJson(res, 404, { error: "Factura no encontrada" });
      }
      return sendJson(res, 200, { invoice });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "No se pudo obtener la factura" });
    }
  }

  // API: crear una solicitud de devolución
  // Ruta: /api/returns (POST)
  if (pathname === "/api/returns" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { orderId, reason, items, customerEmail } = JSON.parse(
          body || "{}",
        );
        if (!orderId || !reason) {
          return sendJson(res, 400, {
            error: "Faltan parámetros para la devolución",
          });
        }
        // Buscar pedido y cliente
        const orders = getOrders();
        const order = orders.find((o) => o.id === orderId);
        if (!order) {
          return sendJson(res, 404, { error: "Pedido no encontrado" });
        }
        // Verificar que el pedido pertenece al cliente (si se suministra) y que fue entregado
        if (
          customerEmail &&
          order.customer &&
          order.customer.email !== customerEmail
        ) {
          return sendJson(res, 403, {
            error: "No puedes devolver un pedido que no es tuyo",
          });
        }
        if (order.status !== "entregado") {
          return sendJson(res, 400, {
            error: "Sólo se pueden devolver pedidos entregados",
          });
        }
        // Verificar si el cliente está bloqueado para devoluciones
        let email = customerEmail;
        if (!email && order.customer) email = order.customer.email;
        let clientBlocked = false;
        if (email) {
          const clients = getClients();
          const client = clients.find((c) => c.email === email);
          if (client && client.blockedReturns) {
            clientBlocked = true;
          }
        }
        if (clientBlocked) {
          return sendJson(res, 403, {
            error:
              "Cliente bloqueado para devoluciones por actividades sospechosas",
          });
        }
        // Contar devoluciones existentes para este cliente
        const returns = getReturns();
        const clientReturns = returns.filter((r) => r.customerEmail === email);
        if (clientReturns.length >= 3) {
          // Bloquear al cliente
          const clients = getClients();
          const idx = clients.findIndex((c) => c.email === email);
          if (idx !== -1) {
            clients[idx].blockedReturns = true;
            saveClients(clients);
          }
          return sendJson(res, 403, {
            error: "Cliente bloqueado debido a exceso de devoluciones",
          });
        }
        // Crear ID de devolución
        const returnId =
          "RET-" +
          Date.now().toString(36) +
          "-" +
          Math.floor(Math.random() * 1000);
        const newReturn = {
          id: returnId,
          orderId,
          customerEmail: email || "",
          items: items || order.items,
          reason,
          status: "pendiente",
          date: new Date().toISOString(),
        };
        returns.push(newReturn);
        saveReturns(returns);
        return sendJson(res, 201, { success: true, returnRequest: newReturn });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: obtener devoluciones (opcional filtro por email)
  if (pathname === "/api/returns" && req.method === "GET") {
    try {
      const query = url.parse(req.url, true).query;
      const returns = getReturns();
      if (query && query.email) {
        const filtered = returns.filter((r) => r.customerEmail === query.email);
        return sendJson(res, 200, { returns: filtered });
      }
      return sendJson(res, 200, { returns });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron obtener las devoluciones",
      });
    }
  }

  // API: actualizar una devolución
  // Ruta: /api/returns/{id} (PUT)
  if (pathname.startsWith("/api/returns/") && req.method === "PUT") {
    const retId = pathname.split("/").pop();
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        const returns = getReturns();
        const idx = returns.findIndex((r) => r.id === retId);
        if (idx === -1) {
          return sendJson(res, 404, { error: "Devolución no encontrada" });
        }
        returns[idx] = { ...returns[idx], ...update };
        saveReturns(returns);
        return sendJson(res, 200, {
          success: true,
          returnRequest: returns[idx],
        });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  // API: obtener configuración general
  if (pathname === "/api/config" && req.method === "GET") {
    try {
      const cfg = getConfig();
      return sendJson(res, 200, cfg);
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudo obtener la configuración",
      });
    }
  }

  // API: actualizar configuración general (solo admin)
  if (pathname === "/api/config" && req.method === "PUT") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        // Obtener la configuración actual y fusionarla con la nueva
        const cfg = getConfig();
        const newCfg = { ...cfg, ...update };
        saveConfig(newCfg);
        return sendJson(res, 200, newCfg);
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }

  /* =====================================================================
   * API: Proveedores (Suppliers)
   * Los proveedores permiten llevar un registro de los socios comerciales
   * que suministran productos al negocio. Se pueden crear, obtener,
   * actualizar y eliminar proveedores. Cada proveedor cuenta con un ID
   * único (generado automáticamente), un nombre, contacto, dirección,
   * email, teléfono y condiciones de pago.
   */
  // Obtener lista de proveedores
  if (pathname === "/api/suppliers" && req.method === "GET") {
    try {
      const suppliers = getSuppliers();
      return sendJson(res, 200, { suppliers });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron obtener los proveedores",
      });
    }
  }
  // Crear nuevo proveedor
  if (pathname === "/api/suppliers" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const newSup = JSON.parse(body || "{}");
        if (!newSup.name) {
          return sendJson(res, 400, {
            error: "Se requiere el nombre del proveedor",
          });
        }
        const suppliers = getSuppliers();
        // Generar ID incremental
        const newId = suppliers.length
          ? (
              Math.max(...suppliers.map((s) => parseInt(s.id, 10))) + 1
            ).toString()
          : "1";
        newSup.id = newId;
        suppliers.push(newSup);
        saveSuppliers(suppliers);
        return sendJson(res, 201, { success: true, supplier: newSup });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }
  // Actualizar proveedor
  if (pathname.startsWith("/api/suppliers/") && req.method === "PUT") {
    const supId = pathname.split("/").pop();
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        const suppliers = getSuppliers();
        const idx = suppliers.findIndex((s) => s.id === supId);
        if (idx === -1) {
          return sendJson(res, 404, { error: "Proveedor no encontrado" });
        }
        suppliers[idx] = { ...suppliers[idx], ...update, id: supId };
        saveSuppliers(suppliers);
        return sendJson(res, 200, { success: true, supplier: suppliers[idx] });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }
  // Eliminar proveedor
  if (pathname.startsWith("/api/suppliers/") && req.method === "DELETE") {
    const supId = pathname.split("/").pop();
    try {
      const suppliers = getSuppliers();
      const index = suppliers.findIndex((s) => s.id === supId);
      if (index === -1) {
        return sendJson(res, 404, { error: "Proveedor no encontrado" });
      }
      const removed = suppliers.splice(index, 1)[0];
      saveSuppliers(suppliers);
      return sendJson(res, 200, { success: true, supplier: removed });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "Error al eliminar proveedor" });
    }
  }

  /*
   * API: Órdenes de compra (Purchase Orders)
   * Permite generar solicitudes de compra a proveedores para reponer stock.
   * Al cambiar el estado a "recibido", se actualiza automáticamente el
   * inventario de los productos implicados.
   */
  if (pathname === "/api/purchase-orders" && req.method === "GET") {
    try {
      const purchaseOrders = getPurchaseOrders();
      return sendJson(res, 200, { purchaseOrders });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron obtener las órdenes de compra",
      });
    }
  }
  if (pathname === "/api/purchase-orders" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const order = JSON.parse(body || "{}");
        if (
          !order.supplier ||
          !Array.isArray(order.items) ||
          order.items.length === 0
        ) {
          return sendJson(res, 400, {
            error: "Datos incompletos para la orden de compra",
          });
        }
        const orders = getPurchaseOrders();
        const newId = orders.length
          ? (Math.max(...orders.map((o) => parseInt(o.id, 10))) + 1).toString()
          : "1";
        order.id = newId;
        order.date = new Date().toISOString();
        order.status = order.status || "pendiente";
        orders.push(order);
        savePurchaseOrders(orders);
        return sendJson(res, 201, { success: true, purchaseOrder: order });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }
  if (pathname.startsWith("/api/purchase-orders/") && req.method === "PUT") {
    const poId = pathname.split("/").pop();
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const update = JSON.parse(body || "{}");
        const orders = getPurchaseOrders();
        const idx = orders.findIndex((o) => o.id === poId);
        if (idx === -1) {
          return sendJson(res, 404, { error: "Orden de compra no encontrada" });
        }
        const existing = orders[idx];
        // Si el estado cambia a "recibido" y antes no estaba como recibido,
        // actualizar inventario sumando las cantidades
        const wasReceived = existing.status === "recibido";
        const willBeReceived = update.status === "recibido";
        orders[idx] = { ...existing, ...update, id: poId };
        savePurchaseOrders(orders);
        if (!wasReceived && willBeReceived) {
          // Ajustar inventario de productos
          try {
            const products = getProducts();
            let modified = false;
            existing.items.forEach((item) => {
              const pIdx = products.findIndex(
                (p) => p.sku === item.sku || p.id === item.id,
              );
              if (pIdx !== -1) {
                // Sumar stock global
                if (typeof products[pIdx].stock === "number") {
                  products[pIdx].stock += item.quantity;
                }
                // Sumar a almacén central
                if (!products[pIdx].warehouseStock) {
                  products[pIdx].warehouseStock = { central: item.quantity };
                } else {
                  products[pIdx].warehouseStock.central =
                    (products[pIdx].warehouseStock.central || 0) +
                    item.quantity;
                }
                modified = true;
              }
            });
            if (modified) {
              saveProducts(products);
            }
          } catch (invErr) {
            console.error(
              "Error al actualizar inventario tras orden de compra:",
              invErr,
            );
          }
        }
        return sendJson(res, 200, {
          success: true,
          purchaseOrder: orders[idx],
        });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Solicitud inválida" });
      }
    });
    return;
  }
  if (pathname.startsWith("/api/purchase-orders/") && req.method === "DELETE") {
    const poId = pathname.split("/").pop();
    try {
      const orders = getPurchaseOrders();
      const index = orders.findIndex((o) => o.id === poId);
      if (index === -1) {
        return sendJson(res, 404, { error: "Orden de compra no encontrada" });
      }
      const removed = orders.splice(index, 1)[0];
      savePurchaseOrders(orders);
      return sendJson(res, 200, { success: true, purchaseOrder: removed });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: "Error al eliminar orden de compra" });
    }
  }

  /*
   * API: Analíticas avanzadas
   * Devuelve métricas más detalladas: ventas por categoría, volumen por producto,
   * devoluciones por producto y clientes con mayor facturación. Útil para
   * análisis profundo y dashboards.
   */
  if (pathname === "/api/analytics/detailed" && req.method === "GET") {
    try {
      const analytics = calculateDetailedAnalytics();
      return sendJson(res, 200, { analytics });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron calcular las analíticas detalladas",
      });
    }
  }

  /*
   * API: Alertas de stock
   * Devuelve productos cuyo stock global esté por debajo de su umbral de
   * seguridad (min_stock). Puede utilizarse para mostrar avisos y generar
   * sugerencias de compra.
   */
  if (pathname === "/api/stock-alerts" && req.method === "GET") {
    try {
      const products = getProducts();
      const low = products.filter((p) => {
        const stock = p.stock || 0;
        const threshold = p.min_stock || 0;
        return stock < threshold;
      });
      return sendJson(res, 200, { alerts: low });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "No se pudieron obtener las alertas de stock",
      });
    }
  }

  // === Integración con Mercado Pago ===
  if (pathname === "/api/mercadopago/preference" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const preference = JSON.parse(body || "{}");
        const result = await mercadopago.preferences.create(preference);
        return sendJson(res, 200, { preference: result.body });
      } catch (err) {
        console.error(err);
        return sendJson(res, 500, {
          error: "Error al crear preferencia de pago",
        });
      }
    });
    return;
  }

  if (pathname === "/api/payments/create-preference" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const itemsSrc = data.cart || data.items || [];
        if (!Array.isArray(itemsSrc) || itemsSrc.length === 0) {
          return sendJson(res, 400, { error: "Carrito vacío" });
        }
        const items = itemsSrc.map((it) => ({
          title: it.title || it.name,
          quantity: Number(it.quantity) || 1,
          unit_price: Number(it.price || it.unit_price) || 0,
        }));
        const urlBase = CONFIG.publicUrl || `http://localhost:${APP_PORT}`;
        const preference = {
          items,
          back_urls: {
            success: `${urlBase}/checkout.html?status=success`,
            pending: `${urlBase}/checkout.html?status=pending`,
            failure: `${urlBase}/checkout.html?status=failure`,
          },
          auto_return: "approved",
        };
        if (CONFIG.publicUrl) {
          preference.notification_url = `${CONFIG.publicUrl}/api/webhooks/mp`;
        }
        const result = await mercadopago.preferences.create(preference);
        return sendJson(res, 200, { preferenceId: result.body.id });
      } catch (err) {
        console.error(err);
        return sendJson(res, 500, { error: "Error al crear preferencia" });
      }
    });
    return;
  }

  if (pathname === "/api/webhooks/mp" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      try {
        const event = JSON.parse(body || "{}");
        const payment = event.data && event.data.id ? event.data : null;
        if (!payment) return sendJson(res, 200, { received: true });
        const orders = getOrders();
        const order = orders.find((o) => o.id === payment.external_reference);
        if (order && payment.status === "approved") {
          order.status = "paid";
          order.paymentId = payment.id;
          saveOrders(orders);
          sendOrderPaidEmail(order);
        }
        return sendJson(res, 200, { success: true });
      } catch (err) {
        console.error(err);
        return sendJson(res, 400, { error: "Webhook inválido" });
      }
    });
    return;
  }

  // === Integración con AFIP (facturación electrónica) ===
  if (pathname === "/api/afip/invoice" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const afip = new Afip({
          CUIT: CONFIG.afipCUIT,
          cert: CONFIG.afipCert,
          key: CONFIG.afipKey,
        });
        const response = await afip.ElectronicBilling.createVoucher(data);
        return sendJson(res, 200, { afip: response });
      } catch (err) {
        console.error(err);
        return sendJson(res, 500, {
          error: "Error al generar factura con AFIP",
        });
      }
    });
    return;
  }

  // === Integración con Andreani (envíos) ===
  if (pathname === "/api/shipping/andreani" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const shipment = JSON.parse(body || "{}");
        // Aquí se integraría con el servicio real de Andreani
        // Actualmente se devuelve una respuesta simulada
        const tracking = "AND-" + Date.now();
        return sendJson(res, 200, { tracking });
      } catch (err) {
        console.error(err);
        return sendJson(res, 500, { error: "Error al generar envío" });
      }
    });
    return;
  }

  // Servir archivos estáticos del frontend y assets
  let filePath;
  // Servir recursos dentro de /assets (imágenes)
  if (pathname.startsWith("/assets/")) {
    filePath = path.join(__dirname, "..", pathname);
  } else {
    filePath = path.join(__dirname, "../frontend", pathname);
  }
  // Si la ruta es directorio o no existe, servir index.html (SPA fallback)
  fs.stat(filePath, (err, stats) => {
    if (err || stats.isDirectory()) {
      filePath = path.join(__dirname, "../frontend/index.html");
    }
    serveStatic(filePath, res);
  });
});

server.listen(APP_PORT, () => {
  console.log(`Servidor de NERIN corriendo en http://localhost:${APP_PORT}`);
});
