#!/usr/bin/env node
const fetchFn = globalThis.fetch || ((...a) => import('node-fetch').then(({default:f})=>f(...a)));
const PORT = process.env.PORT || 3000;
const target = (process.env.MP_NOTIFICATION_URL || `http://localhost:${PORT}/api/webhooks/mp`).replace(/\/$/, '');
async function main(){
  try{
    const res = await fetchFn(target,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({type:'test', id: Date.now()})
    });
    console.log('Webhook response status:', res.status);
    const text = await res.text().catch(()=> '');
    if(text) console.log('Body:', text);
    if(!res.ok) process.exit(1);
  }catch(e){
    console.error('Webhook probe failed', e.message);
    process.exit(1);
  }
}
main();
