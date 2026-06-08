// Parses Fortinet-style syslog messages (key=value pairs) into a normalized log object.
// Also handles a leading syslog priority like "<134>" and a generic fallback.

// Fortinet "level" name -> numeric severity (0 = most severe).
export const LEVEL_TO_SEV = {
  emergency: 0,
  alert: 1,
  critical: 2,
  error: 3,
  warning: 4,
  notice: 5,
  notification: 5,
  information: 6,
  informational: 6,
  notif: 5,
  debug: 7,
};

export const SEV_TO_LEVEL = [
  'emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'information', 'debug',
];

export function sevLevelFromName(name) {
  if (name == null) return 6;
  const v = LEVEL_TO_SEV[String(name).toLowerCase()];
  return v == null ? 6 : v;
}

export function protoName(num) {
  const map = { '1': 'ICMP', '6': 'TCP', '17': 'UDP', '47': 'GRE', '50': 'ESP' };
  return map[String(num)] || String(num || '');
}

// Split a Fortinet log line into key=value pairs. Values may be quoted.
function parseKeyValues(line) {
  const out = {};
  // Matches key=value or key="quoted value"
  const re = /(\w[\w.-]*)=("([^"]*)"|[^\s]*)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const key = m[1];
    const val = m[3] !== undefined ? m[3] : m[2];
    out[key] = val;
  }
  return out;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

// Strip a leading syslog PRI like "<134>" and optional RFC3164/5424 header noise.
function stripSyslogHeader(raw) {
  let s = raw.trim();
  s = s.replace(/^<\d+>/, '');
  return s;
}

// Returns a normalized log object (NOT yet associated with adom/device).
export function parseFortiLog(raw) {
  const line = stripSyslogHeader(raw);
  const kv = parseKeyValues(line);

  // Map Fortinet log types -> our normalized log_type
  let logType = (kv.type || '').toLowerCase();
  if (logType === 'utm') logType = 'threat';
  if (!['traffic', 'threat', 'event', 'system'].includes(logType)) {
    // subtype hints for utm/threat logs
    const sub = (kv.subtype || '').toLowerCase();
    if (['virus', 'ips', 'webfilter', 'app-ctrl', 'attack', 'anomaly', 'dlp'].includes(sub)) {
      logType = 'threat';
    } else if (kv.srcip && kv.dstip && (kv.sentbyte || kv.rcvdbyte || kv.action)) {
      logType = 'traffic';
    } else {
      logType = logType || 'event';
    }
  }

  const level = (kv.level || kv.severity || 'information').toLowerCase();

  // Build timestamp from date + time if present, else now.
  let ts = new Date();
  if (kv.date && kv.time) {
    const parsed = new Date(`${kv.date}T${kv.time}`);
    if (!Number.isNaN(parsed.getTime())) ts = parsed;
  } else if (kv.eventtime) {
    // eventtime is epoch nanoseconds in newer FortiOS
    const ns = Number(kv.eventtime);
    if (!Number.isNaN(ns)) ts = new Date(ns / 1e6);
  }

  const message =
    kv.msg ||
    kv.attack ||
    kv.virus ||
    kv.action ||
    kv.logdesc ||
    `${kv.type || 'log'}/${kv.subtype || ''}`;

  return {
    ts,
    log_type: logType,
    subtype: kv.subtype || '',
    level,
    sev_level: sevLevelFromName(level),
    src_ip: kv.srcip || kv.src || null,
    dst_ip: kv.dstip || kv.dst || null,
    src_port: toInt(kv.srcport),
    dst_port: toInt(kv.dstport),
    protocol: kv.proto ? protoName(kv.proto) : (kv.service || null),
    action: kv.action || null,
    app: kv.app || kv.service || kv.appcat || null,
    user_name: kv.user || kv.srcname || null,
    bytes_sent: toInt(kv.sentbyte) || 0,
    bytes_recv: toInt(kv.rcvdbyte) || 0,
    message,
    raw,
    // Device identity hints
    _devid: kv.devid || kv.devname || null,
    _devname: kv.devname || kv.devid || null,
  };
}

export default parseFortiLog;
