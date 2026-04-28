const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoPath = path.join(__dirname, '../backend/data/productsSqliteRepo');
const repo = require(repoPath);

const sqlitePath = repo.SQLITE_PATH;

function runNodeEval(code) {
  const result = spawnSync(process.execPath, ['-e', code], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`child process failed status=${result.status}`);
  }
}

(async () => {
  console.log('[test-corrupt] ensure baseline db');
  runNodeEval(`const repo=require(${JSON.stringify(repoPath)}); repo.ensureProductsDbOnce().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});`);

  console.log('[test-corrupt] writing garbage sqlite file');
  try { fs.unlinkSync(`${sqlitePath}-wal`); } catch {}
  try { fs.unlinkSync(`${sqlitePath}-shm`); } catch {}
  fs.writeFileSync(sqlitePath, Buffer.from('not-a-sqlite-database', 'utf8'));

  console.log('[test-corrupt] running ensureProductsDbOnce (should detect + repair)');
  await repo.ensureProductsDbOnce();

  const health = await repo.getCatalogHealth();
  if (!health || !health.ready) {
    throw new Error('[test-corrupt] expected ready=true after repair');
  }
  if (!health.sqliteExists) {
    throw new Error('[test-corrupt] expected sqliteExists=true after repair');
  }

  const page = await repo.queryProducts({ page: 1, pageSize: 5 });
  if (!page || page.source !== 'sqlite' || !Array.isArray(page.items)) {
    throw new Error('[test-corrupt] expected sqlite query response');
  }

  console.log('[test-corrupt] ok', {
    ready: health.ready,
    corruptDetected: health.corruptDetected,
    productCount: health.productCount,
    source: page.source,
  });
})().catch((error) => {
  console.error('[test-corrupt] failed', error);
  process.exit(1);
});
