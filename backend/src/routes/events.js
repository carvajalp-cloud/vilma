import express from 'express';
import pool from '../db/pool.js';
import { authenticate, resolveAdomScope, requireRole, deviceVisibility } from '../middleware/auth.js';
import { invalidateRuleCache } from '../services/alerting.js';

const router = express.Router();

const VALID_TYPES = ['any', 'traffic', 'threat', 'event', 'system'];
const VALID_OPS = ['any', 'eq', 'neq', 'contains'];

// GET /api/events?status=&category=&max_sev=&limit=&offset=
router.get('/', authenticate, resolveAdomScope, async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const params = [];
    const conds = [];
    if (scope != null) { params.push(scope); conds.push(deviceVisibility(scope, 'e', params.length).clause); }
    if (req.query.status) { params.push(req.query.status); conds.push(`e.status = $${params.length}`); }
    if (req.query.category) { params.push(req.query.category); conds.push(`e.category = $${params.length}`); }
    if (req.query.max_sev) { params.push(parseInt(req.query.max_sev, 10)); conds.push(`e.sev_level <= $${params.length}`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);

    const countRes = await pool.query(`SELECT count(*)::int AS total FROM events e ${where}`, params);
    params.push(limit); params.push(offset);
    const r = await pool.query(
      `SELECT e.*, d.name AS device_name, u.username AS assignee
       FROM events e
       LEFT JOIN devices d ON d.id = e.device_id
       LEFT JOIN users u ON u.id = e.assigned_to
       ${where}
       ORDER BY e.ts DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ total: countRes.rows[0].total, limit, offset, rows: r.rows });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:id  -- update status / assignment (admin/analyst)
router.patch('/:id', authenticate, resolveAdomScope, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, assigned_to } = req.body || {};
    if (status && !['open', 'ack', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    const params = [status ?? null, assigned_to ?? null, id];
    let guard = '';
    if (req.adomScope != null) { params.push(req.adomScope); guard = ` AND adom_id = $${params.length}`; }
    const r = await pool.query(
      `UPDATE events SET
         status = COALESCE($1,status),
         assigned_to = COALESCE($2,assigned_to)
       WHERE id = $3 ${guard} RETURNING *`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Event not found' });
    res.json(r.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// Event definitions ("alert rules"): which logs become events.
// A log raises an event when it matches a rule's customer (ADOM),
// log type, severity threshold (sev_level <= sev_min) and optional
// field condition. Managed here; evaluated in services/alerting.js.
// ------------------------------------------------------------------

// GET /api/events/rules/list -- list rules (filtered by selected customer)
router.get('/rules/list', authenticate, resolveAdomScope, async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const params = [];
    let where = '';
    if (scope != null) { params.push(scope); where = 'WHERE ar.adom_id = $1'; }
    const r = await pool.query(
      `SELECT ar.*, a.name AS adom_name
       FROM alert_rules ar JOIN adoms a ON a.id = ar.adom_id
       ${where} ORDER BY ar.id`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

// Resolve which customer (ADOM) a rule write targets.
// Admins choose explicitly via body.adom_id; analysts are locked to their own.
function resolveRuleAdom(req) {
  if (req.user.role === 'admin') {
    const id = parseInt(req.body.adom_id, 10);
    return Number.isNaN(id) ? null : id;
  }
  return req.user.adom_id ?? null;
}

function validateSev(v) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 0 || n > 7) return null;
  return n;
}

// POST /api/events/rules -- create an event definition (admin/analyst)
router.post('/rules', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const { name, log_type, sev_min, field, op, value, category, enabled } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const adomId = resolveRuleAdom(req);
    if (!adomId) {
      return res.status(400).json({ error: 'Select a customer for this event definition' });
    }
    const sev = validateSev(sev_min ?? 3);
    if (sev == null) return res.status(400).json({ error: 'severity threshold must be 0–7' });
    const lt = VALID_TYPES.includes(log_type) ? log_type : 'any';
    const operator = VALID_OPS.includes(op) ? op : 'any';

    const r = await pool.query(
      `INSERT INTO alert_rules (adom_id, name, log_type, sev_min, field, op, value, category, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [adomId, name, lt, sev, field || '', operator, value || '', category || 'General', enabled !== false]
    );
    invalidateRuleCache();
    res.status(201).json(r.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/rules/:id -- edit / enable / disable a definition (admin/analyst)
router.patch('/rules/:id', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, log_type, field, op, value, category, enabled } = req.body || {};

    let sev = null;
    if (req.body.sev_min != null) {
      sev = validateSev(req.body.sev_min);
      if (sev == null) return res.status(400).json({ error: 'severity threshold must be 0–7' });
    }
    const lt = log_type != null ? (VALID_TYPES.includes(log_type) ? log_type : null) : null;
    const operator = op != null ? (VALID_OPS.includes(op) ? op : null) : null;
    // Only admins may move a rule to a different customer.
    const newAdom = req.user.role === 'admin' && req.body.adom_id != null
      ? parseInt(req.body.adom_id, 10) : null;

    const params = [
      name ?? null, lt, sev, field ?? null, operator, value ?? null,
      category ?? null, (typeof enabled === 'boolean' ? enabled : null), newAdom, id,
    ];
    // Analysts can only touch rules in their own customer.
    let guard = '';
    if (req.user.role !== 'admin') {
      params.push(req.user.adom_id);
      guard = ` AND adom_id = $${params.length}`;
    }

    const r = await pool.query(
      `UPDATE alert_rules SET
         name = COALESCE($1,name), log_type = COALESCE($2,log_type), sev_min = COALESCE($3,sev_min),
         field = COALESCE($4,field), op = COALESCE($5,op), value = COALESCE($6,value),
         category = COALESCE($7,category), enabled = COALESCE($8,enabled),
         adom_id = COALESCE($9,adom_id)
       WHERE id = $10 ${guard} RETURNING *`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Rule not found' });
    invalidateRuleCache();
    res.json(r.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/events/rules/:id (admin/analyst)
router.delete('/rules/:id', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const params = [id];
    let guard = '';
    if (req.user.role !== 'admin') {
      params.push(req.user.adom_id);
      guard = ` AND adom_id = $${params.length}`;
    }
    const r = await pool.query(`DELETE FROM alert_rules WHERE id = $1 ${guard} RETURNING id`, params);
    if (!r.rows[0]) return res.status(404).json({ error: 'Rule not found' });
    invalidateRuleCache();
    res.json({ deleted: r.rows[0].id });
  } catch (err) {
    next(err);
  }
});

export default router;
