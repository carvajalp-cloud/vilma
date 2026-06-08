import { SEV_NAMES } from '../utils.js';

export function SevBadge({ level, sev }) {
  const s = sev ?? 6;
  return <span className={`badge sev-${s}`}>{level || SEV_NAMES[s] || s}</span>;
}

export function TypeBadge({ type }) {
  return <span className={`badge type-${type}`}>{type}</span>;
}

export function StatusBadge({ status }) {
  return <span className={`badge status-${status}`}>{status}</span>;
}
