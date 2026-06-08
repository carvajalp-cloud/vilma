import pool from '../db/pool.js';
import { evaluateAlerts } from './alerting.js';

// Cache: "adomId:devid" -> deviceId, to avoid a lookup on every log.
const deviceCache = new Map();

// Resolve (or auto-register) a device for an incoming log.
// `defaultAdomId` is used when the device can't be matched to an existing one.
async function resolveDevice(client, parsed, sourceIp, defaultAdomId) {
  const devid = parsed._devid;

  // 1. Try to match an existing device by devid across any ADOM.
  if (devid) {
    const cacheKey = `dev:${devid}`;
    if (deviceCache.has(cacheKey)) return deviceCache.get(cacheKey);
    const r = await client.query(
      'SELECT id, adom_id FROM devices WHERE devid = $1 LIMIT 1',
      [devid]
    );
    if (r.rows[0]) {
      const found = { id: r.rows[0].id, adom_id: r.rows[0].adom_id };
      deviceCache.set(cacheKey, found);
      return found;
    }
  }

  // 2. Try to match by source IP.
  if (sourceIp) {
    const r = await client.query(
      'SELECT id, adom_id FROM devices WHERE ip = $1 LIMIT 1',
      [sourceIp]
    );
    if (r.rows[0]) return { id: r.rows[0].id, adom_id: r.rows[0].adom_id };
  }

  // 3. Auto-register a new device under the default ADOM.
  const name = parsed._devname || devid || sourceIp || 'unknown-device';
  const r = await client.query(
    `INSERT INTO devices (adom_id, name, ip, devid, status, last_seen)
     VALUES ($1,$2,$3,$4,'online',now())
     ON CONFLICT (adom_id, devid) DO UPDATE SET last_seen = now(), status='online'
     RETURNING id, adom_id`,
    [defaultAdomId, name, sourceIp, devid]
  );
  const created = { id: r.rows[0].id, adom_id: r.rows[0].adom_id };
  if (devid) deviceCache.set(`dev:${devid}`, created);
  return created;
}

let _defaultAdomId = null;
async function getDefaultAdomId(client) {
  if (_defaultAdomId) return _defaultAdomId;
  const r = await client.query("SELECT id FROM adoms ORDER BY id ASC LIMIT 1");
  _defaultAdomId = r.rows[0] ? r.rows[0].id : null;
  return _defaultAdomId;
}

// Persist one parsed log + run alert evaluation. Returns the inserted log row.
export async function ingestParsedLog(parsed, sourceIp) {
  const client = await pool.connect();
  try {
    const defaultAdomId = await getDefaultAdomId(client);
    if (!defaultAdomId) {
      throw new Error('No ADOM exists. Run the seed/migrate first.');
    }
    const device = await resolveDevice(client, parsed, sourceIp, defaultAdomId);

    const ins = await client.query(
      `INSERT INTO logs (adom_id, device_id, ts, log_type, subtype, level, sev_level,
         src_ip, dst_ip, src_port, dst_port, protocol, action, app, user_name,
         bytes_sent, bytes_recv, message, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        device.adom_id, device.id, parsed.ts, parsed.log_type, parsed.subtype,
        parsed.level, parsed.sev_level, parsed.src_ip, parsed.dst_ip,
        parsed.src_port, parsed.dst_port, parsed.protocol, parsed.action,
        parsed.app, parsed.user_name, parsed.bytes_sent, parsed.bytes_recv,
        parsed.message, parsed.raw,
      ]
    );
    const log = ins.rows[0];

    // Keep device freshness up to date.
    await client.query(
      'UPDATE devices SET last_seen = now(), status = $2 WHERE id = $1',
      [device.id, 'online']
    );

    await evaluateAlerts(client, log);
    return log;
  } finally {
    client.release();
  }
}

export function clearDeviceCache() {
  deviceCache.clear();
  _defaultAdomId = null;
}
