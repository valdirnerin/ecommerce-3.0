const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.css', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);

const targetRoots = [
  'frontend',
  'public',
  'views',
  'nerin_final_updated',
].map((dir) => path.join(ROOT, dir));

const countMojibake = (value) => (value.match(/[ÃÂ]/g) || []).length;

const shouldSkipDir = (dirPath) =>
  dirPath.split(path.sep).some((segment) => SKIP_DIRS.has(segment));

const walk = (dirPath, files = []) => {
  if (!fs.existsSync(dirPath) || shouldSkipDir(dirPath)) return files;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(fullPath)) continue;
      walk(fullPath, files);
    } else if (entry.isFile()) {
      if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  return files;
};

const fixFile = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('Ã') && !content.includes('Â')) return false;

  const fixed = Buffer.from(content, 'latin1').toString('utf8');
  const originalCount = countMojibake(content);
  const fixedCount = countMojibake(fixed);

  if (fixed.includes('�')) return false;
  if (fixedCount >= originalCount) return false;

  fs.writeFileSync(filePath, fixed, 'utf8');
  return true;
};

const files = targetRoots.flatMap((dir) => walk(dir));
const updated = [];

for (const filePath of files) {
  if (fixFile(filePath)) {
    updated.push(path.relative(ROOT, filePath));
  }
}

if (updated.length === 0) {
  console.log('No mojibake fixes were needed.');
} else {
  console.log('Updated files:');
  updated.forEach((file) => console.log(`- ${file}`));
}
