export const SEV_NAMES = ['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Info', 'Debug'];

export function fmtBytes(n) {
  n = Number(n || 0);
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(1)} ${units[i]}`;
}

export function fmtNum(n) {
  return Number(n || 0).toLocaleString();
}

export function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString();
}

export const CHART_COLORS = ['#2f81f7', '#f85149', '#a371f7', '#d29922', '#3fb950', '#e8302a'];
