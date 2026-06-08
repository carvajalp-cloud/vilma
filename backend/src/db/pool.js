import pg from 'pg';
import config from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  max: 20,
  idleTimeoutMillis: 30000,
  // Fail a query fast if the pool is momentarily saturated, rather than hanging the
  // API forever (which is what made the whole site appear down under syslog load).
  connectionTimeoutMillis: 8000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error', err);
});

export const query = (text, params) => pool.query(text, params);

export default pool;
