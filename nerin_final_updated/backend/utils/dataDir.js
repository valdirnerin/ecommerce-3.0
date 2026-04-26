// nerin_final_updated/backend/utils/dataDir.js
const path = require('path');
const fs = require('fs');

// 1) Si definiste DATA_DIR en Render, usamos eso
const ENV_DIR = process.env.DATA_DIR;
const RENDER_MOUNT_DIR = process.env.RENDER_DISK_MOUNT_PATH;

// 2) Si tenés el disco montado en /var/nerin-data (lo que muestra tu log), usamos ahí.
//    Si en tu servicio lo montaste en /var/data, también lo detectamos y preferimos /var/data/nerin.
const CANDIDATES = [
  // Si Render monta en /var/data, priorizamos una carpeta de app explícita
  RENDER_MOUNT_DIR ? path.join(RENDER_MOUNT_DIR, 'nerin_final_updated') : null,
  RENDER_MOUNT_DIR,
  '/var/data/nerin_final_updated',
  '/var/data/nerin',
  '/var/nerin-data',
  '/var/data',
].filter(Boolean);

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

// No sembrar products.json automáticamente:
// si falta, preferimos fallar de forma explícita antes que introducir catálogo demo.

// API
module.exports = {
  DATA_DIR: BASE,
  dataPath: (file) => path.join(BASE, file),
  DATA_SOURCE: SOURCE,
  IS_PERSISTENT: SOURCE.type !== 'local',
};
