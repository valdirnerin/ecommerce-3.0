#!/usr/bin/env node
require('dotenv').config();
const args = process.argv.slice(2);
const idx = args.indexOf('--external');
if (idx === -1 || !args[idx + 1]) {
  console.error('Usage: npm run mp:trace -- --external <ref>');
  process.exit(1);
}
const external = args[idx + 1];
const fetchFn =
  globalThis.fetch ||
  ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));
const port = process.env.PORT || 3000;
const base = `http://127.0.0.1:${port}`;
async function run() {
  const secret = process.env.DIAG_SECRET;
  const diagUrl = `${base}/ops/order-status/${encodeURIComponent(external)}${
    secret ? `?secret=${encodeURIComponent(secret)}` : ''
  }`;
  const diagRes = await fetchFn(diagUrl);
  const diag = await diagRes.json();
  const uiUrl = `${base}/api/orders/${encodeURIComponent(external)}/status`;
  const uiRes = await fetchFn(uiUrl);
  const uiJson = await uiRes.json();
  const result = {
    db_status: diag.db_status || null,
    updated_at: diag.updated_at || null,
    payment_id: diag.payment_id || null,
    merchant_order_id: diag.merchant_order_id || null,
    preference_id: diag.preference_id || null,
    last_webhook: diag.last_webhook || null,
    mapping_used: diag.mapping_used || null,
    api_response: {
      url: uiUrl,
      json: uiJson,
      headers: { 'cache-control': uiRes.headers.get('cache-control') },
    },
  };
  console.log(JSON.stringify(result, null, 2));
}
run().catch((e) => {
  console.error('trace error', e.message);
  process.exit(1);
});
