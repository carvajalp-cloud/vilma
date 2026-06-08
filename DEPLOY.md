# Deploying Vilma to Azure (single VM + Docker + GitHub Actions CI/CD)

This deploys the whole stack — PostgreSQL, the backend API + **real UDP syslog listener**, and the
frontend — onto one Ubuntu VM running Docker Compose. A GitHub Actions pipeline builds the images and
deploys on every push to `main`.

```
                Internet
   80/443 (web) │  UDP 5514 (syslog from devices)
                ▼
        ┌──────────────── Azure VM (Ubuntu + Docker) ───────────────┐
        │  frontend (nginx)  →  backend (API + syslog)  →  db (Postgres) │
        │       :80                :4000  :5514/udp        internal      │
        └────────────────────────────────────────────────────────────┘
                ▲ deploy over SSH
        GitHub Actions  ── builds & pushes images ──► GHCR
```

## Prerequisites

- An **Azure subscription** and the **Azure CLI** (`az`) installed + logged in (`az login`).
- A **GitHub repository** containing this code (the CI/CD pipeline runs from there).
- An **SSH key pair** for the VM.
- Docker is only needed locally if you want to test images before pushing.

---

## Step 1 — Create an SSH key

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\vilma -N '""'
# creates $HOME\.ssh\vilma (private) and vilma.pub (public)
```

## Step 2 — Provision the VM + networking

From the repo root:

```powershell
cd deploy
az login                      # if not already
az account set --subscription "<your-subscription-id-or-name>"

./provision.ps1 `
  -GitHubOwner "<your-github-username-or-org>" `
  -ResourceGroup "vilma-rg" `
  -Location "eastus" `
  -SshPublicKeyPath "$HOME\.ssh\vilma.pub" `
  -SshSourceAddress "<your.public.ip>/32"      # lock SSH to your IP (recommended)
```

`-GitHubOwner` must match the GitHub account that will host the container images (lowercased into
`ghcr.io/<owner>/vilma-*`). When it finishes it prints the **public IP**, **FQDN**, **app URL**, and
**SSH command**. The VM boots, installs Docker, and writes `/opt/vilma/{docker-compose.prod.yml,.env}`
with **randomly generated** DB / JWT secrets and an admin password.

> Networking opened by the template: TCP 80, 443, 22 (SSH locked to your IP if you set it), and **UDP 5514** for syslog.

## Step 3 — Add GitHub repo secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|--------|-------|
| `AZURE_VM_HOST` | the public IP from step 2 |
| `AZURE_VM_USER` | `azureuser` (or your `-AdminUsername`) |
| `AZURE_VM_SSH_KEY` | the **contents of the private key** `$HOME\.ssh\vilma` (the whole file) |

No registry secrets are needed — the pipeline uses the built-in `GITHUB_TOKEN` to push to and pull from GHCR.

## Step 4 — Push to deploy

```powershell
cd ..                          # repo root
git init                       # if not already a repo
git add .
git commit -m "Deploy Vilma to Azure"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

The **Deploy Vilma** workflow runs automatically (watch the **Actions** tab):
1. Builds `vilma-backend` and `vilma-frontend` images → pushes to GHCR.
2. SSHes into the VM, pulls the images, runs the DB **migration** and **bootstrap** (creates a default
   customer + admin user), and starts the stack.

When it's green, open the **App URL** (e.g. `http://<fqdn>`).

## Step 5 — Log in

The first-run admin password was generated on the VM. Retrieve it:

```powershell
ssh azureuser@<public-ip> "grep ADMIN_ /opt/vilma/.env"
```

Log in as that user, then **create a new admin and change/disable the default** (Admin → Users).

---

## Optional — load demo data

The production DB starts empty (no fake logs). To populate the same demo dataset used locally
(customers, devices, ~4000 sample logs) — **note this WIPES existing data**:

```powershell
ssh azureuser@<public-ip>
cd /opt/vilma
docker compose -f docker-compose.prod.yml run --rm backend node src/db/seed.js
```

## Pointing real devices at it

Configure a FortiGate (or any syslog source) to send to **`<public-ip>` UDP 5514**:

```
config log syslogd setting
    set status enable
    set server "<public-ip>"
    set port 5514
end
```

Test from your machine without a device:

```powershell
# (run against the deployed VM's IP)
node backend/tools/send-syslog.js 50 <public-ip> 5514
```

---

## Day-2 operations

**Redeploy:** just push to `main` (or run the workflow manually). Images rebuild and the VM restarts with
the new version. The DB volume (`pgdata`) persists across deploys.

**Logs / status (on the VM):**
```bash
cd /opt/vilma
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
```

**Backup the database:**
```bash
docker compose -f docker-compose.prod.yml exec db pg_dump -U vilma vilma > vilma-backup.sql
```

**Tear everything down:**
```powershell
az group delete --name vilma-rg --yes --no-wait
```

---

## Adding HTTPS (recommended for production)

The VM serves HTTP on port 80. For TLS you have two easy options:

1. **Azure-managed**: put the VM behind an Application Gateway or Azure Front Door with a managed certificate.
2. **On the VM with a domain**: point a DNS A-record at the public IP, then add a Caddy or nginx+certbot
   container in front of `frontend` for automatic Let's Encrypt certificates. (Ask and I'll wire this in.)

## Notes & security

- Change `ADMIN_PASSWORD`, and the generated `JWT_SECRET`/`PGPASSWORD` live only in `/opt/vilma/.env` (mode 600).
- Lock `-SshSourceAddress` to your IP; consider restricting `-SyslogSourceAddress` to your devices' IPs.
- GHCR images are private by default to your account; the pipeline authenticates with `GITHUB_TOKEN`.
- The `db` container is **not** exposed to the internet — only the app and syslog ports are.
