const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;

/*
 * In el entorno NERIN se soportan dos modos de persistencia: disco (JSON en
 * la carpeta `data/`) o PostgreSQL. Si sólo estás trabajando con los
 * archivos JSON, establece la variable de entorno `USE_PG` a "false" (o
 * elimínala) para forzar el modo disco. Esto evita que se cree un pool
 * de conexiones cuando se define accidentalmente una `DATABASE_URL` y
 * provoca errores como «column \"image_url\" does not exist» en bases de datos
 * obsoletas.
 */

function getPool() {
  // Permitir desactivar PostgreSQL si USE_PG no es "true"
  const usePg = String(process.env.USE_PG || '').toLowerCase() === 'true';
  if (!usePg) return null;
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_URL.includes('render.com') || process.env.RENDER
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not configured');
  return p.query(text, params);
}

async function init() {
  const p = getPool();
  if (!p) return;
  const schemaPath = path.join(__dirname, '../scripts/schema.sql');
  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await p.query(sql);
  } catch (e) {
    console.error('db init fail', e.message);
  }
}

module.exports = { getPool, query, init };
