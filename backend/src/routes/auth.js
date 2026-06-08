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

    // Load the customers this (non-admin) user may access.
    let adoms = [];
    if (user.role !== 'admin') {
      const ar = await pool.query('SELECT adom_id FROM user_adoms WHERE user_id = $1 ORDER BY adom_id', [user.id]);
      adoms = ar.rows.map((x) => x.adom_id);
      if (!adoms.length && user.adom_id != null) adoms = [user.adom_id];
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role, adom_id: user.adom_id, adoms },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, adom_id: user.adom_id, adoms },
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
    const me = r.rows[0];
    // The customers this user can access (for the customer switcher).
    if (me.role === 'admin') {
      me.customers = [];
    } else {
      const cr = await pool.query(
        `SELECT a.id, a.name FROM user_adoms ua JOIN adoms a ON a.id = ua.adom_id
         WHERE ua.user_id = $1 ORDER BY a.name`,
        [me.id]
      );
      me.customers = cr.rows;
      if (!me.customers.length && me.adom_id != null) {
        const one = await pool.query('SELECT id, name FROM adoms WHERE id = $1', [me.adom_id]);
        me.customers = one.rows;
      }
    }
    res.json(me);
  } catch (err) {
    next(err);
  }
});

export default router;
