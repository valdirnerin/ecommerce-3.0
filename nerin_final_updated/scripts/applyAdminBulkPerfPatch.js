const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'backend/server.js');
let text = fs.readFileSync(target, 'utf8');
const before = text;

text = text.replace(
  '        reindex: payload.reindex !== false,',
  '        reindex: false,',
);

text = text.replace(
  '      rebuildsFullCatalog: false,',
  '      rebuildsFullCatalog: false,\n      cacheInvalidation: "once_per_batch",\n      duplicateReindexSuppressed: true,',
);

if (text !== before) {
  fs.writeFileSync(target, text, 'utf8');
  console.log('[admin-bulk-perf-patch] updated backend/server.js');
} else {
  console.log('[admin-bulk-perf-patch] already applied');
}
