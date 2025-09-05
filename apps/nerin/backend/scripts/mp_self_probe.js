#!/usr/bin/env node
const crypto = require('crypto');
const fetchFn =
  globalThis.fetch ||
  ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));

const PORT = process.env.PORT || 3000;
const secret = process.env.MP_WEBHOOK_SECRET || '';
const bodyObj = { type: 'self-test', id: Date.now() };
const body = JSON.stringify(bodyObj);
const signature = secret
  ? crypto.createHmac('sha256', secret).update(body).digest('hex')
  : '';

async function main() {
  try {
    const res = await fetchFn(
      `http://127.0.0.1:${PORT}/api/webhooks/mp?probe=1`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signature ? { 'x-signature': signature } : {}),
          'x-self-test': '1',
        },
        body,
      },
    );
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      console.log(JSON.stringify(json, null, 2));
      if (!res.ok) process.exit(1);
    } catch {
      console.log(
        JSON.stringify({ handler_200: res.ok, raw: text }, null, 2),
      );
      if (!res.ok) process.exit(1);
    }
  } catch (e) {
    console.error('self-probe failed', e.message);
    process.exit(1);
  }
}
main();
