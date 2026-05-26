const fs = require('fs');
const path = require('path');
const server = fs.readFileSync(path.join(__dirname,'../backend/server.js'),'utf8');
const checks = [
  ['live skip archive', /analytics\/live[\s\S]*skipArchive:\s*true/.test(server)],
  ['detailed default today', /query\.range \|\| "today"/.test(server)],
  ['max events detailed', /ANALYTICS_MAX_EVENTS_DETAILED/.test(server)],
  ['parallel guard', /analyticsDetailedRunning/.test(server)],
  ['catalog snapshot flag', /ANALYTICS_CATALOG_SNAPSHOT_ENABLED/.test(server)],
  ['stable cache key', /range=\$\{rangeKey\}/.test(server)],
  ['no readFileSync mass on detailed route', !/\/api\/analytics\/detailed[\s\S]*readFileSync/.test(server)],
];
let ok=true;
for (const [name,pass] of checks){ console.log(name, pass?'OK':'FAIL'); if(!pass) ok=false; }
process.exit(ok?0:1);
