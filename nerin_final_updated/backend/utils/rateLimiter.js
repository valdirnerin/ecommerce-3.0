const buckets = new Map();

function getBucket(key) {
  if (!buckets.has(key)) {
    buckets.set(key, { count: 0, resetAt: 0 });
  }
  return buckets.get(key);
}

function checkRateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const bucket = getBucket(key);
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  const remaining = Math.max(0, limit - bucket.count);
  return {
    allowed: bucket.count <= limit,
    remaining,
    resetAt: bucket.resetAt,
  };
}

module.exports = { checkRateLimit };
