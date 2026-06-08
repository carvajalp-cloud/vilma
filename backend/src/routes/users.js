import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// All user management is admin-only.
router.use(authenticate, requireRole('admin'));

router.get('/', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.username, u.email, u.role, u.adom_id, u.active, u.created_at, a.name AS adom_name
       FROM users u LEFT JOIN adoms a ON a.id = u.adom_id ORDER BY u.username`
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { username, password, email, role, adom_id } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    if (role && !['admin', 'analyst', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'invalid role' });
    }
    const effRole = role || 'viewer';
    if (effRole !== 'admin' && !adom_id) {
      return res.status(400).json({ error: 'non-admin users must be assigned an adom_id' });
    }
    const hash = bcrypt.hashSync(password, 10);
    const r = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, adom_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, username, email, role, adom_id, active, created_at`,
      [username, email || '', hash, effRole, effRole === 'admin' ? null : adom_id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'username already exists' });
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { email, role, adom_id, active, password } = req.body || {};
    const passHash = password ? bcrypt.hashSync(password, 10) : null;
    const r = await pool.query(
      `UPDATE users SET
         email = COALESCE($1,email),
         role = COALESCE($2,role),
         adom_id = $3,
         active = COALESCE($4,active),
         password_hash = COALESCE($5,password_hash)
       WHERE id = $6
       RETURNING id, username, email, role, adom_id, active, created_at`,
      [email ?? null, role ?? null, adom_id ?? null, active ?? null, passHash, id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) return res.status(400).json({ error: 'cannot delete yourself' });
    const r = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ deleted: r.rows[0].id });
  } catch (err) {
    next(err);
  }
});

export default router;
