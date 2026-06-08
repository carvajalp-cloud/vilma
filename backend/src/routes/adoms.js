import express from 'express';
import pool from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/adoms -- admins see all; others see only their assigned ADOM.
router.get('/', authenticate, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      const r = await pool.query(
        `SELECT a.*, (SELECT count(*)::int FROM devices d WHERE d.adom_id = a.id) AS device_count
         FROM adoms a ORDER BY a.name`
      );
      return res.json(r.rows);
    }
    if (req.user.adom_id == null) return res.json([]);
    const r = await pool.query('SELECT * FROM adoms WHERE id = $1', [req.user.adom_id]);
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const r = await pool.query(
      'INSERT INTO adoms (name, description) VALUES ($1,$2) RETURNING *',
      [name, description || '']
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'ADOM name already exists' });
    next(err);
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const r = await pool.query('DELETE FROM adoms WHERE id = $1 RETURNING id', [parseInt(req.params.id, 10)]);
    if (!r.rows[0]) return res.status(404).json({ error: 'ADOM not found' });
    res.json({ deleted: r.rows[0].id });
  } catch (err) {
    next(err);
  }
});

export default router;
