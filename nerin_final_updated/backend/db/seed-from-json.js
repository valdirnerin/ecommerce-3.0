const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function poolFromEnv() {
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not set');
  const host = new URL(cs).hostname;
  const ssl = host.includes('.internal') ? false : { rejectUnauthorized: false };
  return new Pool({ connectionString: cs, ssl });
}

function toNum(v){ if(v==null) return null; const s=String(v).trim().replace(/\s*\$/g,'').replace(/\./g,'').replace(/,/g,'.'); const n=Number(s); return Number.isFinite(n)? n : null; }

(async () => {
  const pool = poolFromEnv();
  const seedPath = path.join(__dirname, 'seed.json');
  let raw;
  if (fs.existsSync(seedPath)) {
    raw = JSON.parse(fs.readFileSync(seedPath,'utf8'));
    console.log('[seed] using seed.json');
  } else {
    raw = {
      products: [
        {"sku":"SSP-G990-ORG","name":"Pantalla Samsung S21 FE Service Pack","brand":"Samsung","model":"G990","category":"Pantallas","subcategory":"Service Pack","tags":"AMOLED,Original","stock":25,"min_stock":5,"price":245000,"price_min":245000,"price_may":215000,"image_url":null},
        {"sku":"SSP-A546-ORG","name":"Pantalla Samsung A54 Service Pack","brand":"Samsung","model":"A546","category":"Pantallas","subcategory":"Service Pack","tags":"AMOLED,Original","stock":40,"min_stock":8,"price":185000,"price_min":185000,"price_may":165000,"image_url":null},
        {"sku":"SSP-S911-ORG","name":"Pantalla Samsung S23 Service Pack","brand":"Samsung","model":"S911","category":"Pantallas","subcategory":"Service Pack","tags":"AMOLED,Original","stock":15,"min_stock":3,"price":315000,"price_min":315000,"price_may":285000,"image_url":null},
        {"sku":"SSP-S908-ORG","name":"Pantalla Samsung S22 Ultra Service Pack","brand":"Samsung","model":"S908","category":"Pantallas","subcategory":"Service Pack","tags":"AMOLED,Original","stock":12,"min_stock":3,"price":295000,"price_min":295000,"price_may":270000,"image_url":null},
        {"sku":"SSP-A346-ORG","name":"Pantalla Samsung A34 Service Pack","brand":"Samsung","model":"A346","category":"Pantallas","subcategory":"Service Pack","tags":"AMOLED,Original","stock":35,"min_stock":7,"price":156000,"price_min":156000,"price_may":139000,"image_url":null},
        {"sku":"SSP-A146-ORG","name":"Pantalla Samsung A14 5G Service Pack","brand":"Samsung","model":"A146","category":"Pantallas","subcategory":"Service Pack","tags":"PVA,Original","stock":50,"min_stock":10,"price":98000,"price_min":98000,"price_may":88000,"image_url":null},
        {"sku":"SSP-S928-ORG","name":"Pantalla Samsung S24 Ultra Service Pack","brand":"Samsung","model":"S928","category":"Pantallas","subcategory":"Service Pack","tags":"AMOLED,Original","stock":8,"min_stock":2,"price":435000,"price_min":435000,"price_may":410000,"image_url":null},
        {"sku":"SSP-S711-ORG","name":"Pantalla Samsung S23 FE Service Pack","brand":"Samsung","model":"S711","category":"Pantallas","subcategory":"Service Pack","tags":"AMOLED,Original","stock":18,"min_stock":4,"price":225000,"price_min":225000,"price_may":205000,"image_url":null}
      ]
    };
    console.log('[seed] using embedded dataset');
  }

  const client = await pool.connect();
  try {
    for (const p of raw.products || []) {
      await client.query(`
        INSERT INTO products (sku,name,brand,model,category,subcategory,tags,stock,min_stock,price,price_min,price_may,image_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (sku) DO UPDATE SET
          name=EXCLUDED.name, brand=EXCLUDED.brand, model=EXCLUDED.model,
          category=EXCLUDED.category, subcategory=EXCLUDED.subcategory, tags=EXCLUDED.tags,
          stock=EXCLUDED.stock, min_stock=EXCLUDED.min_stock,
          price=EXCLUDED.price, price_min=EXCLUDED.price_min, price_may=EXCLUDED.price_may,
          image_url=EXCLUDED.image_url
      `, [
        p.sku, p.name, p.brand, p.model, p.category, p.subcategory, p.tags || null,
        p.stock ?? 0, p.min_stock ?? 0,
        toNum(p.price), toNum(p.price_min), toNum(p.price_may), p.image_url || null
      ]);
    }
    console.log('[seed] OK');
  } finally {
    client.release();
  }
})().catch(e => { console.error('seed failed error:', e); process.exit(1); });
