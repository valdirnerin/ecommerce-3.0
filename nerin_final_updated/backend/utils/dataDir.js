const path = require('path');
const fs = require('fs');

/*
 * Determina la ruta base para almacenar datos persistentes.  
 *
 * - Si la variable de entorno DATA_DIR está definida, se utiliza esa ruta.
 * - Si existe la carpeta `/var/data` (por ejemplo, en Render al montar un disco persistente),
 *   se usa `/var/data/nerin` como directorio por defecto. Render monta discos en /var/data.
 * - En entornos de desarrollo local donde `/var/data` no existe, se usa la carpeta
 *   `data` dentro del proyecto. Esta última es efímera en servicios como Render,
 *   por lo que se recomienda montar un disco para producción.
 */

// Ruta definida por la variable de entorno, si existe
const envDir = process.env.DATA_DIR;

// Ruta por defecto en Render si hay disco montado en /var/data
const renderVarData = '/var/data';
const hasVarData = fs.existsSync(renderVarData);
const defaultOnRender = path.join(renderVarData, 'nerin');

// Ruta local para desarrollo: carpeta data en el repositorio
const localDir = path.join(__dirname, '..', '..', 'data');

// Elegir la mejor ruta disponible
const DATA_DIR = envDir || (hasVarData ? defaultOnRender : localDir);

// Asegurar que el directorio existe
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  // Ignorar errores de creación; fallará al escribir si hay un problema real
}

module.exports = DATA_DIR;
