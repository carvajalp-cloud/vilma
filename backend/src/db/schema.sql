-- Vilma schema
-- Multi-tenant via ADOMs (Administrative Domains). Admins are global; analysts/viewers are scoped to an ADOM.

CREATE TABLE IF NOT EXISTS adoms (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','analyst','viewer')),
  -- Assigned ADOM for non-admin users. NULL for global admins.
  adom_id       INTEGER REFERENCES adoms(id) ON DELETE SET NULL,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id         SERIAL PRIMARY KEY,
  adom_id    INTEGER NOT NULL REFERENCES adoms(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  ip         TEXT,
  devid      TEXT,                 -- Fortinet device serial / devid
  vendor     TEXT DEFAULT 'Fortinet',
  model      TEXT DEFAULT '',
  type       TEXT DEFAULT 'firewall',
  status     TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('online','offline','unknown')),
  last_seen  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (adom_id, devid)
);

-- Per-device rolling storage quota (NULL = unlimited). When a device's estimated
-- log storage exceeds this, the oldest logs are deleted to keep the newest.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS quota_bytes BIGINT;

-- A device may receive logs from several source IPs (e.g. SD-WAN with multiple WAN links).
-- Matching is primarily by serial (devid); these IPs are the secondary match + auto-learned set.
CREATE TABLE IF NOT EXISTS device_ips (
  id         SERIAL PRIMARY KEY,
  device_id  INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ip         TEXT NOT NULL UNIQUE,
  auto       BOOLEAN NOT NULL DEFAULT false,   -- true = learned from traffic, false = added manually
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_ips_device ON device_ips(device_id);

-- Backfill from the legacy single ip column (idempotent).
INSERT INTO device_ips (device_id, ip, auto)
SELECT id, ip, false FROM devices WHERE ip IS NOT NULL AND ip <> ''
ON CONFLICT (ip) DO NOTHING;

CREATE TABLE IF NOT EXISTS logs (
  id          BIGSERIAL PRIMARY KEY,
  adom_id     INTEGER NOT NULL REFERENCES adoms(id) ON DELETE CASCADE,
  device_id   INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  log_type    TEXT NOT NULL DEFAULT 'event',   -- traffic | threat | event | system
  subtype     TEXT DEFAULT '',
  level       TEXT DEFAULT 'information',       -- emergency..debug (Fortinet level names)
  sev_level   SMALLINT NOT NULL DEFAULT 6,      -- 0 emergency .. 7 debug
  src_ip      TEXT,
  dst_ip      TEXT,
  src_port    INTEGER,
  dst_port    INTEGER,
  protocol    TEXT,
  action      TEXT,
  app         TEXT,
  user_name   TEXT,
  bytes_sent  BIGINT DEFAULT 0,
  bytes_recv  BIGINT DEFAULT 0,
  message     TEXT DEFAULT '',
  raw         TEXT DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logs_adom_ts   ON logs (adom_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_type      ON logs (adom_id, log_type);
CREATE INDEX IF NOT EXISTS idx_logs_sev       ON logs (adom_id, sev_level);
CREATE INDEX IF NOT EXISTS idx_logs_device    ON logs (device_id);
CREATE INDEX IF NOT EXISTS idx_logs_src       ON logs (src_ip);
CREATE INDEX IF NOT EXISTS idx_logs_dst       ON logs (dst_ip);

CREATE TABLE IF NOT EXISTS alert_rules (
  id           SERIAL PRIMARY KEY,
  adom_id      INTEGER NOT NULL REFERENCES adoms(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  log_type     TEXT DEFAULT 'any',     -- any | traffic | threat | event | system
  sev_min      SMALLINT NOT NULL DEFAULT 3,   -- trigger when sev_level <= sev_min (more severe)
  field        TEXT DEFAULT '',         -- optional field to match (e.g. action)
  op           TEXT DEFAULT 'any' CHECK (op IN ('any','eq','neq','contains')),
  value        TEXT DEFAULT '',
  category     TEXT DEFAULT 'General',
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  adom_id     INTEGER NOT NULL REFERENCES adoms(id) ON DELETE CASCADE,
  device_id   INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  log_id      BIGINT REFERENCES logs(id) ON DELETE SET NULL,
  rule_id     INTEGER REFERENCES alert_rules(id) ON DELETE SET NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sev_level   SMALLINT NOT NULL DEFAULT 3,
  level       TEXT DEFAULT 'error',
  category    TEXT DEFAULT 'General',
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','ack','closed')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_adom_ts ON events (adom_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_status  ON events (adom_id, status);

CREATE TABLE IF NOT EXISTS reports (
  id           SERIAL PRIMARY KEY,
  -- NULL adom_id = a global, cross-customer admin report (visible to admins only).
  adom_id      INTEGER REFERENCES adoms(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,         -- traffic_summary | top_threats | top_sources | event_summary | executive_summary | security_overview | cross_customer
  params       JSONB DEFAULT '{}'::jsonb,
  data         JSONB DEFAULT '{}'::jsonb,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent: relax the original NOT NULL so cross-customer admin reports can be stored.
ALTER TABLE reports ALTER COLUMN adom_id DROP NOT NULL;
