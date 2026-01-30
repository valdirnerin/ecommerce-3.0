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

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  status TEXT,
  name TEXT,
  address TEXT,
  lat NUMERIC,
  lng NUMERIC,
  whatsapp TEXT,
  photos JSONB DEFAULT '[]'::jsonb,
  tags JSONB DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  partner_id TEXT REFERENCES partners(id),
  customer_email TEXT,
  customer_name TEXT,
  status TEXT,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  rating INTEGER,
  text TEXT,
  photos JSONB DEFAULT '[]'::jsonb,
  product_id TEXT,
  partner_id TEXT REFERENCES partners(id),
  order_id TEXT,
  referral_id TEXT,
  verification_type TEXT,
  status TEXT,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  soft_deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS review_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT,
  token_salt TEXT,
  scope TEXT,
  order_id TEXT,
  referral_id TEXT,
  recipient_email TEXT,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz DEFAULT now(),
  created_ip_hash TEXT,
  used_ip_hash TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  type TEXT,
  actor TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reviews_product_status_idx ON reviews (product_id, status);
CREATE INDEX IF NOT EXISTS reviews_partner_status_idx ON reviews (partner_id, status);
CREATE INDEX IF NOT EXISTS review_tokens_expires_idx ON review_tokens (expires_at, used_at);
CREATE INDEX IF NOT EXISTS referrals_partner_status_idx ON referrals (partner_id, status);
CREATE INDEX IF NOT EXISTS partners_status_tags_idx ON partners (status, tags);
