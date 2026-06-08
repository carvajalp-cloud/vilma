import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// All user management is admin-only.
router.use(authenticate, requireRole('admin'));

function normalizeAdomIds(body) {
  if (Array.isArray(body.adom_ids)) {
    return [...new Set(body.adom_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  }
  if (body.adom_id) {
    const n = Number(body.adom_id);
    return Number.isInteger(n) && n > 0 ? [n] : [];
  }
  return [];
}

// Replace a user's customer memberships, keeping the legacy primary adom_id in sync.
async function setUserAdoms(client, userId, adomIds) {
  await client.query('DELETE FROM user_adoms WHERE user_id = $1', [userId]);
  for (const adomId of adomIds) {
    await client.query(
      'INSERT INTO user_adoms (user_id, adom_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, adomId]
    );
  }
  await client.query('UPDATE users SET adom_id = $2 WHERE id = $1', [userId, adomIds[0] || null]);
}

router.get('/', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.username, u.email, u.role, u.adom_id, u.active, u.created_at,
              COALESCE(
                json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.name)
                  FILTER (WHERE a.id IS NOT NULL), '[]'
              ) AS customers
       FROM users u
       LEFT JOIN user_adoms ua ON ua.user_id = u.id
       LEFT JOIN adoms a ON a.id = ua.adom_id
       GROUP BY u.id
       ORDER BY u.username`
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { username, password, email, role } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    if (role && !['admin', 'analyst', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'invalid role' });
    }
    const effRole = role || 'viewer';
    const adomIds = effRole === 'admin' ? [] : normalizeAdomIds(req.body);
    if (effRole !== 'admin' && adomIds.length === 0) {
      return res.status(400).json({ error: 'non-admin users must be assigned at least one customer' });
    }

    const hash = bcrypt.hashSync(password, 10);
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO users (username, email, password_hash, role, adom_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, username, email, role, adom_id, active, created_at`,
      [username, email || '', hash, effRole, adomIds[0] || null]
    );
    const user = r.rows[0];
    if (effRole !== 'admin') await setUserAdoms(client, user.id, adomIds);
    await client.query('COMMIT');
    res.status(201).json({ ...user, customers: [] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'username already exists' });
    next(err);
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const { email, role, active, password } = req.body || {};
    if (role && !['admin', 'analyst', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'invalid role' });
    }

    const cur = await client.query('SELECT role FROM users WHERE id = $1', [id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'User not found' });
    const currentRole = cur.rows[0].role;
    const effRole = role || currentRole;

    // Password policy: admins' passwords cannot be changed here (only non-admin users).
    let passHash = null;
    if (password) {
      if (currentRole === 'admin' || effRole === 'admin') {
        return res.status(403).json({ error: "An admin user's password can't be changed here" });
      }
      passHash = bcrypt.hashSync(password, 10);
    }

    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE users SET
         email = COALESCE($1,email),
         role = COALESCE($2,role),
         active = COALESCE($3,active),
         password_hash = COALESCE($4,password_hash)
       WHERE id = $5
       RETURNING id, username, email, role, adom_id, active, created_at`,
      [email ?? null, role ?? null, active ?? null, passHash, id]
    );
    const user = upd.rows[0];

    // Customer memberships
    if (effRole === 'admin') {
      // Admins are global — drop any customer assignments.
      await client.query('DELETE FROM user_adoms WHERE user_id = $1', [id]);
      await client.query('UPDATE users SET adom_id = NULL WHERE id = $1', [id]);
      user.adom_id = null;
    } else if (Array.isArray(req.body.adom_ids) || req.body.adom_id != null) {
      const adomIds = normalizeAdomIds(req.body);
      if (adomIds.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'non-admin users must have at least one customer' });
      }
      await setUserAdoms(client, id, adomIds);
      user.adom_id = adomIds[0];
    }
    await client.query('COMMIT');

    const cr = await pool.query(
      `SELECT a.id, a.name FROM user_adoms ua JOIN adoms a ON a.id = ua.adom_id
       WHERE ua.user_id = $1 ORDER BY a.name`,
      [id]
    );
    res.json({ ...user, customers: cr.rows });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
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
