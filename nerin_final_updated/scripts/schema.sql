-- CONFIG
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value JSONB
);

-- PRODUCTS
CREATE TABLE IF NOT EXISTS products (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  price      NUMERIC,
  stock      INTEGER DEFAULT 0,
  sku        TEXT,
  category   TEXT,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- NUEVAS COLUMNAS (idempotentes)
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tags JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_minorista NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_mayorista NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image TEXT;

-- ORDERS
CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  created_at        timestamptz DEFAULT now(),
  customer_email    TEXT,
  status            TEXT,
  total             NUMERIC,
  inventory_applied BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS order_items (
  id         BIGSERIAL PRIMARY KEY,
  order_id   TEXT REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id),
  qty        INTEGER,
  price      NUMERIC,
  UNIQUE(order_id, product_id)
);

-- PRICE CHANGES
CREATE TABLE IF NOT EXISTS price_changes (
  id          TEXT PRIMARY KEY,
  product_id  TEXT REFERENCES products(id),
  old_price   NUMERIC,
  new_price   NUMERIC,
  changed_by  TEXT,
  changed_at  timestamptz DEFAULT now()
);

-- STOCK MOVEMENTS
CREATE TABLE IF NOT EXISTS stock_movements (
  id         TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  qty        INTEGER,
  reason     TEXT,
  order_id   TEXT,
  created_at timestamptz DEFAULT now()
);

