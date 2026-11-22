# Production Deployment Guide — SetuNxt Blog Content Engine

This document provides step-by-step instructions for deploying the SetuNxt Blog Content Engine (`setunxt-cms`) into a production environment.

---

## 1. Architecture Overview

The blog engine is a lightweight, self-contained Node.js service running on a single port (default `8787`). It requires **zero external database services** (PostgreSQL, MySQL, Redis, MongoDB are not required) because it leverages Node's built-in `node:sqlite` database with Write-Ahead Logging (`WAL`) enabled.

The single process handles:
- **Admin Studio UI** at `/admin` (session-authenticated with CSRF protection)
- **Public REST API** at `/api/v1/posts` and `/api/v1/posts/:slug` (cached with ETags)
- **Real-Time Updates** at `/api/v1/stream` (Server-Sent Events)
- **Token-Gated Live Preview** at `/api/v1/preview/:id`
- **Image Processing & Storage** at `/media/:file`
- **System Healthcheck** at `/healthz`

```
┌────────────────────────────────────────────────────────┐
│                   Visitor's Browser                    │
│             https://setunxt.com/blog.html              │
└──────────────────────────┬─────────────────────────────┘
                           │ Public API & SSE Stream
                           ▼
┌────────────────────────────────────────────────────────┐
│               Reverse Proxy (Nginx / Caddy)            │
│         https://blog-api.setunxt.com (Port 443)        │
└──────────────────────────┬─────────────────────────────┘
                           │ Reverse Proxy to localhost:8787
                           ▼
┌────────────────────────────────────────────────────────┐
│            SetuNxt Blog Engine (Node.js 22+)           │
│  ├── Express/Built-in HTTP Router                     │
│  ├── Local SQLite DB (data/engine.db in WAL mode)      │
│  └── Media Storage (data/uploads/)                     │
└────────────────────────────────────────────────────────┘
```

---

## 2. Server Requirements

- **Operating System:** Ubuntu 22.04 LTS / 24.04 LTS, Debian 12, or any modern Linux distribution
- **Node.js:** **>= 22.5.0** (required for native `node:sqlite` support)
- **RAM:** Minimum 512MB (1GB recommended if processing high-resolution images)
- **Disk:** 5GB+ SSD (depends on volume of uploaded media)
- **Domain/Subdomain:** e.g., `blog-api.setunxt.com` or `cms.setunxt.com` pointing to your server's public IP (A/AAAA DNS record)

---

## 3. Server Setup & Installation

### Step 3.1: Install Node.js 22.x on Linux

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw

# Install Node.js 22 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify versions (must be Node 22.5+)
node -v
npm -v
```

### Step 3.2: Clone Repository & Install Dependencies

```bash
# Create application directory
sudo mkdir -p /var/www/setunxt-cms
sudo chown -R $USER:$USER /var/www/setunxt-cms

# Copy or clone your repository into the directory
cd /var/www/setunxt-cms

# Install optional sharp dependency (for auto WebP conversion and EXIF stripping)
npm install --omit=dev
```

---

## 4. Environment Configuration (`.env`)

Create your production configuration file in the project root:

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

### Production `.env` Template

```env
# Server Port & Public Base URL
PORT=8787
PUBLIC_BASE_URL=https://blog-api.setunxt.com

# Admin Authentication
ADMIN_USERNAME=admin
ADMIN_NAME=SetuNxt Admin
ADMIN_EMAIL=admin@setunxt.com
ADMIN_PASSWORD=CHANGE_THIS_TO_A_STRONG_PASSWORD

# Security Secrets (Must be 32+ random characters)
SESSION_SECRET=GENERATE_RANDOM_SESSION_SECRET_HERE

# Website Integration
SITE_URL=https://setunxt.com/blog.html
# Allow setunxt.com to access API in browsers (leave blank to allow all)
SITE_ORIGINS=https://setunxt.com,https://www.setunxt.com

# Media & Storage Settings
IMAGE_HOSTS=images.unsplash.com
DATA_DIR=/var/www/setunxt-cms/data
MAX_UPLOAD_MB=5

# Reverse Proxy (Set to 1 when behind Nginx, Caddy, or Cloudflare)
TRUST_PROXY=1
```

### Generate Strong Secrets

Generate secure keys on your server using `openssl`:

```bash
# For SESSION_SECRET:
openssl rand -hex 32

# For ADMIN_PASSWORD:
openssl rand -base64 18
```

---

## 5. Initialize the Database

Run the initial database seed to import initial blog posts and set up the schema:

```bash
npm run seed
```

This creates the SQLite database file and uploads folder in `data/`:
- `data/engine.db` (SQLite Database)
- `data/uploads/` (Uploaded post images)

Set safe folder permissions:
```bash
chmod -R 700 /var/www/setunxt-cms/data
```

---

## 6. Process Management (Keep Server Running)

Choose **Option A (Systemd - Recommended)** or **Option B (PM2)**.

### Option A: Systemd Service (Recommended)

Create a systemd unit file:

```bash
sudo nano /etc/systemd/system/setunxt-cms.service
```

Paste the following configuration:

```ini
[Unit]
Description=SetuNxt Blog Engine
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/setunxt-cms
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# Security Hardening
ProtectSystem=full
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Give `www-data` ownership of the application:
```bash
sudo chown -R www-data:www-data /var/www/setunxt-cms
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable setunxt-cms
sudo systemctl start setunxt-cms

# Check service status
sudo systemctl status setunxt-cms
```

