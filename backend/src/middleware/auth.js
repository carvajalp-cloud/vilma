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
      // Customers this non-admin user may access (empty for admins, who see all).
      adoms: Array.isArray(payload.adoms) ? payload.adoms : (payload.adom_id != null ? [payload.adom_id] : []),
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
// - Non-admins are restricted to the set of customers assigned to them; they view one
//   at a time (?adom=<id> must be one of theirs, else it defaults to their first).
// Attaches req.adomScope = number | null  (null = all ADOMs, admin only).
export function resolveAdomScope(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role === 'admin') {
    const q = req.query.adom;
    req.adomScope = q != null && q !== '' && q !== 'all' ? parseInt(q, 10) : null;
    return next();
  }
  const allowed = req.user.adoms && req.user.adoms.length
    ? req.user.adoms
    : (req.user.adom_id != null ? [req.user.adom_id] : []);
  if (!allowed.length) {
    return res.status(403).json({ error: 'User is not assigned to any customer' });
  }
  const q = req.query.adom;
  const requested = q != null && q !== '' && q !== 'all' ? parseInt(q, 10) : null;
  // Honor the requested customer only if it's one the user is allowed to see.
  req.adomScope = requested != null && allowed.includes(requested) ? requested : allowed[0];
  next();
}

// Builds a SQL "WHERE adom_id = $n" fragment honoring the scope.
// Returns { clause, params } where clause is '' when scope is null (all).
export function adomFilter(scope, startIndex = 1) {
  if (scope == null) return { clause: '', params: [], nextIndex: startIndex };
  return { clause: `adom_id = $${startIndex}`, params: [scope], nextIndex: startIndex + 1 };
}

// Visibility predicate for device-bound rows (logs / events): the row is visible to
// `scope` if it's owned by scope OR its device is shared with scope (device_viewers).
// The single `scope` param is referenced twice via the same placeholder $idx.
// scope === null  => '' (admin sees everything). Pass the alias of the logs/events table.
export function deviceVisibility(scope, alias, idx) {
  if (scope == null) return { clause: '', params: [] };
  const a = alias ? `${alias}.` : '';
  return {
    clause: `(${a}adom_id = $${idx} OR ${a}device_id IN (SELECT device_id FROM device_viewers WHERE adom_id = $${idx}))`,
    params: [scope],
  };
}

// Visibility predicate for the devices table itself: owned by scope OR shared to scope.
export function deviceRowVisibility(scope, alias, idx) {
  if (scope == null) return { clause: '', params: [] };
  return {
    clause: `(${alias}.adom_id = $${idx} OR EXISTS (SELECT 1 FROM device_viewers dv WHERE dv.device_id = ${alias}.id AND dv.adom_id = $${idx}))`,
    params: [scope],
  };
}
