// nerin_final_updated/backend/utils/dataDir.js
const path = require('path');
const fs = require('fs');

// 1) Si definiste DATA_DIR en Render, usamos eso
const ENV_DIR = process.env.DATA_DIR;

// 2) Si tenés el disco montado en /var/nerin-data (lo que muestra tu log), usamos ahí.
//    Si en tu servicio lo montaste en /var/data, también lo detectamos y preferimos /var/data/nerin.
const CANDIDATES = [
  '/var/nerin-data',        // como muestra tu error/log
  '/var/data/nerin',        // patrón recomendado
  '/var/data'               // disco genérico
];

let RENDER_DIR = null;
for (const c of CANDIDATES) {
  try { if (fs.existsSync(c)) { RENDER_DIR = c; break; } } catch {}
}

// 3) Fallback local (dev): carpeta data dentro del repo
const LOCAL_DIR = path.join(__dirname, '..', '..', 'data');

// DATA_DIR final: prioridad ENV > RENDER > LOCAL
const BASE = ENV_DIR || RENDER_DIR || LOCAL_DIR;
const SOURCE = ENV_DIR
  ? { type: "env", value: ENV_DIR }
  : RENDER_DIR
  ? { type: "render", value: RENDER_DIR }
  : { type: "local", value: LOCAL_DIR };

// Asegurar que exista
try { fs.mkdirSync(BASE, { recursive: true }); } catch {}

// Si estamos usando un directorio distinto al local y faltan datos,
// copiar el contenido de la carpeta de ejemplo para evitar errores.
if (BASE !== LOCAL_DIR) {
  try {
    const sample = path.join(BASE, 'products.json');
    if (!fs.existsSync(sample)) {
      for (const f of fs.readdirSync(LOCAL_DIR)) {
        const src = path.join(LOCAL_DIR, f);
        const dest = path.join(BASE, f);
        if (fs.existsSync(dest)) continue;
        const stat = fs.statSync(src);
        if (stat.isFile()) {
          fs.copyFileSync(src, dest);
        }
      }
    }
  } catch (e) {
    console.error('cannot seed data dir', e);
  }
}

// API
module.exports = {
  DATA_DIR: BASE,
  dataPath: (file) => path.join(BASE, file),
  DATA_SOURCE: SOURCE,
  IS_PERSISTENT: SOURCE.type !== 'local',
};
