import express from 'express';
import pool from '../db/pool.js';
import { authenticate, resolveAdomScope } from '../middleware/auth.js';
import { getSyslogStats } from '../services/syslog.js';

const router = express.Router();
router.use(authenticate, resolveAdomScope);

// Helper for logs/events: owned by scope OR the row's device is shared with scope.
function scoped(scope, baseWhere = '') {
  const params = [];
  let where = baseWhere;
  if (scope != null) {
    params.push(scope);
    const i = params.length;
    const pred = `(adom_id = $${i} OR device_id IN (SELECT device_id FROM device_viewers WHERE adom_id = $${i}))`;
    where += (where ? ' AND ' : ' WHERE ') + pred;
  }
  return { where, params };
}

// Helper for the devices table: owned by scope OR shared to scope.
function scopedDevice(scope, baseWhere = '') {
  const params = [];
  let where = baseWhere;
  if (scope != null) {
    params.push(scope);
    const i = params.length;
    const pred = `(adom_id = $${i} OR EXISTS (SELECT 1 FROM device_viewers dv WHERE dv.device_id = devices.id AND dv.adom_id = $${i}))`;
    where += (where ? ' AND ' : ' WHERE ') + pred;
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

    const devWhere = scopedDevice(scope, '');
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
    const allowed = { src_ip: 'src_ip', dst_ip: 'dst_ip', app: 'app', action: 'action', protocol: 'protocol', dst_port: 'dst_port', user_name: 'user_name' };
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

// GET /api/stats/insights -> computed analysis: block rate, peak hour, top threat,
// busiest device, and current-vs-previous-window trends.
router.get('/insights', async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const hours = Math.min(Math.max(parseInt(req.query.hours || '24', 10) || 24, 1), 720);

    const t = scoped(scope, `WHERE ts > now() - interval '${hours} hours' AND log_type='traffic'`);
    const traffic = await pool.query(
      `SELECT count(*) FILTER (WHERE action='accept')::int AS accept,
              count(*) FILTER (WHERE action='deny')::int AS deny
       FROM logs ${t.where}`, t.params);

    const p = scoped(scope, `WHERE ts > now() - interval '${hours} hours'`);
    const peak = await pool.query(
      `SELECT to_char(date_bin(interval '1 hour', ts, timestamptz 'epoch'),'MM-DD HH24:MI') AS label,
              count(*)::int AS count
       FROM logs ${p.where} GROUP BY 1 ORDER BY count DESC LIMIT 1`, p.params);

    const th = scoped(scope, `WHERE ts > now() - interval '${hours} hours' AND log_type='threat'`);
    const topThreat = await pool.query(
      `SELECT message AS key, count(*)::int AS count FROM logs ${th.where}
       GROUP BY message ORDER BY count DESC LIMIT 1`, th.params);

    const tb = scoped(scope, `WHERE ts > now() - interval '${hours} hours' AND action='deny' AND src_ip IS NOT NULL`);
    const topBlocked = await pool.query(
      `SELECT src_ip AS key, count(*)::int AS count FROM logs ${tb.where}
       GROUP BY src_ip ORDER BY count DESC LIMIT 1`, tb.params);

    // Busiest device (visibility predicate inlined because of the join alias).
    let devWhere = `l.ts > now() - interval '${hours} hours'`;
    const devParams = [];
    if (scope != null) {
      devParams.push(scope);
      devWhere += ` AND (l.adom_id = $1 OR l.device_id IN (SELECT device_id FROM device_viewers WHERE adom_id = $1))`;
    }
    const busiest = await pool.query(
      `SELECT d.name, count(*)::int AS count FROM logs l JOIN devices d ON d.id = l.device_id
       WHERE ${devWhere} GROUP BY d.name ORDER BY count DESC LIMIT 1`, devParams);

    // Trend: current window vs the immediately-preceding window of the same length.
    const tr = scoped(scope, `WHERE ts > now() - interval '${hours * 2} hours'`);
    const trend = await pool.query(
      `SELECT
         count(*) FILTER (WHERE ts > now() - interval '${hours} hours')::int AS cur_logs,
         count(*) FILTER (WHERE ts <= now() - interval '${hours} hours')::int AS prev_logs,
         count(*) FILTER (WHERE log_type='threat' AND ts > now() - interval '${hours} hours')::int AS cur_threats,
         count(*) FILTER (WHERE log_type='threat' AND ts <= now() - interval '${hours} hours')::int AS prev_threats,
         count(*) FILTER (WHERE sev_level<=2 AND ts > now() - interval '${hours} hours')::int AS cur_crit,
         count(*) FILTER (WHERE sev_level<=2 AND ts <= now() - interval '${hours} hours')::int AS prev_crit
       FROM logs ${tr.where}`, tr.params);
    const tv = trend.rows[0];
    const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0));

    const accept = traffic.rows[0].accept, deny = traffic.rows[0].deny;
    res.json({
      window_hours: hours,
      traffic: { accept, deny, block_rate: (accept + deny) ? +(deny / (accept + deny)).toFixed(3) : 0 },
      peak: peak.rows[0] || null,
      top_threat: topThreat.rows[0] || null,
      top_blocked_src: topBlocked.rows[0] || null,
      busiest_device: busiest.rows[0] || null,
      trend: {
        logs: { current: tv.cur_logs, previous: tv.prev_logs, pct: pct(tv.cur_logs, tv.prev_logs) },
        threats: { current: tv.cur_threats, previous: tv.prev_threats, pct: pct(tv.cur_threats, tv.prev_threats) },
        critical: { current: tv.cur_crit, previous: tv.prev_crit, pct: pct(tv.cur_crit, tv.prev_crit) },
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/bandwidth -> per-device incoming (received) vs outgoing (sent) bytes.
router.get('/bandwidth', async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const hours = Math.min(Math.max(parseInt(req.query.hours || '24', 10) || 24, 1), 720);
    let where = `l.ts > now() - interval '${hours} hours'`;
    const params = [];
    if (scope != null) {
      params.push(scope);
      where += ` AND (l.adom_id = $1 OR l.device_id IN (SELECT device_id FROM device_viewers WHERE adom_id = $1))`;
    }
    const r = await pool.query(
      `SELECT d.id AS device_id, d.name,
              coalesce(sum(l.bytes_recv),0)::bigint AS recv,
              coalesce(sum(l.bytes_sent),0)::bigint AS sent
       FROM logs l JOIN devices d ON d.id = l.device_id
       WHERE ${where}
       GROUP BY d.id, d.name
       ORDER BY (coalesce(sum(l.bytes_sent),0) + coalesce(sum(l.bytes_recv),0)) DESC
       LIMIT 100`,
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
