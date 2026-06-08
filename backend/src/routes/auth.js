import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';
import config from '../config.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const r = await pool.query(
      'SELECT id, username, password_hash, role, adom_id, active FROM users WHERE username = $1',
      [username]
    );
    const user = r.rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role, adom_id: user.adom_id },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, adom_id: user.adom_id },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.username, u.email, u.role, u.adom_id, a.name AS adom_name
       FROM users u LEFT JOIN adoms a ON a.id = u.adom_id WHERE u.id = $1`,
      [req.user.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
