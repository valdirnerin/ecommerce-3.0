-- Tabla key/value para configuración (envíos, etc.)
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value JSONB
);

-- Productos (matchea con productsRepo)
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

-- Órdenes (básico; podes ampliarla luego)
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

-- Historial de cambios de precio
CREATE TABLE IF NOT EXISTS price_changes (
  id          TEXT PRIMARY KEY,
  product_id  TEXT REFERENCES products(id),
  old_price   NUMERIC,
  new_price   NUMERIC,
  changed_by  TEXT,
  changed_at  timestamptz DEFAULT now()
);

-- Movimientos de stock (matchea con productsRepo.adjustStock)
CREATE TABLE IF NOT EXISTS stock_movements (
  id         TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  qty        INTEGER,
  reason     TEXT,
  order_id   TEXT,
  created_at timestamptz DEFAULT now()
);