To view live server logs:
```bash
sudo journalctl -u setunxt-cms -f
```

---

### Option B: PM2 Process Manager

If you prefer PM2:

```bash
sudo npm install -g pm2
pm2 start server/index.js --name "setunxt-cms"
pm2 save
pm2 startup
```

---

## 7. Reverse Proxy & SSL Setup

Configure a reverse proxy to manage HTTPS, HTTP/2, and route traffic to port `8787`.

### Option A: Nginx (Standard)

Install Nginx & Certbot:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/blog-api.setunxt.com`:
```nginx
server {
    server_name blog-api.setunxt.com;

    # Maximum upload size for blog images
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;

        # Standard Proxy Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # CRITICAL for Server-Sent Events (SSE /api/v1/stream):
        # Disabling buffering allows real-time push events to flow immediately
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 24h;
    }
}
```

Enable site and acquire SSL certificate:
```bash
sudo ln -s /etc/nginx/sites-available/blog-api.setunxt.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Issue free Let's Encrypt certificate
sudo certbot --nginx -d blog-api.setunxt.com
```

---

### Option B: Caddy (Automatic HTTPS)

If using Caddy, it handles SSL automatically. Create `/etc/caddy/Caddyfile`:

```caddy
blog-api.setunxt.com {
    reverse_proxy localhost:8787 {
        # Flush SSE buffers immediately
        flush_interval -1
    }
}
```

Reload Caddy:
```bash
sudo systemctl reload caddy
```

---

## 8. Connect the Engine to Your Live Static Site

On your existing static site repository (`setunxt.com`):

1. **Copy `client/blog-live.js`** to your site's asset directory (e.g. `/assets/js/blog-live.js`).
2. In your site's `blog.html` right before the closing `</body>` tag, add:

```html
<!-- SetuNxt Blog Engine Live Connector -->
<script>
  window.BLOG_ENGINE_API = 'https://blog-api.setunxt.com/api/v1';
</script>
<script src="/assets/js/blog-live.js" defer></script>
```

3. Ensure `SITE_URL` in your CMS `.env` is set to `https://setunxt.com/blog.html`.

Now:
- Live blog posts render dynamically from the CMS into your existing card layout.
- The 10 hardcoded fallback `<article>` cards in your HTML remain as an offline safeguard.
- Real-time updates appear immediately without requiring page refreshes.

---

## 9. Backup & Maintenance

Because all state lives in `DATA_DIR`, backing up the CMS requires **no database export dumps**.

### 9.1 Daily Automated Backup Script

Create `/usr/local/bin/backup-setunxt-cms.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/setunxt-cms"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# Safe SQLite snapshot (works even while SQLite is being written to in WAL mode)
sqlite3 /var/www/setunxt-cms/data/engine.db ".backup '$BACKUP_DIR/engine_$DATE.db'"

# Archive uploaded images
tar -czf "$BACKUP_DIR/uploads_$DATE.tar.gz" -C /var/www/setunxt-cms/data uploads/

# Retain only last 14 days of backups
find "$BACKUP_DIR" -type f -mtime +14 -delete
```

Make executable and add to crontab:
```bash
sudo chmod +x /usr/local/bin/backup-setunxt-cms.sh
# Run nightly at 03:00 AM
(crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/backup-setunxt-cms.sh") | crontab -
```

---

## 10. Healthcheck & Monitoring

- **Uptime Monitoring:** Configure Pingdom, UptimeRobot, or BetterUptime to ping:
  ```
  GET https://blog-api.setunxt.com/healthz
  ```
  Expected Response: `200 OK` with JSON `{"ok":true,"seq":...,"streams":...}`.

---

## 11. Security Checklist

- [ ] `ADMIN_PASSWORD` is strong and different from the default.
- [ ] `SESSION_SECRET` is set to a 64-char random string in `.env`.
- [ ] `PUBLIC_BASE_URL` uses `https://` (this automatically turns on the `Secure` flag on session cookies).
- [ ] `TRUST_PROXY=1` is enabled in `.env` so IP rate-limiting accurately checks real visitor IPs behind the reverse proxy.
- [ ] Permissions on `.env` are set to `600` (`chmod 600 .env`).
- [ ] Firewall (UFW) only exposes ports 22, 80, and 443 (`sudo ufw allow ssh && sudo ufw allow http && sudo ufw allow https && sudo ufw enable`).

