const { Pool } = require('pg');

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: url,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
  });

  const queries = [
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT,
      price NUMERIC,
      stock INT,
      sku TEXT,
      category TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)` ,
    `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      nrn TEXT,
      preference_id TEXT,
      email TEXT,
      status TEXT,
      total NUMERIC,
      inventory_applied BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email)`,
    `CREATE TABLE IF NOT EXISTS order_items (
      order_id TEXT REFERENCES orders(id),
      product_id TEXT REFERENCES products(id),
      qty INT,
      price NUMERIC,
      PRIMARY KEY(order_id, product_id)
    )`,
    `CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      product_id TEXT REFERENCES products(id),
      qty INT,
      reason TEXT,
      order_id TEXT REFERENCES orders(id),
      created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id)`,
    `CREATE TABLE IF NOT EXISTS price_changes (
      id TEXT PRIMARY KEY,
      product_id TEXT REFERENCES products(id),
      old_price NUMERIC,
      new_price NUMERIC,
      created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_price_changes_product ON price_changes(product_id)`
  ];

  for (const q of queries) {
    await pool.query(q);
  }

  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
