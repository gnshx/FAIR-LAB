const crypto = require('crypto');
const { getDb } = require('../db/database');
const config = require('../config');

const SESSION_COOKIE_NAME = 'fairlab_session';
const TOKEN_TTL_SECONDS = 8 * 60 * 60; // 8 hours

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

/**
 * Signs a compact HS256 JWT (header.payload.signature) using config.JWT_SECRET.
 */
function signAuthToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const perms = parsePermissions(user.permissions);
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    sub: user.user_id,
    email: user.email,
    role: user.role,
    permissions: perms,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS
  }));
  const data = `${header}.${payload}`;
  const sig = crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${sig}`;
}

/**
 * Verifies HS256 JWT using constant-time comparison and checks expiration.
 */
function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(base64UrlDecode(payload));
    const now = Math.floor(Date.now() / 1000);
    if (!decoded.sub || typeof decoded.exp !== 'number' || decoded.exp < now) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return map;
  cookieHeader.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      map[k] = decodeURIComponent(v);
    }
  });
  return map;
}

function parsePermissions(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function hasPermission(user, perm) {
  if (!user) return false;
  const perms = parsePermissions(user.permissions);
  return perms.includes(perm);
}

/**
 * Authentication Resolution (Zero-Trust Identity Extraction):
 * 1. Primary path: Verified HS256 JWT from `Authorization: Bearer <token>` OR `HttpOnly` cookie `fairlab_session`.
 * 2. Dev/test compatibility ONLY (`NODE_ENV !== 'production'`): falls back to `x-user-id` for local test harnesses.
 *    In production (`NODE_ENV === 'production'`), client-supplied `x-user-id` is strictly ignored.
 */
function resolveAuthenticatedUser(req, defaultUserId = null) {
  let resolvedUserId = null;
  let authSource = null;

  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const verified = verifyAuthToken(authHeader.slice(7).trim());
    if (verified && verified.sub) {
      resolvedUserId = verified.sub;
      authSource = 'JWT_BEARER';
    } else {
      return null; // Explicitly reject malformed/expired Bearer token
    }
  }

  if (!resolvedUserId && req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[SESSION_COOKIE_NAME]) {
      const verified = verifyAuthToken(cookies[SESSION_COOKIE_NAME]);
      if (verified && verified.sub) {
        resolvedUserId = verified.sub;
        authSource = 'SESSION_COOKIE';
      }
    }
  }

  // Strictly block client-supplied x-user-id in production
  if (!resolvedUserId && process.env.NODE_ENV !== 'production') {
    const devHeader = req.headers['x-user-id'] || defaultUserId;
    if (devHeader && typeof devHeader === 'string' && devHeader.length <= 100) {
      resolvedUserId = devHeader;
      authSource = 'DEV_HEADER';
    }
  }

  if (!resolvedUserId) return null;

  const db = getDb();
  const user = db.prepare(
    'SELECT user_id, name, roll_no, email, role, permissions, department FROM users WHERE user_id = ?'
  ).get(resolvedUserId);

  if (!user) return null;
  return {
    ...user,
    permissions: parsePermissions(user.permissions),
    authSource
  };
}

function requireUser(req, res, next) {
  const user = resolveAuthenticatedUser(req, null);
  if (!user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Valid signed session or Bearer JWT is required.'
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
      message: 'Administrator authentication is required for this endpoint.'
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

/**
 * Enforces the two-role model (student / admin) with scoped ACCESS_OPERATOR permission
 * for physical gate check-in / check-out operations (preserving legacy watchman test compat).
 */
function requireAccessOperator(req, res, next) {
  const user = resolveAuthenticatedUser(req, null);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const allowed =
    (user.role === 'admin' && hasPermission(user, 'ACCESS_OPERATOR')) ||
    user.role === 'watchman';
  if (!allowed) {
    return res.status(403).json({
      error: 'Unauthorized turnstile operation',
      message: 'Only designated Admin accounts holding the ACCESS_OPERATOR permission may operate Lab L-106 gate check-in/out.'
    });
  }
  req.user = user;
  next();
}

function setSessionCookie(res, token) {
  const secureAttr = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL_SECONDS}${secureAttr}`
  );
}

function clearSessionCookie(res) {
  const secureAttr = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureAttr}`
  );
}

/**
 * Sliding-window per-user rate limiter keyed by verified user_id or IP.
 */
function createRateLimiter({ windowMs = 60000, maxRequests = 60 } = {}) {
  const buckets = new Map();

  return (req, res, next) => {
    const devHeader = process.env.NODE_ENV !== 'production' ? req.headers['x-user-id'] : null;
    const key = (req.user && req.user.user_id) || devHeader || req.ip || 'anonymous';
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

    if (buckets.size > 5000) {
      for (const [k, v] of buckets.entries()) {
        if (v.length === 0 || now - v[v.length - 1] > windowMs) buckets.delete(k);
      }
    }
    next();
  };
}

module.exports = {
  SESSION_COOKIE_NAME,
  signAuthToken,
  verifyAuthToken,
  parsePermissions,
  hasPermission,
  setSessionCookie,
  clearSessionCookie,
  resolveAuthenticatedUser,
  requireUser,
  requireAdmin,
  requireAccessOperator,
  requireGateOperator: requireAccessOperator,
  createRateLimiter
};
