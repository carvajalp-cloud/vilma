import pool from '../db/pool.js';

// Estimated stored size of a log row: the variable text (raw + message) plus a
// fixed overhead for the fixed-width columns and index entries. Good enough to
// drive a rolling quota without tracking exact on-disk bytes.
const ROW_OVERHEAD = 250;
export const ROW_SIZE_SQL =
  `(octet_length(coalesce(raw,'')) + octet_length(coalesce(message,'')) + ${ROW_OVERHEAD})`;

// SQL fragment to estimate a device's total log storage. `alias` is the logs alias.
export function usageBytesSql(alias = 'l') {
  return `(SELECT coalesce(sum(octet_length(coalesce(${alias}.raw,'')) + ` +
         `octet_length(coalesce(${alias}.message,'')) + ${ROW_OVERHEAD}),0)::bigint ` +
         `FROM logs ${alias} WHERE ${alias}.device_id = d.id)`;
}

const BATCH = 2000;

// For one device, delete the OLDEST logs so the newest fit within quota.
// 1) Find the keep-boundary: the oldest log among the newest set that fits the quota.
// 2) Delete everything older than that boundary, in small batches (short statements),
//    so we never hold a large lock that would deadlock with live ingestion.
async function enforceDevice(deviceId, quotaBytes) {
  const b = await pool.query(
    `SELECT ts, id FROM (
       SELECT ts, id, sum(${ROW_SIZE_SQL}) OVER (ORDER BY ts DESC, id DESC) AS running
       FROM logs WHERE device_id = $1
     ) s
     WHERE running <= $2
     ORDER BY ts ASC, id ASC
     LIMIT 1`,
    [deviceId, quotaBytes]
  );
  // No row fits (quota smaller than a single newest log) or no logs — never mass-delete.
  if (!b.rows[0]) return 0;
  const { ts: bts, id: bid } = b.rows[0];

  let totalDeleted = 0;
  let guard = 0;
  while (guard++ < 5000) {
    const r = await pool.query(
      `DELETE FROM logs WHERE id IN (
         SELECT id FROM logs
         WHERE device_id = $1 AND (ts < $2 OR (ts = $2 AND id < $3))
         ORDER BY ts ASC, id ASC
         LIMIT ${BATCH}
       )`,
      [deviceId, bts, bid]
    );
    if (r.rowCount === 0) break;
    totalDeleted += r.rowCount;
    await new Promise((res) => setTimeout(res, 100)); // let live ingestion through
  }
  return totalDeleted;
}

let sweeping = false;

// Sweep all devices that have a quota and trim any that exceed it.
export async function enforceQuotas() {
  if (sweeping) return 0; // never overlap with an in-flight sweep
  sweeping = true;
  try {
    const devs = await pool.query(
      'SELECT id, name, quota_bytes FROM devices WHERE quota_bytes IS NOT NULL AND quota_bytes > 0'
    );
    let totalDeleted = 0;
    for (const d of devs.rows) {
      const deleted = await enforceDevice(d.id, d.quota_bytes);
      if (deleted > 0) {
        totalDeleted += deleted;
        console.log(`[quota] device '${d.name}' over quota — rolled off ${deleted} oldest logs`);
      }
    }
    return totalDeleted;
  } catch (err) {
    console.error('[quota] enforcement error:', err.message);
    return 0;
  } finally {
    sweeping = false;
  }
}

let timer = null;
// Run on an interval (default every 5 minutes) plus once shortly after startup.
export function startQuotaEnforcement(intervalMs = 5 * 60 * 1000) {
  if (timer) return;
  setTimeout(enforceQuotas, 15000); // first pass shortly after boot
  timer = setInterval(enforceQuotas, intervalMs);
  console.log(`[quota] rolling quota enforcement every ${Math.round(intervalMs / 1000)}s`);
}

export function stopQuotaEnforcement() {
  if (timer) { clearInterval(timer); timer = null; }
}
