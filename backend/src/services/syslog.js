import dgram from 'dgram';
import config from '../config.js';
import { parseFortiLog } from './fortiParser.js';
import { ingestParsedLog } from './ingest.js';

let server = null;
let received = 0;
let ingested = 0;
let errors = 0;

export function startSyslogListener() {
  if (!config.syslog.enabled) {
    console.log('[syslog] disabled (SYSLOG_ENABLED=false)');
    return null;
  }

  server = dgram.createSocket('udp4');

  server.on('message', async (msg, rinfo) => {
    received++;
    const raw = msg.toString('utf8').trim();
    if (!raw) return;
    try {
      const parsed = parseFortiLog(raw);
      await ingestParsedLog(parsed, rinfo.address);
      ingested++;
    } catch (err) {
      errors++;
      if (errors <= 5 || errors % 100 === 0) {
        console.error(`[syslog] ingest error (#${errors}):`, err.message);
      }
    }
  });

  server.on('error', (err) => {
    console.error('[syslog] socket error:', err.message);
    if (err.code === 'EACCES') {
      console.error('[syslog] Port ' + config.syslog.port + ' requires elevated privileges. ' +
        'Set SYSLOG_PORT to a value >1024 (e.g. 5514) or run with admin rights.');
    }
    server.close();
    server = null;
  });

  server.on('listening', () => {
    const a = server.address();
    console.log(`[syslog] UDP listener on ${a.address}:${a.port} (send Fortinet syslog here)`);
  });

  server.bind(config.syslog.port, config.syslog.host);
  return server;
}

export function getSyslogStats() {
  return {
    enabled: config.syslog.enabled,
    listening: !!server,
    port: config.syslog.port,
    received,
    ingested,
    errors,
  };
}

export function stopSyslogListener() {
  if (server) {
    server.close();
    server = null;
  }
}
