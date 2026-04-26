const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { importCatalogCsvFile } = require("../services/catalogCsvImport");
const { DATA_DIR } = require("../utils/dataDir");

const IMPORT_JOBS_DIR = path.join(DATA_DIR, "import-jobs");

function jobFilePath(jobId) {
  return path.join(IMPORT_JOBS_DIR, `${String(jobId || "").replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
}

async function readJob(jobId) {
  try {
    const raw = await fsp.readFile(jobFilePath(jobId), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJob(jobId, patch = {}) {
  await fsp.mkdir(IMPORT_JOBS_DIR, { recursive: true });
  const current = (await readJob(jobId)) || {
    jobId,
    type: "catalog_csv",
    status: "queued",
    progress: 0,
    processedRows: 0,
    totalRows: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    message: "En cola…",
    summary: null,
    error: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const target = jobFilePath(jobId);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fsp.rename(tmp, target);
  return next;
}

async function main() {
  const jobId = String(process.env.IMPORT_JOB_ID || "").trim();
  const filePath = String(process.env.IMPORT_FILE_PATH || "").trim();
  const chunkSize = Number(process.env.IMPORT_CHUNK_SIZE || 400);
  const includeOutOfStock = process.env.IMPORT_INCLUDE_OUT_OF_STOCK === "1";
  const archiveMissing = process.env.IMPORT_ARCHIVE_MISSING === "1";

  if (!jobId || !filePath) {
    throw new Error("Faltan parámetros de importación para el worker CSV");
  }

  console.info("[csv-import-worker:start]", { jobId, filePath, includeOutOfStock, archiveMissing });
  await writeJob(jobId, {
    status: "running",
    progress: 0,
    message: "Importando catálogo…",
  });

  let lastProgressAt = 0;
  let lastProgressPercent = -1;
  const pushProgress = async (payload = {}) => {
    const totalRows = Number(payload.totalRows || 0);
    const processedRows = Number(payload.processedRows || 0);
    const progress = totalRows > 0 ? Math.min(99, Math.floor((processedRows / totalRows) * 100)) : 0;
    const now = Date.now();
    const changedPercent = progress > lastProgressPercent;
    if (!changedPercent && now - lastProgressAt < 1000) return;
    lastProgressAt = now;
    lastProgressPercent = progress;
    const patch = {
      status: "running",
      progress,
      processedRows,
      totalRows,
      inserted: Number(payload.inserted || 0),
      updated: Number(payload.updated || 0),
      skipped: Number(payload.skipped || 0),
      errors: Number(payload.failed || payload.errors || 0),
      message: "Importando catálogo…",
    };
    console.info("[csv-import-worker:progress]", { jobId, ...patch });
    await writeJob(jobId, patch);
    if (typeof process.send === "function") process.send({ type: "progress", ...patch });
  };

  try {
    const summary = await importCatalogCsvFile({
      filePath,
      chunkSize,
      includeOutOfStock,
      archiveMissing,
      jobId,
      onProgress: (payload) => {
        pushProgress(payload).catch((error) => {
          console.error("[csv-import-worker:progress-write-error]", error?.message || error);
        });
      },
    });

    console.info("[csv-import-worker:staging-written]", {
      jobId,
      stagingPath: summary.stagingPath,
    });
    console.info("[csv-import-worker:products-renamed]", {
      jobId,
      productsFilePath: summary.productsFilePath,
    });

    const completedPatch = {
      status: "completed",
      progress: 100,
      processedRows: Number(summary.totalRows || 0),
      totalRows: Number(summary.totalRows || 0),
      inserted: Number(summary.inserted || 0),
      updated: Number(summary.updated || 0),
      skipped: Number(summary.skipped || 0),
      errors: Number(summary.failed || 0),
      message: "Importación completada.",
      summary,
    };
    await writeJob(jobId, completedPatch);
    if (typeof process.send === "function") process.send({ type: "completed", ...completedPatch });
    console.info("[csv-import-worker:completed]", {
      jobId,
      inserted: summary.inserted,
      updated: summary.updated,
      skipped: summary.skipped,
      errorsCount: summary.errorsCount,
      catalogFinal: summary.catalog?.totalProductsAfterImport,
    });
  } catch (error) {
    const usage = process.memoryUsage();
    const failedPatch = {
      status: "failed",
      message: error?.message || "Error al importar catálogo CSV",
      error: error?.message || "Error al importar catálogo CSV",
      summary: {
        processedRows: Number(error?.processedRows || 0),
        heapUsedMB: Number((usage.heapUsed / (1024 * 1024)).toFixed(1)),
        rssMB: Number((usage.rss / (1024 * 1024)).toFixed(1)),
        stagingPath: error?.stagingPath || null,
        productsFilePath: error?.productsFilePath || null,
      },
    };
    await writeJob(jobId, failedPatch);
    if (typeof process.send === "function") process.send({ type: "failed", ...failedPatch });
    console.error("[csv-import-worker:failed]", {
      jobId,
      message: failedPatch.error,
      stack: error?.stack || null,
      ...failedPatch.summary,
    });
    process.exitCode = 1;
  } finally {
    try {
      await fsp.unlink(filePath);
    } catch {}
  }
}

main();
