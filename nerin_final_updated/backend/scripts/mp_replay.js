#!/usr/bin/env node
require('dotenv').config();
const { processNotification } = require('../routes/mercadoPago');

async function main() {
  const args = process.argv.slice(2);
  let topic = null;
  let id = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--payment' || a === '-p') && args[i + 1]) {
      topic = 'payment';
      id = args[++i];
    } else if ((a === '--merchant' || a === '--merchant-order' || a === '--mo') && args[i + 1]) {
      topic = 'merchant_order';
      id = args[++i];
    }
  }
  if (!topic || !id) {
    console.error('Usage: mp:replay -- --payment <id>');
    process.exit(1);
  }
  try {
    await processNotification(topic, id);
    console.log('Replay processed');
  } catch (e) {
    console.error('Replay failed', e.message);
    process.exit(1);
  }
}

main();
