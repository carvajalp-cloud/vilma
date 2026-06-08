import express from 'express';
import pool from '../db/pool.js';
import { authenticate, resolveAdomScope } from '../middleware/auth.js';
import { parseFortiLog } from '../services/fortiParser.js';
import { ingestParsedLog } from '../services/ingest.js';

const router = express.Router();

// GET /api/logs  -- searchable, filterable, paginated log viewer
router.get('/', authenticate, resolveAdomScope, async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const params = [];
    const conds = [];

    if (scope != null) { params.push(scope); conds.push(`l.adom_id = $${params.length}`); }

    const { log_type, level, action, src_ip, dst_ip, device_id, q, hours } = req.query;
    if (log_type) { params.push(log_type); conds.push(`l.log_type = $${params.length}`); }
    if (level) { params.push(level); conds.push(`l.level = $${params.length}`); }
    if (action) { params.push(action); conds.push(`l.action = $${params.length}`); }
    if (src_ip) { params.push(src_ip); conds.push(`l.src_ip = $${params.length}`); }
    if (dst_ip) { params.push(dst_ip); conds.push(`l.dst_ip = $${params.length}`); }
    if (device_id) { params.push(parseInt(device_id, 10)); conds.push(`l.device_id = $${params.length}`); }
    if (hours) {
      const h = Math.min(Math.max(parseInt(hours, 10) || 24, 1), 8760);
      conds.push(`l.ts > now() - interval '${h} hours'`);
    }
    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      conds.push(`(l.message ILIKE $${i} OR l.src_ip ILIKE $${i} OR l.dst_ip ILIKE $${i} OR l.app ILIKE $${i} OR l.raw ILIKE $${i})`);
    }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);

    const countRes = await pool.query(`SELECT count(*)::int AS total FROM logs l ${where}`, params);

    params.push(limit); params.push(offset);
    const rows = await pool.query(
      `SELECT l.*, d.name AS device_name
       FROM logs l LEFT JOIN devices d ON d.id = l.device_id
       ${where}
       ORDER BY l.ts DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ total: countRes.rows[0].total, limit, offset, rows: rows.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/logs/:id
router.get('/:id', authenticate, resolveAdomScope, async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const params = [parseInt(req.params.id, 10)];
    let where = 'WHERE l.id = $1';
    if (scope != null) { params.push(scope); where += ` AND l.adom_id = $2`; }
    const r = await pool.query(
      `SELECT l.*, d.name AS device_name FROM logs l
       LEFT JOIN devices d ON d.id = l.device_id ${where}`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Log not found' });
    res.json(r.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/logs/ingest  -- HTTP ingestion endpoint (alternative to UDP syslog).
// Accepts { raw: "<134>date=... type=traffic ..." } or a JSON log body.
router.post('/ingest', authenticate, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.raw && !body.message && !body.type) {
      return res.status(400).json({ error: 'Provide a raw syslog string or structured fields' });
    }
    const raw = body.raw
      || Object.entries(body).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    const parsed = parseFortiLog(raw);
    const sourceIp = (req.ip || '').replace('::ffff:', '');
    const log = await ingestParsedLog(parsed, sourceIp);
    res.status(201).json(log);
  } catch (err) {
    next(err);
  }
});

export default router;
