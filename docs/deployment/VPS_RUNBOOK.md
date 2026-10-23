# Manual deployment to a VPS (own Node server)

Task P9-12, requirement REQ-HOST-003. Written 2026-10-23 for the owner's interim hosting answer (DEC-079: deploy by hand to a VPS, our own Node server, no Oxygen for now) and the no-pipeline decision (DEC-080). The client has not confirmed the hosting (Q-003, B-06). Entry design and options: [ADR-0011](../decisions/ADR-0011-node-server-entry.md) (Proposed). Variable meanings: [DEPLOYMENT](DEPLOYMENT.md). Header details: [SECURITY_HEADERS](../security/SECURITY_HEADERS.md). Config templates: [deploy/](../../deploy/).

**Read this first.** The Node entry was built and proven **on a Windows developer machine** (section 13). **No VPS, nginx, systemd, certbot or TLS step in this document has been run by anyone.** Commands and config below are written from documentation and from how the storefront behaves locally; treat each as a draft to rehearse on a throwaway server before production (section 13 lists what is not verified). Nothing here deploys anything by itself.

**Do not point public traffic at this server yet.** Blocker B-12 (react-router below 7.18 has an open high-severity denial of service in route matching, DEC-083) is still open. The proxy limits below are an interim mitigation, not a fix. P1-12 is planned as the last functionality task before any public URL.

## 1. How it fits together

```
browser --https--> nginx (TLS, HTTP/2, gzip, limits, static files) --http, loopback--> Node 22 (scripts/node-server/server.mjs)
                                                                                          |
                                                                                          +--> dist/server/index.js (the storefront build)
                                                                                          +--> Shopify Storefront API, Extend (outbound only)
```

