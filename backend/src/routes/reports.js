import express from 'express';
import pool from '../db/pool.js';
import { authenticate, resolveAdomScope, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Builds report data on the fly from logs/events.
async function buildReport(type, adomId, hours) {
  const scopeParams = [];
  let scopeClause = `ts > now() - interval '${hours} hours'`;
  if (adomId != null) { scopeParams.push(adomId); scopeClause += ` AND adom_id = $1`; }

  switch (type) {
    case 'traffic_summary': {
      const r = await pool.query(
        `SELECT log_type, count(*)::int AS count,
                coalesce(sum(bytes_sent+bytes_recv),0)::bigint AS bytes
         FROM logs WHERE ${scopeClause} GROUP BY log_type ORDER BY count DESC`,
        scopeParams
      );
      const apps = await pool.query(
        `SELECT app AS key, count(*)::int AS count FROM logs
         WHERE ${scopeClause} AND app IS NOT NULL GROUP BY app ORDER BY count DESC LIMIT 10`,
        scopeParams
      );
      return { by_type: r.rows, top_apps: apps.rows };
    }
    case 'top_threats': {
      const r = await pool.query(
        `SELECT message AS key, count(*)::int AS count, max(level) AS level
         FROM logs WHERE ${scopeClause} AND log_type='threat'
         GROUP BY message ORDER BY count DESC LIMIT 20`,
        scopeParams
      );
      return { threats: r.rows };
    }
    case 'top_sources': {
      const r = await pool.query(
        `SELECT src_ip AS key, count(*)::int AS count,
                coalesce(sum(bytes_sent+bytes_recv),0)::bigint AS bytes
         FROM logs WHERE ${scopeClause} AND src_ip IS NOT NULL
         GROUP BY src_ip ORDER BY count DESC LIMIT 20`,
        scopeParams
      );
      return { sources: r.rows };
    }
    case 'event_summary': {
      const evParams = [];
      let evClause = `ts > now() - interval '${hours} hours'`;
      if (adomId != null) { evParams.push(adomId); evClause += ` AND adom_id = $1`; }
      const r = await pool.query(
        `SELECT category, status, count(*)::int AS count
         FROM events WHERE ${evClause} GROUP BY category, status ORDER BY count DESC`,
        evParams
      );
      return { events: r.rows };
    }

    // ---------- Admin-only summarized report ----------
    // Combined Executive + Security Posture summary, aggregated across all
    // customers (adomId is null for this global type, so scopeClause has no
    // customer filter).
    case 'exec_security_summary': {
      // Executive KPIs
      const kpi = await pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE log_type='traffic')::int AS traffic,
                count(*) FILTER (WHERE log_type='threat')::int AS threats,
                count(*) FILTER (WHERE log_type='event')::int AS events,
                count(*) FILTER (WHERE log_type='system')::int AS system,
                count(*) FILTER (WHERE sev_level<=2)::int AS critical,
                coalesce(sum(bytes_sent+bytes_recv),0)::bigint AS bytes,
                count(DISTINCT device_id)::int AS devices
         FROM logs WHERE ${scopeClause}`,
        scopeParams
      );
      const apps = await pool.query(
        `SELECT app AS key, count(*)::int AS count FROM logs
         WHERE ${scopeClause} AND app IS NOT NULL GROUP BY app ORDER BY count DESC LIMIT 10`,
        scopeParams
      );
      const sev = await pool.query(
        `SELECT level, sev_level, count(*)::int AS count FROM logs
         WHERE ${scopeClause} GROUP BY level, sev_level ORDER BY sev_level`,
        scopeParams
      );
      // Security posture
      const bySev = await pool.query(
        `SELECT level, sev_level, count(*)::int AS count FROM logs
         WHERE ${scopeClause} AND log_type='threat' GROUP BY level, sev_level ORDER BY sev_level`,
        scopeParams
      );
      const threats = await pool.query(
        `SELECT message AS key, count(*)::int AS count FROM logs
         WHERE ${scopeClause} AND log_type='threat' GROUP BY message ORDER BY count DESC LIMIT 10`,
        scopeParams
      );
      const targets = await pool.query(
        `SELECT dst_ip AS key, count(*)::int AS count FROM logs
         WHERE ${scopeClause} AND log_type='threat' AND dst_ip IS NOT NULL
         GROUP BY dst_ip ORDER BY count DESC LIMIT 10`,
        scopeParams
      );
      // Events are global here (adomId is null), so no customer filter.
      const evClause = `ts > now() - interval '${hours} hours'`;
      const open = await pool.query(
        `SELECT count(*) FILTER (WHERE status='open')::int AS open,
                count(*)::int AS total FROM events WHERE ${evClause}`
      );
      const events = await pool.query(
        `SELECT status, count(*)::int AS count FROM events WHERE ${evClause} GROUP BY status`
      );
      return {
        summary: kpi.rows[0],
        open_events: open.rows[0],
        top_apps: apps.rows,
        severity: sev.rows,
        threats_by_severity: bySev.rows,
        top_threats: threats.rows,
        top_targets: targets.rows,
        events: events.rows,
      };
    }

    default:
      throw Object.assign(new Error('Unknown report type'), { status: 400 });
  }
}

// Report types restricted to global admins.
const ADMIN_ONLY_TYPES = new Set(['exec_security_summary']);
// Report types that aggregate across ALL customers (stored with NULL adom_id).
const GLOBAL_TYPES = new Set(['exec_security_summary']);

// POST /api/reports/generate { type, hours, name } (admin/analyst)
router.post('/generate', authenticate, resolveAdomScope, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const { type, name } = req.body || {};
    const hours = Math.min(Math.max(parseInt(req.body.hours || '24', 10) || 24, 1), 8760);

    if (ADMIN_ONLY_TYPES.has(type) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'This report type is available to admins only' });
    }

    let adomId;
    if (GLOBAL_TYPES.has(type)) {
      adomId = null; // spans all customers; stored as a global admin report
    } else {
      adomId = req.adomScope;
      if (adomId == null) {
        adomId = req.body.adom_id;
        if (!adomId) return res.status(400).json({ error: 'Select a customer for this report' });
      }
    }

    const data = await buildReport(type, adomId, hours);
    const r = await pool.query(
      `INSERT INTO reports (adom_id, name, type, params, data, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [adomId, name || `${type} (${hours}h)`, type, JSON.stringify({ hours }), JSON.stringify(data), req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Build the report-visibility WHERE fragment.
// Admins always see global (NULL adom) reports plus the scoped customer's;
// non-admins see only their own customer's reports.
function reportScopeClause(req, startIdx) {
  const scope = req.adomScope;
  if (scope == null) return { clause: '', params: [] }; // admin viewing all
  if (req.user.role === 'admin') {
    return { clause: `(adom_id = $${startIdx} OR adom_id IS NULL)`, params: [scope] };
  }
  return { clause: `adom_id = $${startIdx}`, params: [scope] };
}

// GET /api/reports -- list saved reports
router.get('/', authenticate, resolveAdomScope, async (req, res, next) => {
  try {
    const { clause, params } = reportScopeClause(req, 1);
    const where = clause ? `WHERE ${clause}` : '';
    const r = await pool.query(
      `SELECT id, adom_id, name, type, params, generated_at FROM reports ${where} ORDER BY generated_at DESC LIMIT 100`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:id -- full report with data
router.get('/:id', authenticate, resolveAdomScope, async (req, res, next) => {
  try {
    const params = [parseInt(req.params.id, 10)];
    const { clause, params: sp } = reportScopeClause(req, 2);
    let where = 'WHERE id = $1';
    if (clause) { where += ` AND ${clause}`; params.push(...sp); }
    const r = await pool.query(`SELECT * FROM reports ${where}`, params);
    if (!r.rows[0]) return res.status(404).json({ error: 'Report not found' });
    res.json(r.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
