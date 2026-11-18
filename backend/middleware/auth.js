const { getDb } = require('../db/database');

/**
 * Resolves and validates the calling user from x-user-id header.
 * Rejects forged or non-existent user IDs with 401 Unauthorized.
 */
function resolveAuthenticatedUser(req, defaultUserId = null) {
  const userId = req.headers['x-user-id'] || defaultUserId;
  if (!userId || typeof userId !== 'string' || userId.length > 100) {
    return null;
  }
  const db = getDb();
  return db.prepare('SELECT user_id, name, roll_no, role, department FROM users WHERE user_id = ?').get(userId) || null;
}

function requireUser(req, res, next) {
  const user = resolveAuthenticatedUser(req, null);
  if (!user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Valid registered user credentials (x-user-id) are required.'
    });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = resolveAuthenticatedUser(req, null);
  if (!user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Administrator credentials are required for this endpoint.'
    });
  }
  if (user.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden: Administrator role required',
      message: `Role "${user.role}" is not permitted to perform administrative actions.`
    });
  }
  req.user = user;
  next();
}

function requireGateOperator(req, res, next) {
  const user = resolveAuthenticatedUser(req, null);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (user.role !== 'watchman' && user.role !== 'admin') {
    return res.status(403).json({
      error: 'Unauthorized turnstile operation',
      message: 'Only registered campus security personnel (watchman) or administrators may operate the gate.'
    });
  }
  req.user = user;
  next();
}

/**
 * Sliding-window per-user rate limiter to throttle bot spam while allowing
 * multi-student concurrency bursts (keyed by x-user-id, falling back to IP).
 */
function createRateLimiter({ windowMs = 60000, maxRequests = 60 } = {}) {
  const buckets = new Map();

  return (req, res, next) => {
    const key = req.headers['x-user-id'] || req.ip || 'anonymous';
    const now = Date.now();
    const entry = buckets.get(key) || [];
    const recent = entry.filter(ts => now - ts < windowMs);

    if (recent.length >= maxRequests) {
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded (${maxRequests} requests per ${Math.round(windowMs / 1000)}s). Try again shortly.`
      });
    }

    recent.push(now);
    buckets.set(key, recent);

    // Opportunistic cleanup so memory stays bounded
    if (buckets.size > 5000) {
      for (const [k, v] of buckets.entries()) {
        if (v.length === 0 || now - v[v.length - 1] > windowMs) buckets.delete(k);
      }
    }
    next();
  };
}

module.exports = {
  resolveAuthenticatedUser,
  requireUser,
  requireAdmin,
  requireGateOperator,
  createRateLimiter
};

