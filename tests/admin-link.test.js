const fs = require('fs');
const path = require('path');
const assert = require('assert');

// directories containing html files
const directories = [
  path.join(__dirname, '..', 'frontend'),
  path.join(__dirname, '..', 'nerin_final_updated', 'frontend')
];

let badFiles = [];
for (const dir of directories) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    if (content.includes('/admin.html')) {
      badFiles.push(path.join(path.basename(dir), file));
    }
  }
}

assert.strictEqual(badFiles.length, 0, `Found static admin link in: ${badFiles.join(', ')}`);
console.log('Admin link test passed');
