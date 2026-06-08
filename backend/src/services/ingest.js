import pool from '../db/pool.js';
import { evaluateAlerts } from './alerting.js';

// Cache: "dev:<devid>" -> {id, adom_id}, to avoid a lookup on every log.
const deviceCache = new Map();
// Source IPs we've already associated with their device this process lifetime,
// so we don't issue an INSERT on every single log (only the first time an IP appears).
const knownIps = new Set();

// Record a source IP against a device. For auto-learned IPs we never steal an IP
// that already belongs to another device (ON CONFLICT DO NOTHING).
async function learnIp(client, deviceId, sourceIp) {
  if (!sourceIp || knownIps.has(sourceIp)) return;
  await client.query(
    `INSERT INTO device_ips (device_id, ip, auto) VALUES ($1, $2, true)
     ON CONFLICT (ip) DO NOTHING`,
    [deviceId, sourceIp]
  );
  knownIps.add(sourceIp);
}

// Resolve (or auto-register) a device for an incoming log.
// `defaultAdomId` is used when the device can't be matched to an existing one.
async function resolveDevice(client, parsed, sourceIp, defaultAdomId) {
  const devid = parsed._devid;

  // 1. Match by devid (serial) across any ADOM — this is the reliable key, and it
  //    handles SD-WAN: every log from a FortiGate carries the same devid regardless
  //    of which WAN link / source IP it egressed from.
  if (devid) {
    const cacheKey = `dev:${devid}`;
    let found = deviceCache.get(cacheKey);
    if (!found) {
      const r = await client.query('SELECT id, adom_id FROM devices WHERE devid = $1 LIMIT 1', [devid]);
      if (r.rows[0]) {
        found = { id: r.rows[0].id, adom_id: r.rows[0].adom_id };
        deviceCache.set(cacheKey, found);
      }
    }
    if (found) {
      await learnIp(client, found.id, sourceIp); // accumulate this device's source IPs
      return found;
    }
  }

  // 2. Match by source IP against the device's known IP set.
  if (sourceIp) {
    const r = await client.query(
      `SELECT d.id, d.adom_id FROM device_ips di JOIN devices d ON d.id = di.device_id
       WHERE di.ip = $1 LIMIT 1`,
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
  await learnIp(client, created.id, sourceIp);
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
  knownIps.clear();
  _defaultAdomId = null;
}
