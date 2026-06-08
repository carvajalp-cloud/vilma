import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('[migrate] applying schema...');
  await pool.query(schema);
  console.log('[migrate] done.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
