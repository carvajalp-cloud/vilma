// Evaluates enabled alert_rules for an inserted log and creates events when matched.
// Rules are cached briefly to avoid a DB hit on every single log.

let cache = { at: 0, rules: [] };
const TTL_MS = 15000;

async function loadRules(client) {
  if (cache.rules.length && Date.now() - cache.at < TTL_MS) return cache.rules;
  const r = await client.query('SELECT * FROM alert_rules WHERE enabled = true');
  cache = { at: Date.now(), rules: r.rows };
  return cache.rules;
}

function fieldValue(log, field) {
  if (!field) return null;
  const v = log[field];
  return v == null ? null : String(v);
}

function ruleMatches(rule, log) {
  if (rule.adom_id !== log.adom_id) return false;
  if (rule.log_type && rule.log_type !== 'any' && rule.log_type !== log.log_type) return false;
  // sev_min: trigger when log is at least this severe (lower sev_level = more severe)
  if (log.sev_level > rule.sev_min) return false;
  if (rule.op && rule.op !== 'any' && rule.field) {
    const lv = fieldValue(log, rule.field);
    if (lv == null) return false;
    const target = String(rule.value || '');
    if (rule.op === 'eq' && lv.toLowerCase() !== target.toLowerCase()) return false;
    if (rule.op === 'neq' && lv.toLowerCase() === target.toLowerCase()) return false;
    if (rule.op === 'contains' && !lv.toLowerCase().includes(target.toLowerCase())) return false;
  }
  return true;
}

export async function evaluateAlerts(client, log) {
  const rules = await loadRules(client);
  for (const rule of rules) {
    if (!ruleMatches(rule, log)) continue;
    const title = `${rule.name}: ${log.message || log.log_type}`.slice(0, 200);
    await client.query(
      `INSERT INTO events (adom_id, device_id, log_id, rule_id, ts, sev_level, level, category, title, description, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open')`,
      [
        log.adom_id, log.device_id, log.id, rule.id, log.ts,
        log.sev_level, log.level, rule.category, title, log.message,
      ]
    );
  }
}

export function invalidateRuleCache() {
  cache = { at: 0, rules: [] };
}
