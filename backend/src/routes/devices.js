import express from 'express';
import pool from '../db/pool.js';
import { authenticate, resolveAdomScope, requireRole } from '../middleware/auth.js';
import { clearDeviceCache } from '../services/ingest.js';
import { usageBytesSql, enforceQuotas } from '../services/quota.js';

const router = express.Router();

// Parse an incoming quota into a non-negative BIGINT, or null (unlimited).
function parseQuota(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined; // undefined = invalid
  return Math.round(n);
}

// Normalize an incoming ips value into a clean, de-duplicated string array.
function cleanIps(ips, fallbackIp) {
  let list = Array.isArray(ips) ? ips : [];
  if (!list.length && fallbackIp) list = [fallbackIp];
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}

// Replace a device's IP set. Manual edits are authoritative: an IP is reassigned
// to this device if it was on another (ON CONFLICT DO UPDATE). Returns skipped=none.
async function setDeviceIps(client, deviceId, ips) {
  await client.query('DELETE FROM device_ips WHERE device_id = $1', [deviceId]);
  for (const ip of ips) {
    await client.query(
      `INSERT INTO device_ips (device_id, ip, auto) VALUES ($1, $2, false)
       ON CONFLICT (ip) DO UPDATE SET device_id = EXCLUDED.device_id, auto = false`,
      [deviceId, ip]
    );
  }
}

// GET /api/devices  — includes the full IP list per device.
router.get('/', authenticate, resolveAdomScope, async (req, res, next) => {
  try {
    const scope = req.adomScope;
    const params = [];
    let where = '';
    if (scope != null) { params.push(scope); where = 'WHERE d.adom_id = $1'; }
    const r = await pool.query(
      `SELECT d.*, a.name AS adom_name,
              COALESCE(array_agg(di.ip ORDER BY di.ip) FILTER (WHERE di.ip IS NOT NULL), '{}') AS ips,
              ${usageBytesSql('l')} AS usage_bytes,
              (SELECT count(*)::int FROM logs l WHERE l.device_id = d.id AND l.ts > now() - interval '24 hours') AS logs_24h
       FROM devices d
       JOIN adoms a ON a.id = d.adom_id
       LEFT JOIN device_ips di ON di.device_id = d.id
       ${where}
       GROUP BY d.id, a.name
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
  const client = await pool.connect();
  try {
    const { name, ip, devid, vendor, model, type } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    let adomId = req.adomScope;
    if (adomId == null) {
      adomId = req.body.adom_id;
      if (!adomId) return res.status(400).json({ error: 'admin must specify adom_id (or ?adom=)' });
    }
    const ips = cleanIps(req.body.ips, ip);
    const quota = parseQuota(req.body.quota_bytes);
    if (quota === undefined) return res.status(400).json({ error: 'quota must be a non-negative number of bytes' });

    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO devices (adom_id, name, ip, devid, vendor, model, type, status, quota_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'unknown',$8) RETURNING *`,
      [adomId, name, ips[0] || null, devid || null, vendor || 'Fortinet', model || '', type || 'firewall', quota]
    );
    const device = r.rows[0];
    await setDeviceIps(client, device.id, ips);
    await client.query('COMMIT');
    clearDeviceCache(); // so ingest picks up the new IP mappings immediately
    res.status(201).json({ ...device, ips });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'A device with this devid already exists in the customer' });
    next(err);
  } finally {
    client.release();
  }
});

// PUT /api/devices/:id  — edit device fields and/or its IP list (admin/analyst)
router.put('/:id', authenticate, resolveAdomScope, requireRole('admin', 'analyst'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const { name, devid, vendor, model, type, status } = req.body || {};

    await client.query('BEGIN');
    // Scope guard: non-admins can only touch devices in their own customer.
    const params = [name, devid, vendor, model, type, status, id];
    let guard = '';
    if (req.adomScope != null) { params.push(req.adomScope); guard = ` AND adom_id = $${params.length}`; }
    const upd = await client.query(
      `UPDATE devices SET
         name = COALESCE($1,name), devid = COALESCE($2,devid), vendor = COALESCE($3,vendor),
         model = COALESCE($4,model), type = COALESCE($5,type), status = COALESCE($6,status)
       WHERE id = $7 ${guard} RETURNING *`,
      params
    );
    if (!upd.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Device not found' }); }
    const device = upd.rows[0];

    // Only replace IPs if the caller sent an `ips` array.
    let ips;
    if (Array.isArray(req.body.ips)) {
      ips = cleanIps(req.body.ips);
      await setDeviceIps(client, id, ips);
      // keep the legacy primary ip column in sync with the first IP
      await client.query('UPDATE devices SET ip = $2 WHERE id = $1', [id, ips[0] || null]);
    } else {
      const cur = await client.query('SELECT ip FROM device_ips WHERE device_id = $1 ORDER BY ip', [id]);
      ips = cur.rows.map((r) => r.ip);
    }

    // Set the storage quota explicitly when provided (null clears it = unlimited).
    let quotaChanged = false;
    if ('quota_bytes' in req.body) {
      const quota = parseQuota(req.body.quota_bytes);
      if (quota === undefined) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'quota must be a non-negative number of bytes' }); }
      await client.query('UPDATE devices SET quota_bytes = $2 WHERE id = $1', [id, quota]);
      device.quota_bytes = quota;
      quotaChanged = true;
    }

    await client.query('COMMIT');
    clearDeviceCache();
    // A newly-lowered quota should trim right away rather than waiting for the sweep.
    if (quotaChanged) enforceQuotas().catch(() => {});
    res.json({ ...device, ips });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'A device with this devid already exists in the customer' });
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/devices/:id  (admin) — cascades device_ips
router.delete('/:id', authenticate, resolveAdomScope, requireRole('admin'), async (req, res, next) => {
  try {
    const r = await pool.query('DELETE FROM devices WHERE id = $1 RETURNING id', [parseInt(req.params.id, 10)]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Device not found' });
    clearDeviceCache();
    res.json({ deleted: r.rows[0].id });
  } catch (err) {
    next(err);
  }
});

export default router;
