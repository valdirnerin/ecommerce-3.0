const cleanup = require('../utils/cleanup');
cleanup().catch((e) => {
  console.error('cleanup failed', e);
  process.exit(1);
});
