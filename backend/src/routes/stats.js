import express from 'express';
import pool from '../db/pool.js';
import { authenticate, resolveAdomScope } from '../middleware/auth.js';
import { getSyslogStats } from '../services/syslog.js';

const router = express.Router();
router.use(authenticate, resolveAdomScope);

// Helper: append "WHERE adom_id = $1" when scoped.
function scoped(scope, baseWhere = '') {
  const params = [];
  let where = baseWhere;
  if (scope != null) {
    params.push(scope);
    where += (where ? ' AND ' : ' WHERE ') + `adom_id = $${params.length}`;
  } else if (baseWhere) {
    where = baseWhere;
  }
  return { where, params };
}

// GET /api/stats/summary  -> KPI cards
router.get('/summary', async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const hoursParam = parseInt(req.query.hours || '24', 10);
    const hours = Number.isNaN(hoursParam) ? 24 : Math.min(Math.max(hoursParam, 1), 720);

    const { where, params } = scoped(scope, `WHERE ts > now() - interval '${hours} hours'`);

    const totals = await pool.query(
      `SELECT
         count(*)::int AS total_logs,
         count(*) FILTER (WHERE log_type='threat')::int AS threats,
         count(*) FILTER (WHERE log_type='traffic')::int AS traffic,
         count(*) FILTER (WHERE sev_level <= 2)::int AS critical,
         coalesce(sum(bytes_sent+bytes_recv),0)::bigint AS bytes
       FROM logs ${where}`,
      params
    );

    const evWhere = scoped(scope, `WHERE status='open'`);
    const openEvents = await pool.query(
      `SELECT count(*)::int AS open_events FROM events ${evWhere.where}`,
      evWhere.params
    );

    const devWhere = scoped(scope, '');
    const devices = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status='online')::int AS online
       FROM devices ${devWhere.where}`,
      devWhere.params
    );

    res.json({
      window_hours: hours,
      ...totals.rows[0],
      open_events: openEvents.rows[0].open_events,
      devices_total: devices.rows[0].total,
      devices_online: devices.rows[0].online,
      syslog: getSyslogStats(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/timeline -> logs bucketed over time by log_type
router.get('/timeline', async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const hours = Math.min(Math.max(parseInt(req.query.hours || '24', 10) || 24, 1), 720);
    const bucket = hours <= 24 ? '1 hour' : (hours <= 168 ? '6 hours' : '1 day');
    const { where, params } = scoped(scope, `WHERE ts > now() - interval '${hours} hours'`);
    const r = await pool.query(
      `SELECT date_bin(interval '${bucket}', ts, timestamptz 'epoch') AS bucket,
              to_char(date_bin(interval '${bucket}', ts, timestamptz 'epoch'),'MM-DD HH24:MI') AS label,
              count(*) FILTER (WHERE log_type='traffic')::int AS traffic,
              count(*) FILTER (WHERE log_type='threat')::int AS threat,
              count(*) FILTER (WHERE log_type='event')::int AS event,
              count(*) FILTER (WHERE log_type='system')::int AS system
       FROM logs ${where}
       GROUP BY 1 ORDER BY 1`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/top?dim=src_ip|dst_ip|app|action&limit=10
router.get('/top', async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const allowed = { src_ip: 'src_ip', dst_ip: 'dst_ip', app: 'app', action: 'action', protocol: 'protocol' };
    const dim = allowed[req.query.dim] || 'src_ip';
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10) || 10, 1), 50);
    const hours = Math.min(Math.max(parseInt(req.query.hours || '24', 10) || 24, 1), 720);
    const { where, params } = scoped(scope, `WHERE ts > now() - interval '${hours} hours' AND ${dim} IS NOT NULL`);
    const r = await pool.query(
      `SELECT ${dim} AS key, count(*)::int AS count,
              coalesce(sum(bytes_sent+bytes_recv),0)::bigint AS bytes
       FROM logs ${where}
       GROUP BY ${dim} ORDER BY count DESC LIMIT ${limit}`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/severity -> distribution by severity level
router.get('/severity', async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const hours = Math.min(Math.max(parseInt(req.query.hours || '24', 10) || 24, 1), 720);
    const { where, params } = scoped(scope, `WHERE ts > now() - interval '${hours} hours'`);
    const r = await pool.query(
      `SELECT sev_level, level, count(*)::int AS count
       FROM logs ${where}
       GROUP BY sev_level, level ORDER BY sev_level`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

export default router;
