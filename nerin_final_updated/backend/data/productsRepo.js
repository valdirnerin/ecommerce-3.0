const fs = require('fs');
const path = require('path');
const db = require('../db');
const { DATA_DIR: dataDir } = require('../utils/dataDir');

const filePath = path.join(dataDir, 'products.json');

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') {
    try {
      return raw == null ? {} : { ...raw };
    } catch {
      return {};
    }
  }
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function normalizeProduct(product) {
  if (!product) return product;
  const meta = parseMetadata(product.metadata);
  const images = Array.isArray(product.images)
    ? product.images.filter(Boolean)
    : Array.isArray(meta.images)
    ? meta.images.filter(Boolean)
    : [];
  const imagesAlt = Array.isArray(product.images_alt)
    ? product.images_alt
    : Array.isArray(meta.images_alt)
    ? meta.images_alt
    : [];

  if (images.length) {
    product.images = images;
    if (!product.image) {
      product.image = images[0];
    }
  }
  if (imagesAlt.length) {
    product.images_alt = imagesAlt;
  }
  if (Object.keys(meta).length) {
    product.metadata = meta;
  }
  if (!product.images && product.image) {
    product.images = [product.image];
  }
  return product;
}

function normalizeList(list = []) {
  return list.map((item) => normalizeProduct({ ...item }));
}

function prepareMetadata(product) {
  const meta = parseMetadata(product.metadata);
  if (Array.isArray(product.images) && product.images.length) {
    meta.images = product.images.filter(Boolean);
  } else {
    delete meta.images;
  }
  if (Array.isArray(product.images_alt) && product.images_alt.length) {
    meta.images_alt = product.images_alt;
  } else {
    delete meta.images_alt;
  }
  return Object.keys(meta).length ? meta : null;
}

function primaryImage(product) {
  if (!product) return null;
  if (product.image_url) return product.image_url;
  if (product.image) return product.image;
  if (Array.isArray(product.images) && product.images.length) {
    return product.images[0];
  }
  const meta = parseMetadata(product.metadata);
  if (Array.isArray(meta.images) && meta.images.length) {
    return meta.images[0];
  }
  return null;
}

async function getAll() {
  const pool = db.getPool();
  // Si no hay conexión a la base, leemos desde disco
  if (!pool) {
    try {
      const fileProducts = JSON.parse(fs.readFileSync(filePath, 'utf8')).products || [];
      return normalizeList(fileProducts);
    } catch {
      return [];
    }
  }
  // Intentar leer columna image_url. Si falla, capturamos y probamos con image
  try {
    const { rows } = await pool.query(
      'SELECT id, name, price, stock, COALESCE(image_url, image) AS image, metadata, updated_at FROM products ORDER BY id'
    );
    return normalizeList(rows.map((r) => {
      const copy = { ...r };
      if (r.image_url && !r.image) copy.image = r.image_url;
      return copy;
    }));
  } catch (e) {
    // Si la consulta falla (por ejemplo, la columna no existe), hacemos fallback a disco
    console.error('DB product query failed', e.message);
    try {
      const fileProducts = JSON.parse(fs.readFileSync(filePath, 'utf8')).products || [];
      return normalizeList(fileProducts);
    } catch {
      return [];
    }
  }
}

async function getById(id) {
  const pool = db.getPool();
  if (!pool) {
    const prods = await getAll();
    return prods.find((p) => String(p.id) === String(id)) || null;
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, name, price, stock, COALESCE(image_url, image) AS image, metadata, updated_at FROM products WHERE id=$1',
      [id]
    );
    const prod = rows[0] ? { ...rows[0] } : null;
    if (prod && prod.image_url && !prod.image) prod.image = prod.image_url;
    return normalizeProduct(prod);
  } catch (e) {
    console.error('DB product query failed', e.message);
    const prods = await getAll();
    return prods.find((p) => String(p.id) === String(id)) || null;
  }
}

async function saveAll(products) {
  const pool = db.getPool();
  if (!pool) {
    const normalized = normalizeList(products);
    fs.writeFileSync(filePath, JSON.stringify({ products: normalized }, null, 2), 'utf8');
    return;
  }
  await pool.query('BEGIN');
  try {
    for (const p of products) {
      const normalized = normalizeProduct({ ...p });
      const img = primaryImage(normalized);
      const metadata = prepareMetadata(normalized);
      await pool.query(
        `INSERT INTO products (id, name, price, stock, image_url, metadata)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name,
           price=EXCLUDED.price,
           stock=EXCLUDED.stock,
           image_url=EXCLUDED.image_url,
           metadata=EXCLUDED.metadata,
           updated_at=now()`,
        [
          normalized.id,
          normalized.name,
          normalized.price,
          normalized.stock,
          img,
          metadata,
        ]
      );
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function updatePrice(id, newPrice, changedBy = 'system') {
  const pool = db.getPool();
  if (!pool) {
    const products = await getAll();
    const idx = products.findIndex((p) => String(p.id) === String(id));
    if (idx !== -1) {
      products[idx].price = newPrice;
      saveAll(products);
    }
    return;
  }
  await pool.query('BEGIN');
  try {
    const { rows } = await pool.query('SELECT price FROM products WHERE id=$1', [id]);
    const oldPrice = rows[0] ? rows[0].price : null;
    await pool.query('UPDATE products SET price=$1, updated_at=now() WHERE id=$2', [newPrice, id]);
    await pool.query(
      'INSERT INTO price_changes(product_id, old_price, new_price, changed_by) VALUES ($1,$2,$3,$4)',
      [id, oldPrice, newPrice, changedBy]
    );
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

async function adjustStock(id, delta, reason = 'manual', refId = null) {
  const pool = db.getPool();
  if (!pool) {
    const products = await getAll();
    const idx = products.findIndex((p) => String(p.id) === String(id));
    if (idx !== -1) {
      const before = Number(products[idx].stock || 0);
      let after = before + Number(delta);
      if (after < 0) after = 0;
      products[idx].stock = after;
      saveAll(products);
    }
    return;
  }
  await pool.query('BEGIN');
  try {
    const { rows } = await pool.query(
      'UPDATE products SET stock=GREATEST(stock + $1,0), updated_at=now() WHERE id=$2 RETURNING stock',
      [delta, id]
    );
    await pool.query(
      'INSERT INTO stock_movements(product_id, delta, reason, ref_id) VALUES ($1,$2,$3,$4)',
      [id, delta, reason, refId]
    );
    await pool.query('COMMIT');
    return rows[0] ? rows[0].stock : null;
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

module.exports = { getAll, getById, saveAll, updatePrice, adjustStock };
