-- Schema for products table
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE,
  name TEXT NOT NULL
);

-- Add missing columns (idempotent)
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand        TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS model        TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category     TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory  TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tags         TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock        INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock    INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price        NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_min    NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_may    NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url    TEXT;

-- Ensure SKU is unique
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'products_sku_unique_idx'
  ) THEN
    CREATE UNIQUE INDEX products_sku_unique_idx ON products (sku);
  END IF;
END$$;
