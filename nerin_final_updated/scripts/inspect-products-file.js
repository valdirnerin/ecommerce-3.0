#!/usr/bin/env node

const fs = require("fs");
const productsStreamRepo = require("../backend/data/productsStreamRepo");

async function run() {
  const filePath = productsStreamRepo.productsFilePath;
  const exists = fs.existsSync(filePath);
  const sizeBytes = exists ? Number(fs.statSync(filePath).size || 0) : 0;

  console.log(`[inspect-products] path: ${filePath}`);
  console.log(`[inspect-products] exists: ${exists}`);
  console.log(`[inspect-products] sizeBytes: ${sizeBytes}`);

  if (!exists) {
    process.exitCode = 1;
    return;
  }

  try {
    const count = await productsStreamRepo.countProductsStreaming();
    console.log(`[inspect-products] validJson: true`);
    console.log(`[inspect-products] productCount: ${count}`);
  } catch (err) {
    console.log(`[inspect-products] validJson: false`);
    console.log(`[inspect-products] error: ${err?.message || err}`);
    const backups = productsStreamRepo.getBackupCandidates();
    console.log(`[inspect-products] backupCandidates: ${backups.length}`);
    backups.forEach((item) => {
      console.log(`- ${item.file} | size=${item.sizeBytes} | modifiedAt=${item.modifiedAt}`);
    });
    process.exitCode = 2;
  }
}

run();
