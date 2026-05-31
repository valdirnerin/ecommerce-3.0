#!/usr/bin/env node
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const sqlite3 = require('sqlite3');
const productsRepo = require('../backend/data/productsSqliteRepo');

const DATABASE_PATH = productsRepo.SQLITE_PATH;
const BACKUP_DIR = process.env.SQLITE_BACKUP_DIR || path.join(path.dirname(DATABASE_PATH), 'backups');
const KEEP = Math.max(1, Number(process.env.SQLITE_BACKUP_KEEP || 7) || 7);

function openDb(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (error) => (error ? reject(error) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (error) => (error ? reject(error) : resolve()));
  });
}

function close(db) {
  return new Promise((resolve, reject) => db.close((error) => (error ? reject(error) : resolve())));
}

async function copyIfExists(source, target) {
  try {
    await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'EEXIST')) return false;
    throw error;
  }
}

async function rotateBackups() {
  const entries = await fsp.readdir(BACKUP_DIR, { withFileTypes: true }).catch(() => []);
  const manifests = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.manifest.json')) continue;
    const filePath = path.join(BACKUP_DIR, entry.name);
    const stat = await fsp.stat(filePath).catch(() => null);
    if (stat) manifests.push({ filePath, name: entry.name, mtimeMs: stat.mtimeMs });
  }
  manifests.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const old of manifests.slice(KEEP)) {
    const prefix = old.name.replace(/\.manifest\.json$/, '');
    for (const suffix of ['.sqlite', '.sqlite-wal', '.sqlite-shm', '.manifest.json']) {
      await fsp.unlink(path.join(BACKUP_DIR, `${prefix}${suffix}`)).catch(() => {});
    }
  }
}

async function main() {
  if (!fs.existsSync(DATABASE_PATH)) {
    throw new Error(`SQLite database not found: ${DATABASE_PATH}`);
  }
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = `nerinparts-${stamp}`;
  const db = await openDb(DATABASE_PATH);
  try {
    await run(db, 'PRAGMA busy_timeout = 5000');
    await run(db, 'PRAGMA wal_checkpoint(FULL)');
  } finally {
    await close(db);
  }

  const copied = [];
  const files = [
    { source: DATABASE_PATH, target: path.join(BACKUP_DIR, `${prefix}.sqlite`) },
    { source: `${DATABASE_PATH}-wal`, target: path.join(BACKUP_DIR, `${prefix}.sqlite-wal`) },
    { source: `${DATABASE_PATH}-shm`, target: path.join(BACKUP_DIR, `${prefix}.sqlite-shm`) },
  ];
  for (const file of files) {
    if (await copyIfExists(file.source, file.target)) copied.push(file.target);
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    databasePath: DATABASE_PATH,
    backupDir: BACKUP_DIR,
    files: copied.map((file) => path.basename(file)),
    restore: 'Stop the Render service, copy the .sqlite file back to DATABASE_PATH and, if present, copy matching -wal/-shm files, then restart.',
  };
  await fsp.writeFile(path.join(BACKUP_DIR, `${prefix}.manifest.json`), JSON.stringify(manifest, null, 2), 'utf8');
  await rotateBackups();
  console.log(JSON.stringify({ ok: true, ...manifest }, null, 2));
}

main().catch((error) => {
  console.error('[backup-sqlite] failed:', error?.message || error);
  process.exitCode = 1;
});