- nginx is the only public listener (ports 80 and 443). Node listens on `127.0.0.1:3000`.
- The storefront has no database. Shopify holds the data; the server holds code, one environment file and certificates.
- The Extend order sync is a route inside the storefront (`/webhooks/shopify`), not a separate service; nothing extra runs for it here (open interpretation of the SOW's "sync as a service", Q-003).
- Releases are folders. `current` is a symlink to the live one, `previous` to the one before it. Deploying and rolling back are "move the symlink, restart the service".

## 2. Before you start (decisions and inputs)

| Needed | Why | Who |
|---|---|---|
| A VPS with Ubuntu LTS (22.04 or 24.04 assumed), 2 GB RAM or more recommended for the build (not measured), root or sudo access | host | owner |
| A domain name and DNS A (and AAAA) record pointing at the VPS | certificate and traffic | owner / client |
| A git remote the server can read, or the habit of uploading a tarball (section 6B). **No remote exists yet (P1-06)** | getting code to the server | owner |
| The production values for the environment file, kept in the owner's password manager | section 5 | owner / client |
| B-12 decision (route to react-router 7.18 or later) | before any public URL | owner |
| Client confirmation of hosting (B-06) | REQ-HOST-002, REQ-HOST-003 wording | project-manager |

## 3. Server preparation (once)

All commands as a sudo-capable user on a fresh Ubuntu LTS. Replace `<DOMAIN>`.

1. **Updates and time.** `sudo apt update && sudo apt upgrade`, then `sudo apt install unattended-upgrades` and enable it (`sudo dpkg-reconfigure -plow unattended-upgrades`). Confirm `timedatectl` shows the clock synchronised (certificates and signed webhooks depend on a correct clock).
2. **Users.** Create two accounts:
   - `deploy`: your login for builds and releases (`sudo adduser deploy`, add your SSH public key, `sudo usermod -aG sudo deploy` if it needs sudo).
   - `mattressfitness`: runs the service, no login, no home: `sudo adduser --system --group --no-create-home --shell /usr/sbin/nologin mattressfitness`.
3. **SSH.** Keys only: in `/etc/ssh/sshd_config.d/` set `PasswordAuthentication no` and `PermitRootLogin no`, then `sudo systemctl reload ssh`. Keep your current session open until a second login works.
4. **Firewall.** `sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable`. Port 3000 stays closed to the world; the service also binds to loopback only.
5. **Node 22.** `.nvmrc` is `22` and `engines` is `^22 || ^24` (ADR-0005). System-wide install through NodeSource so systemd can use `/usr/bin/node`:
   `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -` then `sudo apt install -y nodejs`. (Check NodeSource's current instructions first; the script is third-party code that runs as root. Alternative with no third party: download the Node 22 Linux tarball from nodejs.org, verify it against the published `SHASUMS256.txt`, unpack to `/opt/node-v22.x`, and put that absolute path in the service unit.) Check `node --version` prints v22 and record it in the release notes. nvm or fnm also work for the `deploy` user's builds, but the service must be given an absolute path to a Node binary it can execute.
6. **nginx and certbot.** `sudo apt install nginx certbot`. Remove the stock site so it does not collide with our default server: `sudo rm /etc/nginx/sites-enabled/default`.
7. **Journal on disk with a ceiling** (section 10): create `/etc/systemd/journald.conf.d/mattressfitness.conf` as shown there.
8. **Directories** (section 4).

## 4. Directory layout and permissions

```
/srv/mattressfitness/            owner deploy:deploy, mode 755
  repo/                          git clone of the project (section 6A); only used for `git fetch` and `git archive`
  work/<release-id>/             a clean export of one tag, where `npm ci` and the build run; safe to delete afterwards
  releases/<release-id>/         what runs: storefront/package.json, storefront/dist/, scripts/node-server/, RELEASE.txt
  current  -> releases/<id>      symlink, the live release
  previous -> releases/<id>      symlink, the release before it (rollback target, also read by nginx for old asset files)
/etc/mattressfitness/env         owner root:root, mode 0600; the environment file (section 5); never in the repository
/var/www/certbot/                certificate challenge files, written by certbot, read by nginx
```

```
sudo mkdir -p /srv/mattressfitness/{repo,work,releases} /etc/mattressfitness /var/www/certbot
sudo chown -R deploy:deploy /srv/mattressfitness
sudo chmod 755 /srv /srv/mattressfitness
sudo chown root:root /etc/mattressfitness && sudo chmod 700 /etc/mattressfitness
```

Release files are world-readable on purpose (nginx and the service user read them). They hold the compiled bundle and no secrets: the build must run in a folder that has **no** production `.env` or secrets, and the bundle holds no store values (checked locally, ADR-0011).

**Release id:** UTC time plus the short commit, for example `20261105-141500-ab12cd3`.

## 5. Environment file

1. Create it from the template (names and placeholders only): `sudo install -m 600 -o root -g root deploy/mattressfitness.env.example /etc/mattressfitness/env` (from `/srv/mattressfitness/repo` once it is cloned, or copy the file to the server), then `sudo -e /etc/mattressfitness/env` and fill in the values from the password manager. Generate secrets on the server: `openssl rand -base64 48` (SESSION_SECRET and DELIVERY_COOKIE_SECRET must differ from each other and from any other environment).
2. Names, exposure and what happens when one is missing: [DEPLOYMENT](DEPLOYMENT.md), "Environment variables". The required four (`SESSION_SECRET`, `PUBLIC_STORE_DOMAIN`, `PUBLIC_STOREFRONT_API_TOKEN`, `PUBLIC_CHECKOUT_DOMAIN`) are checked by the server at start (it refuses to start and names the missing variable; it never prints a value). `PUBLIC_STOREFRONT_ID` is **optional**: the storefront hands it to Hydrogen's `getShopAnalytics` (`app/root.tsx`), which uses `'0'` when it is unset, so leaving it out only costs analytics sub-channel attribution; the template has it commented out (checked in the installed `@shopify/hydrogen`, 2026-10-23). Everything else fails closed inside the app; read "Production readiness: settings that fail silently or closed" there before first start.
3. Never set `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ALLOWED_STORES`, a write-capable Shopify token or `EXTEND_MOCK_*` on a server. `EXTEND_API_HOST` must not be the local mock (a production build refuses it).
4. Check without printing: `sudo stat -c '%U:%G %a' /etc/mattressfitness/env` must print `root:root 600`; `sudo grep -v '^[[:space:]]*#' /etc/mattressfitness/env | grep -c '<[A-Z_]*>'` must print `0` (a placeholder left behind on a line that is in use; commented-out template lines are ignored).
5. The file is read when the service starts. **Every change needs `sudo systemctl restart mattressfitness`**. No rebuild is needed: the bundle contains no store values.
6. `PUBLIC_*` values are sent to browsers by design; the rest never leave the server. The service user cannot read the file on disk (systemd reads it as root and hands the values to the process).
7. Backups of the values live in the owner's password manager, not in the repository, chat or e-mail. Rotate a secret by editing the file and restarting; rotating `SESSION_SECRET` signs every shopper out.

## 6. Build and release by hand

Gate evidence is local (DEC-080): before tagging, on the developer machine, run from `storefront/` in Git Bash with Node 22: `npm run check` (format, lint, types, unit tests, build) plus the end-to-end specs that apply, and record the output in `progress/TEST_RESULTS.md`. Tag the commit on `main` (`git tag -a v<x.y.z> -m "..."`; `git push` needs the owner's approval). Never deploy a feature branch to production (git-practices).

### 6A. Get the code on the server (when a remote exists)

First time, as `deploy`: `git clone <REPOSITORY_URL> /srv/mattressfitness/repo`. Use a read-only deploy key or token for a private repository, kept in `deploy`'s `~/.ssh`, never in the repository. Each release: `cd /srv/mattressfitness/repo && git fetch --tags --prune origin`.

### 6B. Get the code on the server (no remote yet)

On the developer machine, from the repository root: `git archive --format=tar.gz -o release.tar.gz <TAG> && sha256sum release.tar.gz`, copy it with `scp`, compare the checksum on the server, then unpack into `/srv/mattressfitness/work/<release-id>/` and continue at "Build".

### Build and assemble (as `deploy`)

With a tarball (6B) there is no `repo/` folder: set `REL` by hand (for example `REL=$(date -u +%Y%m%d-%H%M%S)-<short-commit>`), unpack into `$W` instead of running `git archive`, and fill `RELEASE.txt` with the tag and commit you were given.

```
TAG=<release-tag>
cd /srv/mattressfitness/repo
SHA=$(git rev-parse --short "$TAG^{commit}")
REL=$(date -u +%Y%m%d-%H%M%S)-$SHA
W=/srv/mattressfitness/work/$REL
R=/srv/mattressfitness/releases/$REL
mkdir -p "$W" && git archive --format=tar "$TAG" | tar -x -C "$W"

cd "$W/storefront"
npm ci                      # installs exactly from package-lock.json
npm run build               # shopify hydrogen build --codegen; writes dist/server and dist/client

# Assemble the release: the runtime needs Node, the build output and the adapter. No node_modules.
mkdir -p "$R/storefront" "$R/scripts"
cp package.json "$R/storefront/"        # makes Node treat dist/server/index.js as an ES module
cp -r dist "$R/storefront/dist"
cp -r ../scripts/node-server "$R/scripts/node-server"
rm -f "$R"/scripts/node-server/*.test.mjs
find "$R" -name '*.map' -delete        # MANDATORY: source maps are not published (checked below)
printf 'tag=%s\ncommit=%s\nbuilt=%s\nnode=%s\n' "$TAG" "$(git -C /srv/mattressfitness/repo rev-parse "$TAG^{commit}")" "$(date -u +%FT%TZ)" "$(node --version)" > "$R/RELEASE.txt"
chmod -R a+rX "$R"

# MANDATORY checks before the candidate run; stop unless both print "ok".
test -z "$(find "$R" -name '*.map' -print -quit)" && echo "ok: no source maps in the release" || echo "FAIL: source maps present"
test -f "$R/storefront/dist/server/index.js" && test -d "$R/storefront/dist/client/assets" && echo "ok: build output present" || echo "FAIL: build output missing"
```

Why the source-map step is mandatory: nginx's `/assets/` and `/brand/` locations use `^~`, which makes nginx skip every regex location, so a regex guard for `.map` files would never run there. The template therefore refuses any `*.map` path with a server-level `if` (it runs before location matching), and the Node server's static handler does not serve maps either; deleting them at assembly is the first line and the check above proves it. None are built into `dist/client` today, so the check is expected to pass without anything being deleted.

Local proof that this layout runs: a copy of `dist/`, `storefront/package.json` and `scripts/node-server/` without `node_modules` served the same pages (ADR-0011). On Linux it is unproven. If `npm ci` or the build fails on the server (memory, registry access, an unexpected download by the Shopify CLI), stop: the previous release keeps running. Setting `SHOPIFY_CLI_NO_ANALYTICS=1` for the build is advisable if usage reporting is unwanted (not verified).

### Check the candidate before it goes live (port 3001)

```
sudo systemd-run --unit=mf-candidate --uid=mattressfitness --gid=mattressfitness \
  -p EnvironmentFile=/etc/mattressfitness/env -p WorkingDirectory="$R" \
  -E NODE_ENV=production -E PORT=3001 -E BIND_HOST=127.0.0.1 -E TRUST_PROXY=true \
  /usr/bin/node scripts/node-server/server.mjs
sleep 3
curl -fsS http://127.0.0.1:3001/healthz
curl -fsS -o /dev/null -w '%{http_code}\n' -H 'Host: <DOMAIN>' -H 'X-Forwarded-Proto: https' http://127.0.0.1:3001/
sudo journalctl -u mf-candidate --no-pager | tail -20      # look for node_server.listening; no error lines
sudo systemctl stop mf-candidate
```

The candidate run does **not** carry the service unit's sandbox options (`SystemCallFilter`, `ProtectProc` and the rest), so it proves the release and the environment, not the unit. The unit's sandbox is first exercised when the real service starts (section 7).

(The `systemd-run` flags and the precedence of `-E` over the environment file are unverified; the file must not set `PORT`, as the template does not.) `/healthz` returns `{"status":"ok"}` only to say the process is up and the build loaded; it does not test Shopify.

### Switch and restart

```
cd /srv/mattressfitness
[ -L current ] && [ "$(readlink -f current)" != "$R" ] && ln -sfn "$(readlink -f current)" previous
ln -sfn "$R" current.tmp && mv -Tf current.tmp current        # atomic swap of the symlink
sudo systemctl restart mattressfitness
sleep 3
systemctl is-active mattressfitness
curl -fsS http://127.0.0.1:3000/healthz
```

A restart refuses connections for a short time (not measured); nginx answers 503 meanwhile. Zero downtime would need two instances behind nginx (not built). Then run the smoke test (section 12). Record in `progress/DECISIONS.md` who deployed which commit and when (release approval is in the project plan; this runbook does not replace it).

Retention: keep the last five folders in `releases/` and delete older ones by hand after listing them (`ls -1dt /srv/mattressfitness/releases/*`). Never delete what `current` or `previous` points to. `work/` can be emptied after each release.

## 7. Process manager (systemd)

Template: [deploy/mattressfitness.service.example](../../deploy/mattressfitness.service.example). Install with `sudo cp` to `/etc/systemd/system/mattressfitness.service`, fill the `<MEMORY_CEILING>` placeholder, then `sudo systemctl daemon-reload && sudo systemctl enable --now mattressfitness`.

What it does: runs as the `mattressfitness` user from `/srv/mattressfitness/current`; restarts after a crash (`Restart=on-failure`) and after a reboot (`enable`); gives up after five failed starts in a minute (`systemctl reset-failed mattressfitness` to try again); stops gracefully on SIGTERM (finishes in-flight requests and background work, up to 10 s); read-only file system and no extra privileges; stdout and stderr go to the journal. Useful commands: `systemctl status mattressfitness`, `journalctl -u mattressfitness -f`, `sudo systemctl restart mattressfitness`.

Host settings (set in the unit): `PORT` (3000), `BIND_HOST` (127.0.0.1), `TRUST_PROXY` (see below), `MAX_BODY_BYTES` (1 MiB), `SHUTDOWN_TIMEOUT_MS`, `CACHE_MAX_ENTRIES` (default 500), `CACHE_MAX_BYTES` (64 MiB, set in the unit). Meaning: `scripts/node-server/config.mjs`. All are validated at start; a bad value makes the server refuse to start and name the setting (never the value).

**`TRUST_PROXY` must be `true` behind nginx.** nginx ends TLS, so Node sees plain http. With `TRUST_PROXY=false` the adapter ignores `X-Forwarded-Proto`, the request URL says `http:`, and the session and cart cookies (`app/lib/session.ts` keys `Secure` on `request.url`) would be issued **without** the `Secure` flag, and HSTS would follow the wrong scheme. So: `true` for any deployment behind TLS termination; `false` only when Node itself is the TLS endpoint or on a developer machine. `true` is safe only when nothing but the proxy can reach the port, so the server **refuses to start** with `TRUST_PROXY=true` and a `BIND_HOST` that is not loopback (`127.0.0.0/8`, `::1`). Running nginx on another machine or in another container needs a different design (for example a private network plus a firewall rule) and a recorded decision in ADR-0011; the refusal is deliberate, not a bug. `BIND_HOST` must be a literal IP address (Node's own parser decides; `999.999.999.999`, `localhost` and host names are refused).

**Memory.** The in-process cache is bounded in entries (`CACHE_MAX_ENTRIES`) and in bytes (`CACHE_MAX_BYTES`: an estimate of body plus header text plus key, **per named cache**; two are opened today, the Hydrogen query cache and the webhook replay marks, so the worst case is 2 x 64 MiB). The oldest write is evicted first; an entry bigger than one eighth of the byte limit is not stored (and the old copy under that key is dropped); expired entries are swept on every write that falls after the 60-second interval and by a timer that does not keep the process alive. The unit's `MemoryMax=1G` is an **example for a 2 GB VPS, not a measurement**.

**Before the first start (checklist; record the answers in the release notes):**

1. `MemoryMax` in `/etc/systemd/system/mattressfitness.service` was read and set for this VPS's RAM (leave room for nginx and the OS), and `CACHE_MAX_BYTES` times two plus Node's baseline fits well under it. Tune from `systemctl status mattressfitness` and `free -h` after a week of real traffic.
2. `sudo systemd-analyze verify /etc/systemd/system/mattressfitness.service` printed no complaint (**not run by the author**; this is the first check).
3. After `enable --now`: `systemctl is-active mattressfitness` prints `active`, and `journalctl -u mattressfitness` shows `node_server.listening` and no `SIGSYS`, `EPERM` or `Operation not permitted`. The sandbox options in the template (`SystemCallFilter=@system-service` with `SystemCallErrorNumber=EPERM`, `ProtectProc=invisible`, `ProtectKernelLogs`, `ProtectClock`, `ProtectHostname`, `RestrictRealtime`, `UMask=0077`) are reasoned to be compatible with Node but are **untested**; if one breaks the start, remove it, note which, and keep the rest. `MemoryDenyWriteExecute` is deliberately absent: V8 needs writable and executable memory.

**Rejections and exceptions (decision).** The entry logs an `unhandledRejection` as `node_server.unhandled_rejection` (error name only) and keeps serving. Node's default would end the process and drop every shopper's in-flight request over one stray promise; the storefront guards its own background work, so a rejection that reaches the top is a bug to find, not a reason to restart. Treat any `node_server.unhandled_rejection` line as an alert candidate (section 9). An uncaught exception is **not** caught: the process exits and `Restart=on-failure` brings it back. Accepted trade-off: after a swallowed rejection the process may hold half-finished state until the next restart.

## 8. Reverse proxy and TLS (nginx, certbot)

Templates: [deploy/nginx.conf.example](../../deploy/nginx.conf.example) and [deploy/nginx-security-headers.conf.example](../../deploy/nginx-security-headers.conf.example). Nothing here has been run; **`sudo nginx -t` before every reload** is the first check.

**First install, in this order** (the certificate must exist before nginx can load the HTTPS block):

1. DNS for `<DOMAIN>` points at the VPS.
2. Install the headers snippet: `sudo cp deploy/nginx-security-headers.conf.example /etc/nginx/snippets/mattressfitness-security-headers.conf`.
3. Prepare the site file without the HTTPS block and with your domain: `sed -e '/# BEGIN HTTPS BLOCK/,/# END HTTPS BLOCK/d' -e 's/<YOUR_DOMAIN>/<DOMAIN>/g' deploy/nginx.conf.example | sudo tee /etc/nginx/sites-available/mattressfitness >/dev/null`, then `sudo ln -s /etc/nginx/sites-available/mattressfitness /etc/nginx/sites-enabled/`, `sudo nginx -t && sudo systemctl reload nginx`.
4. Get the certificate: `sudo certbot certonly --webroot -w /var/www/certbot -d <DOMAIN> --email <EMAIL> --agree-tos --deploy-hook 'systemctl reload nginx'`.
5. Install the full file: `sed 's/<YOUR_DOMAIN>/<DOMAIN>/g' deploy/nginx.conf.example | sudo tee /etc/nginx/sites-available/mattressfitness >/dev/null`, `sudo nginx -t && sudo systemctl reload nginx`.
6. Renewal: the packaged `certbot.timer` renews. Prove it works: `sudo certbot renew --dry-run` and `systemctl list-timers | grep certbot`. Add certificate expiry to monitoring (section 9); renewal that fails silently is the usual outage.

**What the config does** (each line is a decision to review, with starting numbers that are guesses):

| Control | In the template | Notes |
|---|---|---|
| TLS | TLS 1.2 and 1.3, session cache, no tickets, http redirected to https (301) | No OCSP stapling and no custom cipher list; nginx defaults. Test with an external TLS checker after step 5 |
| HTTP/2 | `listen 443 ssl http2` | works on nginx 1.18 and newer; newer versions warn that the form is deprecated |
| Compression | gzip for text, CSS, JS, JSON, SVG and `text/x-script` | `text/x-script` is the content type React Router sets on its `.data` (single-fetch) responses, confirmed in the installed react-router source; brotli lines are commented out (needs an extra nginx module, not verified) |
| Static assets | `/assets/` and `/brand/` straight from `current/.../dist/client`; `/assets/` immutable for a year, `/brand/` one hour; falls back to `previous` so a page loaded before a deploy keeps its lazy chunks | The Node server also serves these files, so it works without nginx. The long `Cache-Control` lines have **no `always`**, so only successful answers carry them and a 404 for a missing chunk is not cached for a year (the security headers keep `always`) |
| Source maps | any `*.map` path answers 404 (server-level `if`, ahead of location matching); release assembly deletes and checks for them | a regex `location` would not run under the `^~` asset prefixes |
| Probe paths | `/favicon.ico`, `/apple-touch-icon*.png`, `/.env*`, `/.git*`, `/wp-*`, `/wordpress/*`, `/phpmyadmin*`, `/cgi-bin/*`, and `*.php`, `*.asp`, `*.aspx`, `*.jsp`, `*.cgi`, `*.sql`, `*.bak`, `*.old`, `*.swp` answer 404 from nginx itself | so scanners do not cause a server render and a Storefront lookup; no rate-limit zone applies. Remove the favicon part when a favicon is added to `storefront/public`. Untested: syntax checked by eye only |
| Request-body limit | `client_max_body_size 1m`, Node cap `MAX_BODY_BYTES` equal | B-19 |
| Time limits | header and body read 15 s, keep-alive 30 s, upstream 5 s connect and 60 s read | slow-client protection |
| Connection limit | 30 per client address | HTTP/2 multiplexes, so this is generous |
| Rate limits (B-19) | see the next table | starting values, per client IP, status 429 with `Retry-After` |
| Host filtering | port 80 and 443 answer only `<DOMAIN>`; other names get no response (444) | |
| Proxy headers | `Host`, `X-Forwarded-Proto` (overwritten with `$scheme`), `X-Forwarded-For` (overwritten), `Forwarded` removed | the Node adapter believes `X-Forwarded-Proto` (first value only) **only when `TRUST_PROXY=true`**; the application's own header code (`app/lib/security-headers.ts`) reads the header regardless of that setting, so a client that reached the app directly could earn an HSTS header on its own plain-http answer (browsers ignore it). `TRUST_PROXY` must be `true` behind nginx (section 7) |
| Page caching | none (`proxy_cache` is not used) | The home document is `private, no-cache` with `Vary: Cookie`; the delivery ZIP changes it per shopper (DEC-036) |
| Access log | one line per request without query string or cookies, rotated by the packaged logrotate | `$uri` instead of `$request` keeps search text out (T-05) |
| `/healthz` | loopback only | external monitors use `/` |

### B-19 controls and where they live

| B-19 item | Where | Template zone | Test (section 12) |
|---|---|---|---|
| Extend offers route `/api/extend/offers` (E-M2) | nginx, stricter than the app's own 60 variants a minute per process | `mf_offers` 2 r/s, burst 20 (plus `mf_api`) | repeated requests return 429 |
| `/delivery` (P-L5) | nginx | `mf_delivery` 2 r/s, burst 10 | same |
| Cart-creating GET routes `/cart/<lines>` and `/discount/<code>` (P-L5) | nginx | `mf_cartget` 1 r/s, burst 5 | same |
| Cart actions: `POST /cart` and `POST /cart.data` (add, update, remove, the product-page add-on add) (A-L1) | nginx. One add costs several Storefront calls and, without a cart cookie, creates a Shopify cart. `GET /cart` (the page view) is not in this zone, only in the general one | `mf_cartpost` 3 r/s, burst 10, keyed by method plus path (plus `mf_general`) | step 10: rapid POSTs return 429 |
| Any other `/api/*` route (includes `/api/product-addons`) | nginx | `mf_api` 5 r/s, burst 20 | same |
| Shared guest-lookup limiter (P6-14, R-27) | not built; a commented zone and map exist for its path. The in-app limiter can be a single-process memory store on one VPS (decision for security-engineer) | `mf_lookup` (commented out) | when the route exists |
| `/webhooks/shopify` | nginx | `mf_webhook` 10 r/s, burst 30; Shopify's sender addresses are not a fixed list, so there is no IP allow-list; the HMAC check is in the app | send a bad-signature POST: 401 or 503, not 200 |
| Request-body limit | nginx and Node | 1 MiB | oversized POST returns 413 |
| TLS, HSTS ramp | nginx | HSTS `max-age=15552000`, no `includeSubDomains`, no `preload` (SECURITY_HEADERS) | headers on https responses |
| Security headers on every response, including redirects and error pages | app for everything it produces; nginx snippet for what nginx produces (static files, 413, 429, 503) | `mattressfitness-security-headers.conf` | section 12 duplicate-header check |
| Two-cookie shared-cache leak test | not applicable while no cache sits in front; repeat if one is added | n/a | |
| Behind a CDN later | take the client address from the CDN's header (`ngx_http_realip_module`) or every visitor shares one rate-limit key | n/a | |

**Every rate and burst number in this table is a starting guess**, not measured against real shopper behaviour or a load test. They protect the Shopify Storefront quota and keep one address from creating carts at will; they are not a defence against a distributed attack. After launch, read the nginx error log for `limiting requests` lines (`limit_req_log_level warn`), look for real shoppers being refused (for example a fast run of quantity-stepper clicks against the 3 r/s cart-action zone, or shoppers behind one shared office or carrier address), and tune. Raise a number rather than removing a zone.

**Responses under `/api/*` must not be cached by nginx or any CDN.** `/api/product-addons` answers per product from Shopify's current price and stock; the app marks the 200 answer `private, max-age=60` (browser only) and failures `private, no-store`. The template has no `proxy_cache`; if one is ever added, exclude `/api/` and `POST` requests, and repeat the check in smoke test step 10.

Paths in the rate-limit maps are matched case-insensitively and with the optional `.data` suffix because the router ignores case and uses `.data` URLs for client navigations. Re-check the list when routes change (`storefront/app/routes/`); a new route that creates carts, calls Shopify or accepts input needs a zone.

Still open from B-19 after this document: promote the report-only Content-Security-Policy after a clean report period on this host; HSTS ramp; N-L2 (the app's global limiter fails open); the privacy policy wording about the delivery ZIP (T-16).

## 9. Health check and monitoring

- Process: `systemctl is-active mattressfitness` and `curl -fsS http://127.0.0.1:3000/healthz`.
- Site: an external uptime check on `https://<DOMAIN>/` expecting 200 (and `/robots.txt`), with alerts to the owner. A service choice and its data handling are the owner's decision; none is configured.
- Certificate: alert at 21 days before expiry.
- Disk, memory and restarts: check `systemctl status` and `free -h` after each release for the first week; set the unit's `MemoryMax` from what you see.
- Log events and alert candidates: [RUNBOOKS](../handover/RUNBOOKS.md) section 11. Nothing is wired to a tool. In the journal, search for `config.secret_unusable`, `offers.config_problem`, `webhook.rejected`, `request.unhandled`, `render.failed`, `node_server.unhandled_rejection` (the entry swallows these on purpose, section 7, so this line is the only signal) and other `node_server.` events.

## 10. Logs and rotation

- Node writes one JSON line per event (redacted, closed vocabulary) to the journal. Cap it: create `/etc/systemd/journald.conf.d/mattressfitness.conf` with `[Journal]`, `Storage=persistent`, `SystemMaxUse=500M`, `MaxRetentionSec=30day`, then `sudo mkdir -p /var/log/journal && sudo systemctl restart systemd-journald`. Read: `sudo journalctl -u mattressfitness --since '1 hour ago'`.
- nginx logs in `/var/log/nginx/mattressfitness*.log` are covered by the packaged logrotate rule for `/var/log/nginx/*.log` (weekly, 14 kept on Ubuntu; check `/etc/logrotate.d/nginx`). They hold client IP addresses, so keep retention short and mention it in the privacy policy.
- No customer data, tokens or full payloads are logged by the storefront (T-05). Never `cat` the environment file into a ticket.

## 11. Rollback

Triggers (final wording belongs to the Phase 9 runbook): checkout hand-off failing, order sync failing beyond a set time, error rate spike, a security issue, the smoke test failing.

```
cd /srv/mattressfitness
LIVE=$(readlink -f current); PREV=$(readlink -f previous)
echo "rolling back $LIVE -> $PREV"
ln -sfn "$PREV" current.tmp && mv -Tf current.tmp current
ln -sfn "$LIVE" previous                       # so the rollback itself can be undone
sudo systemctl restart mattressfitness
sleep 3 && curl -fsS http://127.0.0.1:3000/healthz
```

Then the smoke test. Config-only rollbacks (no symlink change, edit the environment file and restart the service): `PUBLIC_EXTEND_ENABLED=false`, `OFFERS_ENABLED=false` (only on purpose: it removes all offers), clear `PUBLIC_GIFT_PICKER_ENABLED`, or deactivate a discount in Shopify admin (DEPLOYMENT, "Release and rollback").

**Not rehearsed.** Rehearse on a throwaway VPS before the first production release: deploy release A, deploy release B, roll back to A, roll forward again, and write down how long each restart took and what shoppers see (nginx 503 page) meanwhile. A rollback is not proven until this has been done.

Data: nothing to restore; Shopify holds orders, carts and customers.

## 12. Smoke test (read-only; after every deploy and rollback)

Run from your own machine against the public name. None of these places an order. Expected results in brackets.

1. `curl -sI http://<DOMAIN>/` [301 to https]
2. `curl -sI --http2 https://<DOMAIN>/ | head -1` [`HTTP/2 200`]
3. `curl -sI -H 'Accept-Encoding: gzip' https://<DOMAIN>/ | grep -i content-encoding` [gzip]
4. Headers pass through once: `curl -sI https://<DOMAIN>/ | cut -d: -f1 | tr 'A-Z' 'a-z' | sort | uniq -d` [prints nothing: no header appears twice]. Then compare the security headers with [SECURITY_HEADERS](../security/SECURITY_HEADERS.md): `strict-transport-security`, `content-security-policy`, `content-security-policy-report-only`, `x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy`, `cross-origin-opener-policy`. Repeat for a static asset (`/assets/<a real file>`), a 404 (`/no-such-page`), and the redirect in step 1 (only nosniff-type headers matter on http).
5. Caching of the document: `curl -sI https://<DOMAIN>/ | grep -iE 'cache-control|vary'` [`private, no-cache` and `Vary: Cookie`]
6. Pages: `/`, a collection, a product, `/cart`, `/search?q=bed`, `/stores`, `/quiz`, `/compare` [200 each]; `/robots.txt` [200]; with `PUBLIC_SITE_URL` set, `/sitemap.xml` [200]
7. Cookies: add an item (`/cart/<variant-id>:1`) in a browser or with `curl -sI` [302; the `cart` cookie has `Secure; HttpOnly; SameSite=Lax`]
8. Checkout hand-off: the cart's checkout link goes to the store's checkout domain (do not pay)
9. Webhook rejects unsigned calls: `curl -s -o /dev/null -w '%{http_code}\n' -X POST -d '{}' https://<DOMAIN>/webhooks/shopify` [not 200: 401 with the secret set, 503 without]
10. Limits: `head -c 2000000 /dev/zero | curl -s -o /dev/null -w '%{http_code}\n' -X POST --data-binary @- https://<DOMAIN>/cart` [413]; `for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/delivery; done | sort | uniq -c` [some 429; wait a minute before further tests]. Cart-action limit with no side effects (A-L1): `for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Origin: https://cross-site.invalid' -d 'x=1' https://<DOMAIN>/cart; done | sort | uniq -c` [about 11 to 14 answers of 403 (the app refuses the foreign Origin before it reads the body or calls Shopify, so no cart is created and no Storefront quota is spent), the rest 429; the exact split depends on timing]. Confirm `GET /cart` is not limited by that zone: a single `curl -s -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/cart` straight after [200]. Wait a minute before further tests. Describe-only for production until the owner authorises running it there (it sends 30 requests from one address; run it from a machine whose address you can afford to have limited for a minute). Private API answers: `curl -sI 'https://<DOMAIN>/api/product-addons?productId=x'` [400 with `cache-control: private, no-store`, no `x-cache` or `age` header; this call makes no Shopify request]. With a real product GID from the store, the 200 answer should show `cache-control: private, max-age=60` and, on repeat, no `age` header.
11. Logs: `sudo journalctl -u mattressfitness --since '10 min ago'` shows `node_server.listening` and none of `config.secret_unusable`, `offers.config_problem`, `request.unhandled`, `render.failed`
12. Delivery ZIP and offers behave as on a development store (needs the real environment; do the client's ZIP and offer checks from the acceptance plan)
13. Customer account sign-in, the Extend flows and webhook-driven sync are not covered by these steps; verify each when its prerequisites exist (P6-07, Q-005, V-20)

## 13. What is NOT done and NOT verified

Verified locally (2026-10-23, Windows, Node 22.23.3, [ADR-0011](../decisions/ADR-0011-node-server-entry.md) section "Verification"): the Node adapter's tests pass (42 after the review round: settings validation, the loopback rule for `TRUST_PROXY`, the cache byte and sweep bounds); the built storefront served the pages listed there on a plain Node server against `bedding.mock.shop` with placeholder values; a release folder without `node_modules` also worked.

**Assumed, not verified (everything below is a draft until rehearsed):**

- Every step on Ubuntu: user creation, firewall, NodeSource, apt packages, directory permissions, `npm ci` and `npm run build` on Linux (memory, registry access, anything the Shopify CLI downloads).
- The systemd unit: it has not been loaded (`systemd-analyze verify` not run), the sandbox options (`ProtectSystem=strict`, `RestrictAddressFamilies`, `SystemCallFilter=@system-service` with `SystemCallErrorNumber=EPERM`, `ProtectProc=invisible`, `ProtectKernelLogs`, `ProtectClock`, `ProtectHostname`, `RestrictRealtime`, `UMask=0077`; reasoned to suit Node and V8, never run) may need adjusting, `MemoryMax=1G` is an unmeasured example, the cache byte bound (`CACHE_MAX_BYTES`) is unit-tested but its memory effect over days is not measured, `EnvironmentFile` parsing of the one-line `OFFER_CONFIG_JSON` in single quotes, SIGTERM graceful stop and restart behaviour.
- The nginx config: `nginx -t` not run, the map/limit logic, `try_files` fallback to `previous`, named-location error pages with headers, `if ($host ...)`, HTTP/2, gzip. No load test; every rate and limit number is a guess. The `mf_cartpost` zone (A-L1) and its `$request_method$uri` map were added 2026-10-23 and were not run through `nginx -t` (no nginx on the author's machine; the Docker daemon was not running); the review-round changes of the same day (no `always` on the long cache lines, the server-level `.map` `if`, the probe-path regex location, `text/x-script` in `gzip_types`) were not run through `nginx -t` either; neither the 429 split in smoke test step 10 nor the `.data` POST path shape of the router's client submissions has been observed.
- certbot issuance, renewal and the reload hook; DNS; the firewall rules.
- Responses the Node adapter makes itself (400, 413, adapter-level 500, `/healthz`) carry the five request-independent security headers but no HSTS; the storefront's own responses carry the full set.
- Security headers behind the real proxy (SECURITY_HEADERS "Known gaps": behaviour behind a real proxy and on a production build on a real host); duplicate-header check; the promotion of the report-only Content-Security-Policy.
- Streaming pages through nginx buffering and gzip; behaviour with slow clients; memory growth over days; restart gap length; any benefit of brotli.
- The customer account sign-in (P6-07), the checkout hand-off with the real checkout domain, a signed Shopify webhook and the Extend sync with real credentials (V-20, Q-005), the delivery ZIP save through the proxy, `OFFER_CONFIG_JSON` on the real store.
- Rollback and restore rehearsal; log retention settings; monitoring and alerts (none wired); backup of `/etc/mattressfitness/env` and `/etc/letsencrypt` (see below).
- The rate limits for the future guest lookup (route not built), the `.data` URL shapes of every route (only the listed ones were reasoned from the route files, not captured from a browser).

**Not in this document:** DNS cutover and TTL plan (P9-03, P9-04), the production approval record, launch-day support, the client's server hardening or ownership model (EXC-13), pixel baselines and WebKit or Firefox runs without CI (CR-17), a staging server (none exists; a second small VPS or a second hostname on this one would serve), and upgrading to Hydrogen 2026.10 (P1-12), after which re-run the proof in ADR-0011.

**Backups.** The server holds no business data. To rebuild it: this repository (tagged releases), the filled environment file (from the password manager), the nginx and systemd files (from `deploy/`), and a new certificate (certbot reissues; or back up `/etc/letsencrypt` for speed). Keep an encrypted copy of the environment file's values outside the server; OS patching and VPS snapshots are the owner's (or a maintenance agreement's) job.

## 14. Changing host later

Host-specific here: sections 3 to 11 (server preparation, systemd, nginx, certbot, symlink releases). Host-agnostic: the storefront code, the environment variable names and meanings, the smoke test (section 12), the B-19 control list (move each control to the new host's equivalent), and the adapter (`scripts/node-server/`, reusable on any Node host or container). Oxygen would replace sections 3 to 11 with `shopify hydrogen deploy` and Oxygen's own environment variables and limits; those items stay deferred (DEC-079).

## 15. Files

| File | Purpose |
|---|---|
| [scripts/node-server/](../../scripts/node-server/) | the Node entry and its tests (`node --test "scripts/node-server/*.test.mjs"`) |
| `storefront/package.json` script `start:node` | local run: `npm run start:node` after `npm run build` (needs the variables in the environment, for example `node --env-file=<file> ../scripts/node-server/server.mjs`) |
| [deploy/mattressfitness.service.example](../../deploy/mattressfitness.service.example) | systemd unit |
| [deploy/mattressfitness.env.example](../../deploy/mattressfitness.env.example) | environment file template (names and placeholders) |
| [deploy/nginx.conf.example](../../deploy/nginx.conf.example) | nginx site |
| [deploy/nginx-security-headers.conf.example](../../deploy/nginx-security-headers.conf.example) | headers for nginx-made responses |
