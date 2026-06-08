// Idempotent, NON-destructive first-run setup for production.
// Ensures at least one customer (ADOM) and one admin user exist so you can log in.
// Safe to run on every deploy — it never wipes data (unlike seed.js).
import bcrypt from 'bcryptjs';
import pool from './pool.js';

async function bootstrap() {
  const client = await pool.connect();
  try {
    // 1) Ensure a default customer exists (devices auto-register under the first ADOM).
    let adom = await client.query('SELECT id FROM adoms ORDER BY id LIMIT 1');
    if (!adom.rows[0]) {
      await client.query(
        "INSERT INTO adoms (name, description) VALUES ('default', 'Default customer')"
      );
      console.log('[bootstrap] created default customer (ADOM)');
    }

    // 2) Ensure an admin user exists.
    const { rows } = await client.query('SELECT count(*)::int AS n FROM users');
    if (rows[0].n === 0) {
      const username = process.env.ADMIN_USERNAME || 'admin';
      const generated = !process.env.ADMIN_PASSWORD;
      const password = process.env.ADMIN_PASSWORD || (Math.random().toString(36).slice(2, 12) + 'A1!');
      const hash = bcrypt.hashSync(password, 10);
      await client.query(
        "INSERT INTO users (username, email, password_hash, role, adom_id) VALUES ($1, '', $2, 'admin', NULL)",
        [username, hash]
      );
      console.log(`[bootstrap] created admin user '${username}'`);
      if (generated) console.log(`[bootstrap] GENERATED ADMIN PASSWORD: ${password}  (change it after first login)`);
    } else {
      console.log('[bootstrap] users already exist — leaving them untouched');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

bootstrap().catch((err) => {
  console.error('[bootstrap] failed:', err.message);
  process.exit(1);
});
