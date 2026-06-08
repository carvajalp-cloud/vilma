import express from 'express';
import pool from '../db/pool.js';
import { authenticate, resolveAdomScope, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/devices
router.get('/', authenticate, resolveAdomScope, async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const params = [];
    let where = '';
    if (scope != null) { params.push(scope); where = 'WHERE d.adom_id = $1'; }
    const r = await pool.query(
      `SELECT d.*, a.name AS adom_name,
              (SELECT count(*)::int FROM logs l WHERE l.device_id = d.id AND l.ts > now() - interval '24 hours') AS logs_24h
       FROM devices d JOIN adoms a ON a.id = d.adom_id
       ${where}
       ORDER BY d.name`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/devices  (admin/analyst)
router.post('/', authenticate, resolveAdomScope, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const { name, ip, devid, vendor, model, type } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    // Non-admins create within their own ADOM; admins within the selected scope (or must pass adom).
    let adomId = req.adomScope;
    if (adomId == null) {
      adomId = req.body.adom_id;
      if (!adomId) return res.status(400).json({ error: 'admin must specify adom_id (or ?adom=)' });
    }
    const r = await pool.query(
      `INSERT INTO devices (adom_id, name, ip, devid, vendor, model, type, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'unknown') RETURNING *`,
      [adomId, name, ip || null, devid || null, vendor || 'Fortinet', model || '', type || 'firewall']
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Device with this devid already exists in the ADOM' });
    next(err);
  }
});

// PUT /api/devices/:id  (admin/analyst)
router.put('/:id', authenticate, resolveAdomScope, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, ip, devid, vendor, model, type, status } = req.body || {};
    const params = [name, ip, devid, vendor, model, type, status, id];
    let guard = '';
    if (req.adomScope != null) { params.push(req.adomScope); guard = ` AND adom_id = $${params.length}`; }
    const r = await pool.query(
      `UPDATE devices SET
         name = COALESCE($1,name), ip = COALESCE($2,ip), devid = COALESCE($3,devid),
         vendor = COALESCE($4,vendor), model = COALESCE($5,model), type = COALESCE($6,type),
         status = COALESCE($7,status)
       WHERE id = $8 ${guard} RETURNING *`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Device not found' });
    res.json(r.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/devices/:id  (admin)
router.delete('/:id', authenticate, resolveAdomScope, requireRole('admin'), async (req, res, next) => {
  try {
    const r = await pool.query('DELETE FROM devices WHERE id = $1 RETURNING id', [parseInt(req.params.id, 10)]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Device not found' });
    res.json({ deleted: r.rows[0].id });
  } catch (err) {
    next(err);
  }
});

export default router;
