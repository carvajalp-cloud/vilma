# Vilma

A FortiAnalyzer-style centralized log analytics & security monitoring platform, built with **React + Node.js + PostgreSQL**.

It ingests Fortinet-style syslog over UDP, normalizes and stores logs, evaluates alert rules into security events, and presents everything through a SOC-style dashboard with multi-tenant isolation (ADOMs), authentication, and role-based access control.

---

## Features

| Area | What it does |
|------|--------------|
| **Real syslog ingestion** | UDP listener parses Fortinet `key=value` logs (traffic/UTM/event/system), auto-registers devices, and persists normalized records. An HTTP `POST /api/logs/ingest` endpoint is also available. |
| **Dashboard** | Live (auto-refreshing) KPIs, log-volume timeline, severity distribution, top source IPs, top applications. |
| **Log Viewer** | Searchable / filterable / paginated log explorer with a raw-log detail drawer. |
| **Event Monitor** | Alert-rule-generated security events with triage workflow (open → ack → closed). |
| **Device Manager** | Registered log sources with status, last-seen, and 24h log counts. |
| **Reports** | Generate & save Traffic Summary, Top Threats, Top Sources, and Event Summary reports. |
| **Auth + RBAC** | JWT login with three roles: **admin** (global), **analyst** (manage events/devices), **viewer** (read-only). |
| **Multi-tenant ADOMs** | Administrative Domains isolate devices/logs/events per tenant. Non-admins are scoped to one ADOM; admins can switch or view all. |

## Tech stack

- **Backend:** Node.js (ES modules), Express, `pg`, `jsonwebtoken`, `bcryptjs`, `dgram` (UDP syslog)
- **Frontend:** React 18, Vite, React Router, Recharts, Axios
- **Database:** PostgreSQL 16

---

## Quick start

### 1. Start PostgreSQL

With Docker (easiest):

```powershell
docker compose up -d
```

Or point `backend/.env` at any existing PostgreSQL instance (see `backend/.env.example`).

### 2. Backend

```powershell
cd backend
npm install
npm run setup     # runs migrate + seed (creates schema, demo ADOMs/users/devices, ~4000 sample logs)
npm run dev       # starts API on http://localhost:4000 and syslog UDP listener on :5514
```

### 3. Frontend

```powershell
cd frontend
npm install
npm run dev       # http://localhost:5173
```

Open **http://localhost:5173** and log in.

### Demo accounts

| Username | Password | Role | Scope |
|----------|----------|------|-------|
| `admin` | `admin123` | admin | all ADOMs |
| `analyst` | `analyst123` | analyst | Acme-Corp |
| `viewer` | `viewer123` | viewer | Acme-Corp |

---

## Sending logs to the syslog listener

The listener binds **UDP 5514** by default (`SYSLOG_PORT` in `backend/.env`). Port 514 is privileged on Windows/Linux, so 5514 is used for local testing.

Send synthetic Fortinet logs with the included generator:

```powershell
cd backend
node tools/send-syslog.js 100 127.0.0.1 5514
```

Within seconds the new logs appear in the Log Viewer / Dashboard, a `FGT-HQ-01` device auto-registers (under the first ADOM), and any matching alert rules create events.

To receive logs from a **real FortiGate**, configure it to send syslog to this host on UDP 5514 (or set `SYSLOG_PORT=514` and run the backend with administrator privileges):

```
config log syslogd setting
    set status enable
    set server "<this-host-ip>"
    set port 5514
end
```

You can also push a single log over HTTP:

```powershell
curl -X POST http://localhost:4000/api/logs/ingest `
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" `
  -d '{"raw":"<134>date=2026-06-07 time=10:00:00 devname=\"FGT-HQ-01\" devid=\"FG100F0001\" type=\"traffic\" level=\"notice\" srcip=10.0.0.5 dstip=8.8.8.8 dstport=53 proto=17 action=\"accept\" app=\"DNS\""}'
```

---

## Architecture

```
                       UDP 5514 (syslog)            HTTP :4000 (REST)
 FortiGate / devices ───────────────►┐         ┌──────────────────────► React SPA :5173
                                      ▼         ▼
                          ┌─────────────────────────────┐
                          │  Express backend            │
                          │  • syslog.js  (dgram)       │
                          │  • fortiParser.js           │
                          │  • ingest.js → alerting.js  │
                          │  • JWT auth + RBAC + ADOM    │
                          └──────────────┬──────────────┘
                                         ▼
                                  PostgreSQL 16
                    adoms · users · devices · logs · events · alert_rules · reports
```

### Severity model
Fortinet level names map to numeric `sev_level` 0–7 (0 = emergency … 7 = debug). Alert rules trigger when a log's severity is at or above a threshold, optionally matching a field condition (e.g. `action = deny`).

### Key API routes
- `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/stats/{summary,timeline,top,severity}`
- `GET /api/logs`, `GET /api/logs/:id`, `POST /api/logs/ingest`
- `GET/POST/PUT/DELETE /api/devices`
- `GET /api/events`, `PATCH /api/events/:id`, `GET /api/events/rules/list`
- `POST /api/reports/generate`, `GET /api/reports`, `GET /api/reports/:id`
- `GET/POST/PUT/DELETE /api/users` (admin)
- `GET/POST/DELETE /api/adoms`

All `/api` routes except `auth/login` and `health` require a `Bearer` token. ADOM scope is enforced server-side: non-admins can never read another tenant's data.

---

## Project layout

```
fortianalyzer-clone/
├─ docker-compose.yml          # PostgreSQL
├─ backend/
│  ├─ .env                     # config (edit me)
│  ├─ src/
│  │  ├─ index.js              # Express app + bootstraps syslog listener
│  │  ├─ config.js
│  │  ├─ db/  (pool, schema.sql, migrate, seed)
│  │  ├─ middleware/auth.js    # JWT, requireRole, ADOM scoping
│  │  ├─ services/  (syslog, fortiParser, ingest, alerting)
│  │  └─ routes/    (auth, stats, logs, devices, events, reports, users, adoms)
│  └─ tools/send-syslog.js     # synthetic log generator
└─ frontend/
   └─ src/
      ├─ context/AuthContext.jsx
      ├─ api/client.js
      ├─ components/ (Layout, Sidebar nav, AdomSelector, Badges, ProtectedRoute)
      └─ pages/ (Login, Dashboard, LogViewer, Events, Devices, Reports, Users, Adoms)
```

---

## Notes & next steps

This is a functional MVP. Natural extensions:
- Real-time push (WebSocket/SSE) instead of 15s polling
- CEF/LEEF and RFC5424 structured-data parsers; TCP & TLS syslog
- Log retention/rollup policies and partitioned `logs` table for scale
- PDF/CSV report export and scheduled reports
- Editable alert rules UI and notification channels (email/webhook)
- Per-ADOM dashboards and saved log-view filters

> **Security note:** change `JWT_SECRET` and the seeded passwords before exposing this anywhere. The seed `TRUNCATE`s all tables — don't run `npm run seed` against data you care about.
