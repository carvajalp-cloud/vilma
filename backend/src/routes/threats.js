import express from 'express';
import pool from '../db/pool.js';
import { authenticate, resolveAdomScope, deviceVisibility } from '../middleware/auth.js';
import { geoFor } from '../services/geo.js';

const router = express.Router();
router.use(authenticate, resolveAdomScope);

// GET /api/threats — filterable list of threat logs, each enriched with src/dst geo.
// Filters: threat (name), category (subtype), level (severity), q (free-text "info"), hours, limit.
router.get('/', async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const params = [];
    const conds = [`l.log_type = 'threat'`];
    if (scope != null) { params.push(scope); conds.push(deviceVisibility(scope, 'l', params.length).clause); }

    const { category, level, threat, q, hours } = req.query;
    if (category) { params.push(category); conds.push(`l.subtype = $${params.length}`); }
    if (level) { params.push(level); conds.push(`l.level = $${params.length}`); }
    if (threat) { params.push(`%${threat}%`); conds.push(`l.message ILIKE $${params.length}`); }
    if (q) {
      params.push(`%${q}%`); const i = params.length;
      conds.push(`(l.message ILIKE $${i} OR l.raw ILIKE $${i} OR l.src_ip ILIKE $${i} OR l.dst_ip ILIKE $${i} OR l.app ILIKE $${i})`);
    }
    if (hours) {
      const h = Math.min(Math.max(parseInt(hours, 10) || 24, 1), 8760);
      conds.push(`l.ts > now() - interval '${h} hours'`);
    }
    const where = 'WHERE ' + conds.join(' AND ');
    const limit = Math.min(Math.max(parseInt(req.query.limit || '200', 10) || 200, 1), 500);

    const r = await pool.query(
      `SELECT l.id, l.ts, l.message, l.subtype, l.level, l.sev_level, l.action, l.app,
              l.src_ip, l.dst_ip, l.src_port, l.dst_port, d.name AS device_name
       FROM logs l LEFT JOIN devices d ON d.id = l.device_id
       ${where}
       ORDER BY l.ts DESC
       LIMIT ${limit}`,
      params
    );
    const rows = r.rows.map((t) => ({ ...t, src: geoFor(t.src_ip), dst: geoFor(t.dst_ip) }));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/threats/facets — distinct categories + severity levels for the filter dropdowns.
router.get('/facets', async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const params = [];
    let vis = '';
    if (scope != null) { params.push(scope); vis = ' AND ' + deviceVisibility(scope, '', params.length).clause; }
    const cats = await pool.query(
      `SELECT DISTINCT subtype FROM logs WHERE log_type='threat' AND subtype <> ''${vis} ORDER BY subtype LIMIT 50`,
      params
    );
    const levels = await pool.query(
      `SELECT level, min(sev_level) AS sev FROM logs WHERE log_type='threat'${vis} GROUP BY level ORDER BY sev LIMIT 20`,
      params
    );
    res.json({ categories: cats.rows.map((r) => r.subtype), levels: levels.rows.map((r) => r.level) });
  } catch (err) {
    next(err);
  }
});

export default router;
