# Deploy Open Collaboration Server to AWS Lightsail (Amazon Linux 2023)

Target: a single Lightsail **instance** (2 GB RAM / 2 vCPU / 60 GB SSD), Amazon Linux 2023.
Public URL: **https://oct.dev.libr.live** (A record already points at the instance's static IP).
Architecture: `Caddy (:80/:443, auto TLS)  ->  oct-server container (:8100)` via docker compose.

> The server holds session state **in memory** and does **not** scale horizontally.
> Run exactly one instance. Restarts/redeploys drop all active live sessions — deploy off-hours.

---

## 0. Lightsail networking (one-time, in the Lightsail console)

1. **Static IP:** Networking → create a static IP and attach it to the instance
   (so the IP survives reboots). Confirm `oct.dev.libr.live` A record points to it.
2. **Firewall:** on the instance's Networking tab, open these IPv4 ports:
   - **22 (SSH)** — usually already open
   - **80 (HTTP)** — required for Let's Encrypt HTTP-01 challenge + redirect
   - **443 (HTTPS)** — the public app + WSS
   You do NOT need to open 8100 publicly (only Caddy talks to it, inside Docker).

Verify DNS from your laptop before continuing:
```bash
dig +short oct.dev.libr.live    # should print the static IP
```

---

## 1. SSH into the instance

```bash
ssh -i /path/to/LightsailDefaultKey.pem ec2-user@oct.dev.libr.live
```

## 2. Install Docker + compose plugin + git

```bash
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl enable --now docker

# Docker Compose v2 plugin
sudo mkdir -p /usr/local/lib/docker/cli-plugins
ARCH=$(uname -m)   # x86_64 or aarch64
sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Run docker without sudo (log out/in after this for it to take effect)
sudo usermod -aG docker ec2-user

# verify
docker --version
docker compose version
```

Re-login so the docker group applies:
```bash
exit
ssh -i /path/to/LightsailDefaultKey.pem ec2-user@oct.dev.libr.live
```

## 3. Clone the repository

```bash
git clone https://github.com/<your-fork>/open-collaboration-tools.git
cd open-collaboration-tools
```
> Use whichever remote holds your customized fork. Build happens on the box.

## 4. Configure secrets

```bash
cd deploy
cp .env.example .env

# Generate a stable JWT private key (PEM). Keep it secret; never rotate casually.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt_key.pem

# Put it into .env as a single quoted multi-line value:
#   OCT_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
#   ...
#   -----END PRIVATE KEY-----"
nano .env
```
Confirm `OCT_CORS_ALLOWED_ORIGINS=https://oct.dev.libr.live` and `OCT_SERVER_OWNER` are set.
Auth is **simple login** (already hardcoded in the compose file via `OCT_ACTIVATE_SIMPLE_LOGIN=true`).

## 5. Build and start

From the `deploy/` directory:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
First build takes a few minutes (npm install + build of the monorepo on 2 vCPU).

Watch logs until Caddy reports the cert was obtained and the server is listening:
```bash
docker compose -f docker-compose.prod.yml logs -f
```
Expected: oct-server logs "listening on 0.0.0.0:8100"; Caddy logs "certificate obtained" for oct.dev.libr.live.

## 6. Verify

```bash
# From your laptop:
curl -I https://oct.dev.libr.live          # expect HTTP/2 200 (or a redirect to the app)
```
Then connect from the VS Code extension by pointing its server URL at
`https://oct.dev.libr.live` and starting a collaboration session.

---

## Operations

| Action | Command (run from `deploy/`) |
|---|---|
| View logs | `docker compose -f docker-compose.prod.yml logs -f` |
| Restart | `docker compose -f docker-compose.prod.yml restart` |
| Stop | `docker compose -f docker-compose.prod.yml down` |
| Update to latest code | `git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Disk/health | `docker ps`, `df -h`, `free -m` |

### Updating drops active sessions
Because session state is in memory, `up -d --build` (which recreates the container)
ends all live sessions. Announce a maintenance window or deploy off-hours.

### TLS / cert notes
- Caddy stores certs in the `caddy_data` Docker volume; they auto-renew.
- If cert issuance fails, the usual causes are: DNS not yet propagated, or port 80/443
  not open in the Lightsail firewall. Fix, then `docker compose ... restart caddy`.

### Backups (optional)
There's no database; the only durable state worth keeping is `deploy/.env`
(the JWT key) and the `caddy_data` volume. Back up `.env` securely off-box.
