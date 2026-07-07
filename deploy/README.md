# Deploy guide for EquaTelegram on a VPS (DigitalOcean droplet)

This document lists the minimal steps to run the project on a droplet with a real domain and HTTPS.

## Prerequisites
- You purchased a domain and can add DNS records.
- You have a droplet (Ubuntu/Debian) and SSH access.

## High-level steps
1. Create DNS A record: point `your-domain.com` (and optionally `www`) to your droplet IP.
2. SSH to droplet and install Docker + Docker Compose.
3. Install `nginx` and `certbot` and configure reverse proxy.
4. Set `.env` with `MINIAPP_URL` and `BOT_TOKEN` on the droplet.
5. Start services with `docker compose up -d --build`.

## Commands (copy & run on the droplet)

Install Docker (Ubuntu/Debian):
```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

Install `nginx` and `certbot`:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Create nginx site config (see `deploy/nginx/equatelegram.conf`), then enable:
```bash
sudo ln -s /etc/nginx/sites-available/equatelegram /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Get TLS certificate via certbot:
```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Prepare `.env` in project root (example in `.env.example`), set `MINIAPP_URL=https://your-domain.com` and `BOT_TOKEN`.

Start the app with Docker Compose:
```bash
cd /path/to/EquaTelegram
docker compose up -d --build
```

Verify
- Open `https://your-domain.com` in a browser.
- Check logs: `docker compose logs -f server`

Notes
- Telegram Web Apps require valid public HTTPS URLs. Using Let's Encrypt is recommended.
- If you want, provide me with the domain and I will generate a ready-to-use `nginx` file with the domain filled in.
