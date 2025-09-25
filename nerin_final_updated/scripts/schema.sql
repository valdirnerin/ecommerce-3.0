CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT,
  price NUMERIC,
  stock INTEGER,
  image_url TEXT,
  metadata JSONB,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  customer_email TEXT,
  status TEXT,
  total NUMERIC,
  inventory_applied BOOLEAN DEFAULT false,
  invoice_status TEXT,
  invoices JSONB DEFAULT '[]'::jsonb
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoice_status TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoices JSONB DEFAULT '[]'::jsonb;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS emails JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id),
  qty INTEGER,
  price NUMERIC,
  UNIQUE(order_id, product_id)
);

CREATE TABLE IF NOT EXISTS price_changes (
  id BIGSERIAL PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  old_price NUMERIC,
  new_price NUMERIC,
  changed_by TEXT,
  changed_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  delta INTEGER,
  reason TEXT,
  ref_id TEXT,
  created_at timestamptz DEFAULT now()
);
