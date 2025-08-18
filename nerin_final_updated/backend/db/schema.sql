-- CODEXFIX: esquema base productos
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  category TEXT,
  subcategory TEXT,
  tags TEXT,
  stock INTEGER DEFAULT 0,
  min_stock INTEGER DEFAULT 0,
  price NUMERIC,
  price_min NUMERIC,
  price_may NUMERIC,
  image_url TEXT
);
