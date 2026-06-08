import jwt from 'jsonwebtoken';
import config from '../config.js';

// Verifies the Bearer token and attaches req.user = { id, username, role, adom_id }.
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authentication token' });
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      adom_id: payload.adom_id ?? null,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Role gate. Usage: requireRole('admin') or requireRole('admin','analyst').
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

// Resolves the effective ADOM scope for the request.
// - Admins may target any ADOM via ?adom=<id> (or see all when omitted -> null).
// - Non-admins are locked to their assigned adom_id.
// Attaches req.adomScope = number | null  (null = all ADOMs, admin only).
export function resolveAdomScope(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role === 'admin') {
    const q = req.query.adom;
    req.adomScope = q != null && q !== '' && q !== 'all' ? parseInt(q, 10) : null;
  } else {
    if (req.user.adom_id == null) {
      return res.status(403).json({ error: 'User is not assigned to an ADOM' });
    }
    req.adomScope = req.user.adom_id;
  }
  next();
}

// Builds a SQL "WHERE adom_id = $n" fragment honoring the scope.
// Returns { clause, params } where clause is '' when scope is null (all).
export function adomFilter(scope, startIndex = 1) {
  if (scope == null) return { clause: '', params: [], nextIndex: startIndex };
  return { clause: `adom_id = $${startIndex}`, params: [scope], nextIndex: startIndex + 1 };
}
