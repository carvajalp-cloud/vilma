// Sends synthetic Fortinet-style syslog messages over UDP to test the listener.
// Usage: node tools/send-syslog.js [count] [host] [port]
//   node tools/send-syslog.js 50 127.0.0.1 514
import dgram from 'dgram';

const count = parseInt(process.argv[2] || '20', 10);
const host = process.argv[3] || '127.0.0.1';
const port = parseInt(process.argv[4] || '514', 10);

const sock = dgram.createSocket('udp4');
const apps = ['HTTPS', 'DNS', 'SSH', 'SMTP', 'RDP'];
const threats = ['Trojan.GenericKD', 'EICAR_Test_File', 'Bruteforce.SSH', 'Botnet.C2'];
const levels = ['notice', 'warning', 'error', 'critical', 'alert'];
const r = (n) => Math.floor(Math.random() * n);
const ip = () => `10.${r(255)}.${r(255)}.${1 + r(254)}`;

function pad(n) { return String(n).padStart(2, '0'); }
function makeLine(i) {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const isThreat = Math.random() < 0.3;
  const common = `<134>date=${date} time=${time} devname="FGT-HQ-01" devid="FG100F0001" `;
  if (isThreat) {
    return common + `type="utm" subtype="virus" level="${levels[r(levels.length)]}" ` +
      `srcip=${ip()} dstip=${ip()} srcport=${1024 + r(60000)} dstport=443 proto=6 ` +
      `action="blocked" virus="${threats[r(threats.length)]}" app="${apps[r(apps.length)]}" ` +
      `msg="threat detected sample ${i}"`;
  }
  const action = Math.random() < 0.3 ? 'deny' : 'accept';
  return common + `type="traffic" subtype="forward" level="notice" ` +
    `srcip=${ip()} dstip=${ip()} srcport=${1024 + r(60000)} dstport=${[80,443,22,53][r(4)]} proto=6 ` +
    `action="${action}" app="${apps[r(apps.length)]}" sentbyte=${r(200000)} rcvdbyte=${r(800000)} ` +
    `msg="traffic sample ${i}"`;
}

let sent = 0;
for (let i = 0; i < count; i++) {
  const buf = Buffer.from(makeLine(i));
  sock.send(buf, port, host, (err) => {
    if (err) console.error('send error', err.message);
    if (++sent === count) {
      console.log(`Sent ${count} syslog messages to ${host}:${port}`);
      sock.close();
    }
  });
}
