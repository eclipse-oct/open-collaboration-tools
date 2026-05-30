# Deployment Planning Session — Open Collaboration Tools

## Goal
Deploy the **Open Collaboration Server** (the backend of this monorepo) to host live coding
sessions for a VS Code / Google Marketplace extension, reachable at the custom domain
**`oct.dev.libr.live`**.

## Key facts about the project
- Monorepo (`workspaces: packages/*`): npm libraries + VS Code extension + a **long-running Node.js server**.
- Deployable artifact = **`open-collaboration-server`** (NOT a static frontend; root Vite config is just a dev harness).
- Server characteristics:
  - Listens on **port 8100** (`--port`, `--hostname` flags; default hostname `localhost`).
  - Uses **WebSockets** (`socket.io` + `ws`) for live collaboration.
  - **Stateful: holds session data in memory.** README: horizontal scaling NOT supported → **run a single instance only**.
  - Start: `npm run start` → runs `open-collaboration-server`.
  - Env vars: `OCT_JWT_PRIVATE_KEY` (set in prod; otherwise warns + uses dev key),
    `OCT_ACTIVATE_SIMPLE_LOGIN=true` for built-in login, plus OAuth provider config (Google/GitHub/Keycloak/Authentik).
  - Per-config env lookup via `OCT_`-prefixed keys (`utils/configuration.ts`).
- Ships a **Dockerfile** (FROM node:lts-slim, builds, EXPOSE 8100, `CMD npm run start`)
  and **docker-compose.yml**.

## Hosting analysis / decisions
- **AWS Amplify Hosting: NOT suitable** — built for static/SSR frontends; can't do persistent
  long-running process, native WebSockets, or in-memory session state.
- **Recommended targets:** container/VM services. For "cheap + robust single instance":
  **AWS Lightsail** chosen.

## Sizing (for ~100 monthly active users / live coding)
- 100 MAU → ~5–15 peak concurrent users, ~2–4 concurrent sessions. Small workload.
- **Per-session RAM estimate:** ~5–15 MB typical, up to ~30–60 MB for large workspaces
  (driven by shared code size + Yjs CRDT overhead ~2–5× raw text + edit history, NOT user count).
- **32 GB RAM is massive overkill** (~$160/mo on a Lightsail VPS; Containers cap at 8 GB anyway).
- **Right-sized pick: Lightsail Containers "Small" (2 GB / 1 vCPU) ≈ $10/mo.** Huge headroom.
- Caveat: restarts/redeploys drop all active sessions (in-memory state). Deploy off-hours.

## Custom domain (`oct.dev.libr.live`) — possible on Lightsail
- **Lightsail Containers:** built-in custom domain + free auto-renewing TLS cert; WSS works
  through managed endpoint. Add CNAME (app) + CNAME (cert validation) at the libr.live DNS provider.
- **Lightsail Instance (VPS):** point A record → free static IP; run Caddy/nginx + Let's Encrypt
  for TLS yourself. Cheaper, more manual.
- **Recommendation: Lightsail Containers** (AWS manages cert + WSS endpoint).

## Open decisions (PENDING — not yet answered)
1. **Platform:** Lightsail Containers (recommended) vs. Lightsail Instance/VPS.
2. **Auth mode:** simple login (`OCT_ACTIVATE_SIMPLE_LOGIN=true`) vs. OAuth (Google etc., needs client IDs/secrets).
3. **DNS provider** for `libr.live` (Route 53 / Cloudflare / other) — needed for exact record steps.

## Blockers
- **AWS credentials NOT configured** on this machine — `aws` calls fail with
  `UnrecognizedClientException` (invalid security token). Must configure before any deploy.
- Local tooling present: Docker 29.2.1, aws-cli 2.32.23 (macOS arm64).

## Dockerfile improvement notes (for later)
- Current Dockerfile copies whole repo then `npm i` + `npm run build` — works but not optimized
  (no multi-stage, no layer caching for deps, runs as root).
- `.dockerignore` covers node_modules/dist/tsbuildinfo (good baseline).

## Next steps
1. Configure AWS credentials.
2. Confirm platform, auth mode, DNS provider (the 3 pending decisions).
3. Build & push Docker image; create Lightsail container service (or VPS).
4. Set env vars (`OCT_JWT_PRIVATE_KEY`, auth config), health check on port 8100.
5. Attach custom domain + TLS; add DNS records for `oct.dev.libr.live`.
