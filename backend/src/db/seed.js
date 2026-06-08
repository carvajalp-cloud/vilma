import bcrypt from 'bcryptjs';
import pool from './pool.js';
import { SEV_TO_LEVEL } from '../services/fortiParser.js';

// Deterministic-ish PRNG so seeds are reproducible
let _s = 1337;
function rnd() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function randIp() { return `${10 + Math.floor(rnd() * 3)}.${Math.floor(rnd() * 255)}.${Math.floor(rnd() * 255)}.${1 + Math.floor(rnd() * 254)}`; }
function pubIp() { return `${pick([23, 45, 51, 104, 142, 185, 199, 203])}.${Math.floor(rnd() * 255)}.${Math.floor(rnd() * 255)}.${1 + Math.floor(rnd() * 254)}`; }

async function seed() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    console.log('[seed] clearing existing data...');
    await c.query('TRUNCATE events, logs, reports, alert_rules, devices, users, adoms RESTART IDENTITY CASCADE');

    // --- ADOMs ---
    const adomRes = await c.query(
      `INSERT INTO adoms (name, description) VALUES
        ('root','Default administrative domain'),
        ('Acme-Corp','Acme Corporation tenant'),
        ('Globex','Globex Industries tenant')
       RETURNING id, name`
    );
    const adoms = adomRes.rows;
    const rootId = adoms.find((a) => a.name === 'root').id;
    const acmeId = adoms.find((a) => a.name === 'Acme-Corp').id;
    console.log(`[seed] created ${adoms.length} ADOMs`);

    // --- Users ---
    const hash = (pw) => bcrypt.hashSync(pw, 10);
    await c.query(
      `INSERT INTO users (username, email, password_hash, role, adom_id) VALUES
        ('admin','admin@example.com',$1,'admin',NULL),
        ('analyst','analyst@acme.com',$2,'analyst',$4),
        ('viewer','viewer@acme.com',$3,'viewer',$4)`,
      [hash('admin123'), hash('analyst123'), hash('viewer123'), acmeId]
    );
    console.log('[seed] created users: admin/admin123, analyst/analyst123, viewer/viewer123');

    // --- Devices ---
    const deviceDefs = [
      [rootId, 'FGT-HQ-01', '192.168.1.1', 'FG100F0001', 'FortiGate-100F', 'firewall'],
      [rootId, 'FGT-DC-01', '192.168.10.1', 'FG200F0002', 'FortiGate-200F', 'firewall'],
      [acmeId, 'ACME-EDGE-FW', '10.20.0.1', 'FG60F0003', 'FortiGate-60F', 'firewall'],
      [acmeId, 'ACME-SWITCH', '10.20.0.2', 'FS108E0004', 'FortiSwitch-108E', 'switch'],
    ];
    const devIds = {};
    for (const [adom, name, ip, devid, model, type] of deviceDefs) {
      const r = await c.query(
        `INSERT INTO devices (adom_id, name, ip, devid, model, type, status, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,'online',now()) RETURNING id`,
        [adom, name, ip, devid, model, type]
      );
      devIds[devid] = { id: r.rows[0].id, adom };
    }
    console.log(`[seed] created ${deviceDefs.length} devices`);

    // --- Alert rules ---
    await c.query(
      `INSERT INTO alert_rules (adom_id, name, log_type, sev_min, field, op, value, category) VALUES
        ($1,'Critical & above','any',2,'','any','','System'),
        ($1,'Any detected threat','threat',7,'','any','','Threat'),
        ($1,'Blocked/denied traffic','traffic',7,'action','eq','deny','Traffic'),
        ($2,'Acme critical events','any',2,'','any','','System'),
        ($2,'Acme threats','threat',7,'','any','','Threat')`,
      [rootId, acmeId]
    );
    console.log('[seed] created alert rules');

    // --- Sample logs across the last 24h ---
    const apps = ['HTTPS', 'HTTP', 'DNS', 'SSH', 'SMTP', 'RDP', 'SMB', 'NTP', 'QUIC'];
    const threats = ['Trojan.GenericKD', 'EICAR_Test_File', 'SQL.Injection', 'Bruteforce.SSH', 'Botnet.C2', 'XSS.Attempt'];
    const actions = ['accept', 'deny', 'close', 'timeout'];
    const now = Date.now();
    const logRows = [];
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const dev = pick(Object.values(devIds));
      const ts = new Date(now - rnd() * 24 * 3600 * 1000);
      const roll = rnd();
      let logType, level, action, app, message, threat = null, src, dst;
      src = randIp();
      dst = rnd() > 0.4 ? pubIp() : randIp();
      if (roll < 0.7) {
        logType = 'traffic';
        action = pick(actions);
        app = pick(apps);
        level = action === 'deny' ? 'warning' : 'notice';
        message = `${action} ${app} ${src} -> ${dst}`;
      } else if (roll < 0.85) {
        logType = 'threat';
        threat = pick(threats);
        action = pick(['blocked', 'detected', 'quarantined']);
        app = pick(apps);
        level = pick(['critical', 'error', 'alert']);
        message = `${threat} ${action} (${src})`;
      } else if (roll < 0.95) {
        logType = 'event';
        level = pick(['notice', 'warning', 'information']);
        action = pick(['login', 'logout', 'config-change', 'vpn-up', 'vpn-down']);
        message = `admin ${action}`;
        app = null;
      } else {
        logType = 'system';
        level = pick(['warning', 'error', 'critical']);
        action = pick(['ha-failover', 'interface-down', 'high-cpu', 'disk-full']);
        message = `system ${action}`;
        app = null;
      }
      const sevIdx = Math.max(0, SEV_TO_LEVEL.indexOf(level === 'notification' ? 'notice' : level));
      const sev = sevIdx === -1 ? 6 : sevIdx;
      logRows.push({
        adom: dev.adom, device: dev.id, ts, logType,
        level, sev,
        src, dst,
        sport: 1024 + Math.floor(rnd() * 64000),
        dport: pick([80, 443, 22, 53, 3389, 445, 25, 123]),
        proto: pick(['TCP', 'UDP', 'ICMP']),
        action, app, threat,
        bytesSent: Math.floor(rnd() * 200000),
        bytesRecv: Math.floor(rnd() * 800000),
        message,
      });
    }

    // Bulk insert in chunks
    const chunk = 500;
    for (let i = 0; i < logRows.length; i += chunk) {
      const slice = logRows.slice(i, i + chunk);
      const values = [];
      const params = [];
      slice.forEach((r, j) => {
        const b = j * 16;
        values.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16})`);
        params.push(
          r.adom, r.device, r.ts, r.logType, r.level, r.sev,
          r.src, r.dst, r.sport, r.dport, r.proto, r.action,
          r.app, r.bytesSent, r.bytesRecv, r.message
        );
      });
      await c.query(
        `INSERT INTO logs (adom_id, device_id, ts, log_type, level, sev_level,
           src_ip, dst_ip, src_port, dst_port, protocol, action, app, bytes_sent, bytes_recv, message)
         VALUES ${values.join(',')}`,
        params
      );
    }
    console.log(`[seed] inserted ${logRows.length} sample logs`);

    // --- Derive some events from severe logs ---
    await c.query(
      `INSERT INTO events (adom_id, device_id, log_id, ts, sev_level, level, category, title, description, status)
       SELECT adom_id, device_id, id, ts, sev_level, level,
              CASE WHEN log_type='threat' THEN 'Threat' WHEN log_type='system' THEN 'System' ELSE 'General' END,
              CASE WHEN log_type='threat' THEN 'Threat detected: ' || message ELSE 'Severe event: ' || message END,
              message,
              CASE WHEN random() < 0.6 THEN 'open' WHEN random() < 0.8 THEN 'ack' ELSE 'closed' END
       FROM logs
       WHERE sev_level <= 2
       ORDER BY ts DESC
       LIMIT 200`
    );
    const evCount = await c.query('SELECT count(*) FROM events');
    console.log(`[seed] derived ${evCount.rows[0].count} events`);

    await c.query('COMMIT');
    console.log('[seed] done.');
  } catch (err) {
    await c.query('ROLLBACK');
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}

seed();
