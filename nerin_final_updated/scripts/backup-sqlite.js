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
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (error) => (error ? reject(error) : resolve(db)));
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

function backupOnline(db, targetPath) {
  return new Promise((resolve, reject) => {
    const backup = db.backup(targetPath, (error) => {
      backup.finish((finishError) => {
        if (error || finishError) reject(error || finishError);
        else resolve();
      });
    });
  });
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
    for (const suffix of ['.sqlite', '.manifest.json']) {
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
  const backupPath = path.join(BACKUP_DIR, `${prefix}.sqlite`);
  const db = await openDb(DATABASE_PATH);
  try {
    await run(db, 'PRAGMA busy_timeout = 5000');
    await backupOnline(db, backupPath);
  } finally {
    await close(db);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    databasePath: DATABASE_PATH,
    backupDir: BACKUP_DIR,
    method: 'sqlite_online_backup_api',
    files: [path.basename(backupPath)],
    restore: 'Stop the Render service, copy the .sqlite file back to DATABASE_PATH, then restart.',
  };
  await fsp.writeFile(path.join(BACKUP_DIR, `${prefix}.manifest.json`), JSON.stringify(manifest, null, 2), 'utf8');
  await rotateBackups();
  console.log(JSON.stringify({ ok: true, ...manifest }, null, 2));
}

main().catch((error) => {
  console.error('[backup-sqlite] failed:', error?.message || error);
  process.exitCode = 1;
});
