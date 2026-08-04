# Monhorus deployment - Ubuntu server

Status: written against the tree at commit `2e17308`. Ports are deliberately unresolved.
Last updated: 2026-08-04

What a fresh Ubuntu host needs in order to run this system: one Node process (the
backend), one static directory served by nginx (the web admin), and one MongoDB. The two
Flutter apps are **not** deployed here — they are built elsewhere and merely point at this
host, which is what section 12 is about.

Every fact below was read out of this repository. Where something could not be settled
from the source it is recorded in section 16 as an open question rather than guessed.

---

## 1. Ports

**Nothing in this document hardcodes a production port.** Every port appears as a
placeholder, and this table is the only place to resolve them. Choose the values, then
substitute them once here and copy them into the two config files that use them
(`/etc/monhorus/backend.env` and the nginx server block).

| Placeholder | What listens on it | Bind to | Chosen value |
|---|---|---|---|
| `<API_PORT>` | The backend Express process. Becomes `PORT` in the backend environment. | `127.0.0.1` — nginx is the only client | |
| `<WEB_HTTP_PORT>` | nginx, plaintext. Serves the web `dist/` and redirects to TLS. | public | |
| `<WEB_HTTPS_PORT>` | nginx, TLS. The origin the browsers and both mobile apps talk to. | public | |
| `<MONGO_PORT>` | `mongod`. Becomes part of `MONGODB_URI`. | `127.0.0.1` — never public | |

**What the ports are today, in development.** These are the values the repository is
wired for right now. They are stated so the substitution is a conscious act, not so they
are copied into production.

| Concern | Development value | Where it comes from |
|---|---|---|
| Backend HTTP | `4000` | `apps/backend/src/config/env.ts:10` (`PORT` default), `apps/backend/.env.example` |
| Web dev server | `5173` | `apps/web/vite.config.ts` (`server.port`). **This port does not exist in production** — Vite's dev server is not deployed; nginx serves the built `dist/` instead |
| MongoDB | `27017` | `MONGODB_URI=mongodb://127.0.0.1:27017/monhorus` in `apps/backend/.env.example` |
| Android emulator origin | `http://10.0.2.2:4000` | `apps/mobile/lib/core/config/app_config.dart:27` |

Two consequences of the table above worth stating before anything is installed:

- `<API_PORT>` never needs to be reachable from outside the host. The backend serves no
  static assets and nginx proxies everything, so binding it to loopback removes it from
  the internet entirely. See section 9.
- Changing `<WEB_HTTPS_PORT>` after the fact means **rebuilding the web bundle and both
  mobile apps**, because the API origin is compiled into all three. See sections 10 and 12.

---

## 2. Host prerequisites

Ubuntu 22.04 LTS or 24.04 LTS. Everything below assumes `sudo`.

| Component | Constraint | Source of the constraint |
|---|---|---|
| Node.js | `>=20.11.0` | `package.json` `engines.node` |
| npm | 10.9.4 is what the lockfile was produced with | `package.json` `packageManager` |
| MongoDB | 4.4 minimum; 7.0 or 8.0 recommended. **Must be a replica set, not a standalone** | mongoose `^8.9.2`, resolved to `8.24.1` in `package-lock.json`; `common/utils/transaction.util.ts` — see section 4.1 |
| nginx | any current release | |
| certbot | for TLS. Not optional; see section 11 | |

There is **no `.nvmrc` and no CI workflow in this repository**, so `engines.node` is the
only version statement that exists. Node 22 LTS satisfies it and is the safer choice on
24.04.

```bash
sudo apt update
sudo apt install -y curl gnupg git nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # must satisfy >=20.11.0
```

`bcrypt` (`^5.1.1`) is a native module. NodeSource builds normally resolve a prebuilt
binary; if `npm ci` falls back to compiling it, `sudo apt install -y build-essential
python3` first.

---

## 3. Repository layout and build order

npm workspaces, declared in the root `package.json`:

```
apps/backend        @monhorus/backend   Express + mongoose. Deployed.
apps/web            @monhorus/web       Vite + React SPA. Built to static files, deployed.
packages/*          @monhorus/shared    Zod schemas, permission catalogue, constants.
apps/mobile         (not a workspace)   Flutter, customer. Not deployed here.
apps/mobile-employee(not a workspace)   Flutter, technician. Not deployed here.
```

The two Flutter apps are outside the `workspaces` array, so `npm ci` at the root does not
touch them and no Flutter toolchain is needed on the server.

**`packages/shared` is consumed from `dist/`, not from source, so the build order is not
optional.** Its `package.json` points `main` at `./dist/cjs/index.js`, `module` at
`./dist/esm/index.js` and `types` at `./dist/cjs/index.d.ts`, and `dist/` is gitignored.
A checkout therefore contains no `@monhorus/shared` build at all: both dependants import a
directory that does not yet exist. The order is

```
packages/shared  →  apps/backend  and  apps/web
```

`turbo.json` already encodes it — `build.dependsOn: ["^build"]`, so `npm run build` at the
root is correct and sufficient. Building a workspace directly (`npm run build --workspace
@monhorus/backend`) bypasses turbo and will fail against a clean checkout.

`apps/web`'s build is `tsc --noEmit && vite build`, so it also needs
`packages/shared/dist/cjs/index.d.ts` to exist before it starts. The backend's build is
`tsc -p tsconfig.build.json`, which excludes `*.test.ts`/`*.spec.ts` and emits to
`apps/backend/dist/`. The entry point is `dist/server.js`, run by `npm start` as
`node dist/server.js`.

**Do not prune dev dependencies before building.** `packages/shared` compiles with its own
`typescript` devDependency; removing it removes the ability to produce the artefact both
other packages import.

### Deploy the source, build on the host

```bash
sudo mkdir -p /srv/monhorus
sudo chown "$USER":"$USER" /srv/monhorus
git clone <REPO_URL> /srv/monhorus
cd /srv/monhorus
npm ci
npm run build          # shared → backend + web, in that order
```

`npm run build` produces exactly three artefacts:

| Artefact | Path |
|---|---|
| Shared library | `packages/shared/dist/{cjs,esm}/` |
| Backend | `apps/backend/dist/`, entry `dist/server.js` |
| Web bundle | `apps/web/dist/` (`outDir: 'dist'`, `sourcemap: true` — `apps/web/vite.config.ts`) |

---

## 4. MongoDB

The installed mongoose is `8.24.1` against node driver `mongodb` `6.20.0`
(`package-lock.json`). Mongoose 8 supports MongoDB server 4.4 and above, so 4.4 is the
floor; 7.0 or 8.0 is what a new install should be given.

**The topology is not free, though. This application uses multi-document transactions, so
production must be a replica set — see 4.1 before installing.**

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
  | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
```

Replace `noble` with `jammy` on 22.04.

### 4.1 A standalone `mongod` is not enough

`apps/backend/src/common/utils/transaction.util.ts` wraps multi-document work in a real
MongoDB transaction. Two call sites use it today — planned-work state transitions
(`planned-work.transition.service.ts:184`) and planned-work report approval
(`planned-work.report.service.ts:586`) — and both write several collections that must move
together.

Transactions require a replica set or a sharded cluster. A standalone `mongod` cannot start
one. The helper handles that gracefully rather than failing: it probes the topology once
with `hello`, and where `setName` is absent and `msg` is not `isdbgrid` it **runs the same
callback with no session and logs a warning** (`transaction.util.ts:36-66`):

```
MongoDB deployment does not support transactions; falling back to sequential writes.
Use a replica set in production so multi-document operations stay atomic.
```

**Nothing visibly breaks, which is precisely the danger.** What is lost is atomicity: a
crash or an error partway through an approval leaves some of its writes applied and the
rest not, with no rollback. The code's own comment says a replica set is what production is
expected to provide.

A single-node replica set is enough and costs nothing operationally. Add `replication` to
`/etc/mongod.conf` alongside the network and security settings:

```yaml
net:
  port: <MONGO_PORT>
  bindIp: 127.0.0.1
security:
  authorization: enabled
replication:
  replSetName: rs0
```

With `authorization: enabled` the members must also authenticate to each other, which for a
single node means a keyfile:

```bash
sudo openssl rand -base64 756 | sudo tee /etc/mongod.key > /dev/null
sudo chown mongodb:mongodb /etc/mongod.key
sudo chmod 400 /etc/mongod.key
```

```yaml
security:
  authorization: enabled
  keyFile: /etc/mongod.key
```

Initiate the set once, after restarting `mongod`:

```bash
sudo systemctl restart mongod
mongosh --port <MONGO_PORT> --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:<MONGO_PORT>"}]})'
mongosh --port <MONGO_PORT> --eval 'rs.status().myState'   # 1 = PRIMARY
```

The order matters: create the users (below) **before** enabling `authorization` and the
keyfile, or use the localhost exception immediately after initiating the set.

`MONGODB_URI` then carries the set name:

```
mongodb://monhorusApp:<PASSWORD>@127.0.0.1:<MONGO_PORT>/monhorus?authSource=monhorus&replicaSet=rs0
```

The backend and mongod live on the same host in this topology, so `bindIp: 127.0.0.1` is
correct and closes the database to the network outright. Enabling `authorization` still
matters: it stops any other local process, including a compromised one, from reading the
database.

**Create the application user** before enabling `authorization`, or through the localhost
exception immediately after:

```bash
mongosh --port <MONGO_PORT> <<'EOF'
use admin
db.createUser({ user: "monhorusAdmin", pwd: passwordPrompt(), roles: ["root"] })
use monhorus
db.createUser({ user: "monhorusApp", pwd: passwordPrompt(), roles: [{ role: "readWrite", db: "monhorus" }] })
EOF
sudo systemctl restart mongod
```

The resulting `MONGODB_URI` is

```
mongodb://monhorusApp:<PASSWORD>@127.0.0.1:<MONGO_PORT>/monhorus?authSource=monhorus&replicaSet=rs0
```

Percent-encode the password if it contains `@`, `:`, `/` or `?`.

### Indexes are not created automatically in production

`apps/backend/src/config/database.ts:24` connects with `autoIndex: !env.isProduction`, and
the comment beside it reads *"In production, build indexes via a migration."* **No such
migration exists in this repository** — nothing calls `syncIndexes`, `createIndexes` or
`ensureIndexes` anywhere in `apps/backend/src`. On a first boot with
`NODE_ENV=production`, the schema indexes — including the unique
`(customer, sourceType, sourceId)` index the report store relies on for idempotency
(`apps/backend/src/scripts/migrate-reports.ts`, header) — are therefore never built.

Until that migration is written, build them once by hand after the first successful boot:

```bash
cd /srv/monhorus/apps/backend
sudo -u monhorus NODE_ENV=development npx tsx -e "
  import('./src/config/database.js');
" # see the open question in section 16 — this is not a settled procedure
```

This is recorded as **open question 16.1**. Do not treat the snippet above as the answer.

### Backup

`mongodump` plus the upload directory. Both, always — a database dump without the files it
references restores a system full of broken attachments.

```bash
sudo install -d -o monhorus -g monhorus /var/backups/monhorus
sudo -u monhorus mongodump \
  --uri="mongodb://monhorusApp:<PASSWORD>@127.0.0.1:<MONGO_PORT>/monhorus?authSource=monhorus&replicaSet=rs0" \
  --archive=/var/backups/monhorus/monhorus-$(date +%F).archive --gzip
sudo -u monhorus tar czf /var/backups/monhorus/uploads-$(date +%F).tar.gz -C /var/lib/monhorus uploads
```

Restore is `mongorestore --archive=... --gzip --drop` and untarring the uploads back to the
path named by `UPLOAD_DIR`.

---

## 5. Backend environment

Parsed once at boot by a Zod schema in `apps/backend/src/config/env.ts`. **A missing or
malformed required value writes the offending field to stderr and exits 1**
(`env.ts:67-74`), so a misconfigured service fails loudly at start rather than at the first
request.

`apps/backend/.env.example` is the tracked template. It does not list every variable the
code reads — `UPLOAD_DIR` and `LOG_LEVEL` are both absent from it and both are honoured.
The table below is the complete set, taken from the schema and from a grep of `process.env`
across `apps/backend/src`.

| Variable | Required | Format / default | What it does | Production note |
|---|---|---|---|---|
| `NODE_ENV` | no | `development` \| `test` \| `production`, default `development` (`env.ts:9`) | Selects log level, log transport, mongoose `autoIndex`, and the rate-limit ceilings | **Set it to `production`.** Leaving it unset means pretty-printed logs through a worker thread, debug-level logging, and 100/1000 rate limits instead of 10/120 |
| `PORT` | no | positive integer, default `4000` (`env.ts:10`) | The port Express binds | `<API_PORT>` |
| `MONGODB_URI` | **yes** | non-empty string (`env.ts:12`) | Connection string | Include credentials and `authSource`. This file holds a database password — mode `0600` |
| `JWT_ACCESS_SECRET` | **yes** | string, min 32 chars (`env.ts:14`) | Signs the 15-minute access token | 48 random bytes. Must differ from the refresh secret |
| `JWT_REFRESH_SECRET` | **yes** | string, min 32 chars (`env.ts:15`) | Signs refresh tokens | A **different** 48 random bytes. Rotating either one invalidates every live session |
| `JWT_ACCESS_TTL` | no | string, default `15m` (`env.ts:16`) | Access-token lifetime | Leave at `15m`. `apps/backend/src/middlewares/authenticate.middleware` re-reads the user on every request, so a short TTL costs little and bounds the window on a suspended account |
| `JWT_ISSUER` | no | string, default `monhorus` (`env.ts:17`) | `iss` claim | Changing it invalidates existing tokens |
| `JWT_AUDIENCE` | no | string, default `monhorus-clients` (`env.ts:18`) | `aud` claim | As above |
| `REFRESH_TOKEN_TTL_DAYS` | no | positive integer, default `30` (`env.ts:19`) | Refresh-token lifetime, and the `expiresAt` written on the stored digest | 30 days is a requirement, not a guess: the employee app must survive a long offline stretch (`docs/adr/0001-authentication.md`, decision 3). Shortening it strands queued field data |
| `MAX_FAILED_LOGIN_ATTEMPTS` | no | positive integer, default `5` (`env.ts:21`) | Failures before an account locks | |
| `ACCOUNT_LOCK_MINUTES` | no | positive integer, default `15` (`env.ts:22`) | Lock duration | |
| `RATE_LIMIT_CREDENTIAL_MAX` | no | positive integer, optional (`env.ts:35`) | Per-IP `/auth/login` ceiling per 15 minutes | **Leave unset.** The production default is 10 (`auth.routes.ts:28`). It exists only so the test suite, one IP signing in hundreds of times, is not throttled |
| `RATE_LIMIT_REFRESH_MAX` | no | positive integer, optional (`env.ts:36`) | Per-IP `/auth/refresh` ceiling per 15 minutes | Leave unset. Production default 120 (`auth.routes.ts:36`) |
| `CORS_ORIGINS` | no | comma-separated origins, default `http://localhost:5173` (`env.ts:38`) | Allow-list, split and trimmed at `env.ts:83-85` | Must be the **exact** public origin of the web admin, scheme and port included. Getting this wrong is section 15's most common failure |
| `APP_TIMEZONE` | no | IANA zone, default `Asia/Ulaanbaatar` (`env.ts:39`) | Reported by `/health`; used by date handling | Leave at `Asia/Ulaanbaatar` |
| `UPLOAD_DIR` | no | path, default `./var/uploads` (`env.ts:45`) | Where multer writes uploaded files | **Set it explicitly to an absolute path outside the deploy directory.** See section 6 — this is the one variable whose default will destroy data |
| `BOOTSTRAP_ADMIN_EMAIL` | no | email, optional (`env.ts:47`) | The first head administrator's login | Needed once, by `bootstrap:admin` |
| `BOOTSTRAP_ADMIN_PASSWORD` | no | string, min 10 (`env.ts:48`) | That account's initial password | **Clear it from the file the moment the bootstrap succeeds** — the script itself says so (`bootstrap-head-admin.ts:59`) |
| `BOOTSTRAP_ADMIN_NAME` | no | non-empty string (`env.ts:49`) | Display name; falls back to `Ерөнхий админ` (`bootstrap-head-admin.ts:20`) | |
| `SEED_DEV_PASSWORD` | no | string, min 10, default `Monhorus.dev2026` (`env.ts:62`) | Password for the logins `seed:dev` creates | Irrelevant in production: the seed refuses to run with `NODE_ENV=production`. Do not set it |
| `LOG_LEVEL` | no | pino level, read directly at `logger.ts:30` — **not in the Zod schema and not in `.env.example`** | Overrides the per-environment default (`info` in production, `debug` in development, `silent` in test) | Leave unset. Set to `debug` temporarily when diagnosing, then remove — `pino-http` logs full request and response including headers at debug |

### The file

```bash
sudo install -d -m 0750 -o root -g monhorus /etc/monhorus
sudo install -m 0640 -o root -g monhorus /dev/null /etc/monhorus/backend.env
```

```ini
# /etc/monhorus/backend.env
NODE_ENV=production
PORT=<API_PORT>

MONGODB_URI=mongodb://monhorusApp:<PASSWORD>@127.0.0.1:<MONGO_PORT>/monhorus?authSource=monhorus&replicaSet=rs0

JWT_ACCESS_SECRET=<48 random bytes, base64url>
JWT_REFRESH_SECRET=<a DIFFERENT 48 random bytes, base64url>
JWT_ACCESS_TTL=15m
JWT_ISSUER=monhorus
JWT_AUDIENCE=monhorus-clients
REFRESH_TOKEN_TTL_DAYS=30

MAX_FAILED_LOGIN_ATTEMPTS=5
ACCOUNT_LOCK_MINUTES=15

CORS_ORIGINS=https://<YOUR_DOMAIN>
APP_TIMEZONE=Asia/Ulaanbaatar

UPLOAD_DIR=/var/lib/monhorus/uploads

# Cleared after `npm run bootstrap:admin` succeeds. See section 8.
BOOTSTRAP_ADMIN_EMAIL=
BOOTSTRAP_ADMIN_PASSWORD=
BOOTSTRAP_ADMIN_NAME=
```

Generate each secret separately, and never reuse one for the other:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`env.ts:1` imports `dotenv/config`, so the process also reads `apps/backend/.env` if one
exists. systemd's `EnvironmentFile` wins, because dotenv does not overwrite a variable
already present in the environment. Keeping a stray `.env` in the deploy directory is
still a hazard — it will silently supply anything `/etc/monhorus/backend.env` omits.
Do not create one on the server.

---

## 6. `UPLOAD_DIR` — where every uploaded photo lives

**This is the single most destructive thing to get wrong.** The default is
`./var/uploads`, resolved relative to the process working directory
(`storage.service.ts:38`, `path.resolve(env.UPLOAD_DIR)`), and `var/` is gitignored at the
repository root. A deployment that leaves the default and then re-clones, or deploys by
replacing the checkout directory, **deletes every uploaded photo, floor plan, HR document
and assessment attachment in the system.** The database rows survive and every download
returns a missing file.

The storage module is local-disk only. There is no object store, no S3, no fallback
(`storage.service.ts`, header). What is on that disk is the whole of the file corpus.

Rules, all of them load-bearing:

1. **Absolute path, outside `/srv/monhorus`.** `/var/lib/monhorus/uploads` is the
   convention this document uses throughout.
2. **Owned by and writable by the service user.** `ensureUploadDirectory()` is called at
   boot (`server.ts`) and again on every upload (`storage.service.ts:68`); it creates the
   directory recursively but cannot fix ownership.
3. **Backed up with the database, in the same run.** See section 4.
4. **Never served by nginx.** Downloads go through the authenticated
   `GET /api/v1/files/:fileId` route, which resolves the file back to its owning entity and
   then to the owning organisation before serving a byte (`storage.routes.ts:76-108`).
   Adding an nginx `location` for the upload directory would hand every tenant's documents
   to anyone who can guess 24 hex characters.

```bash
sudo install -d -m 0750 -o monhorus -g monhorus /var/lib/monhorus/uploads
```

**Limits, from `storage.service.ts`:** 10 MiB per file (`MAX_FILE_BYTES = 10 * 1024 *
1024`, line 24) and at most 10 files per request (`limits.files`, line 79) — though every
upload route in `storage.routes.ts` uses `upload.single('file')`, so one file per request
is what actually happens. Accepted MIME types are JPEG, PNG, WebP, PDF, `.doc`, `.docx`,
`.xls`, `.xlsx` (lines 26-35). Stored filenames are server-generated 24-byte hex with a
`.bin` suffix, so the directory is opaque and the original names live only in MongoDB.

---

## 7. Service user

```bash
sudo useradd --system --home /var/lib/monhorus --shell /usr/sbin/nologin monhorus
sudo chown -R monhorus:monhorus /srv/monhorus
```

The backend never needs to write inside `/srv/monhorus` at runtime — its only write target
is `UPLOAD_DIR` — so the checkout can be owned by a separate deploy user and left
read-only to `monhorus` if that separation is wanted.

---

## 8. First-run bootstrap, in order

The order matters. Each step assumes the previous one ran. All of these are npm scripts in
`apps/backend/package.json` and run through `tsx`, which means **`npm ci` must not have
pruned dev dependencies** — `tsx` is a devDependency.

Run every one of them as the service user, from `/srv/monhorus/apps/backend`, with the
production environment loaded:

```bash
cd /srv/monhorus/apps/backend
set -a; . /etc/monhorus/backend.env; set +a
```

### 8.1 Start the backend once, then stop it

`seedRbac()` runs at boot (`server.ts`), before anything else here can work. It
materialises the permission catalogue and creates any missing system role documents.
`ensureUploadDirectory()` runs beside it. Nothing in steps 8.2-8.6 has a role catalogue to
converge against until this has happened at least once.

### 8.2 `npm run bootstrap:admin`

Creates the first `head_admin` from `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`
and `BOOTSTRAP_ADMIN_NAME`. There is no public registration route and no
`/forgot-password` (`auth.routes.ts:43`), so this script is the only way an installation
gets its first account. It refuses to run once any `head_admin` exists
(`bootstrap-head-admin.ts:29-37`) and exits 0, so it is safe to re-run.

```bash
npm run bootstrap:admin
```

**Then immediately clear `BOOTSTRAP_ADMIN_PASSWORD` from `/etc/monhorus/backend.env`.**
The script's own last words before exiting are `Remove BOOTSTRAP_ADMIN_PASSWORD from .env
now.` (`bootstrap-head-admin.ts:59`), and `.env.example` repeats it. Leaving it in place
means a plaintext administrator password sitting in a file that survives every restart and
every backup of `/etc`.

### 8.3 `npm run migrate:system-role-permissions -- --apply`

**Critical, and easy to skip because nothing fails loudly without it.**

`seedRbac` is *prune-only* for every system role except `SYSTEM_ADMIN`
(`rbac.service.ts`, and the reasoning is written out at length in
`converge-system-role-permissions.ts:11-19`). It removes keys the catalogue no longer
defines, logs a shortfall warning, and **never grants**. That is deliberate: an
administrator may have trimmed a role on purpose and a boot-time reconcile would silently
undo the edit. The consequence is that adding a key to
`SYSTEM_ROLE_DEFAULT_PERMISSIONS` fixes databases seeded from that moment onwards and does
nothing at all to a role document that already exists.

The symptom of skipping this is not an error. It is a button that is never drawn, or an
endpoint that 403s, for a role whose own shipped definition says it should work — the
concrete precedent is `service_request.claim`, where the "Өөртөө авах" button was drawn
nowhere on every upgraded database and the app produced no message at all
(`converge-technician-permissions.ts`, header).

```bash
npm run migrate:system-role-permissions              # DRY RUN. Prints the per-role diff, writes nothing.
npm run migrate:system-role-permissions -- --apply   # Grants every missing default. Leaves extras alone.
```

Dry run is the default and the two modes produce the same diff shape, so a dry run can be
diffed against the applied run.

**`--revoke-extra` is a separate decision and is not part of a normal deployment.** An
*extra* key — one the role holds that is not in its shipped default — is indistinguishable
from here between drift and a deliberate administrator grant made from the access screen.
Without the flag, extras are reported in full and left exactly where they are. With it,
they are withdrawn. Read the reported list first; only pass the flag if every extra on it
is known to be unwanted.

The script never touches a custom role, never writes `SYSTEM_ADMIN` (`seedRbac` already
resynchronises that one on every boot), never writes `user.roles`, and never creates a
missing role document. It files one audit row per role it writes, with `reason`
`migrate:system-role-permissions`. It is idempotent — a second applied run reports zero
changes and writes nothing. It exits non-zero if `--apply` was given and any role did not
converge.

### 8.4 `npm run backfill:user-roles`

For accounts whose `roles` array is empty. Effective permissions are the union of the
roles in `user.roles` — `resolveEffectivePermissions` reads nothing else, with `head_admin`
the one hardcoded exception — so such an account can sign in and then do nothing, 403ing
at every guard (`backfill-user-roles.ts:5-14`).

**Its default is the opposite of the other scripts': this one applies unless `--dry-run` is
passed** (`backfill-user-roles.ts:282`).

```bash
npm run backfill:user-roles -- --dry-run   # look first
npm run backfill:user-roles                # writes
```

On a genuinely fresh install there is nothing for it to do — the bootstrap admin is a
`head_admin`, which it skips deliberately. It matters when an existing database is being
moved onto this server. It refuses to grant a tier default that somebody has widened
beyond `SYSTEM_ROLE_DEFAULT_PERMISSIONS`, reporting those accounts instead, and it reports
without repairing any account pointing at a deleted role document.

### 8.5 `npm run backfill:report-assessment-history`

Needed only where the database predates the fix to `applyReportToEquipment`. Scores that
reached equipment through the report store — planned-work conclusions, service-request
conclusions, consolidated reviews — moved the object's `latestAssessment` head but wrote no
`ObjectAssessment` history row, so the device detail screen's Үнэлгээний түүх table was
empty for them; worse, the head pointed at an ObjectId that was never created
(`backfill-report-assessment-history.ts:5-19`). The script creates the missing rows and
repairs those dangling heads.

**Dry run by default.**

```bash
npm run backfill:report-assessment-history                      # dry run
npm run backfill:report-assessment-history -- --apply
npm run backfill:report-assessment-history -- --apply --object <objectId>
```

Idempotent on `(sourceReportItem, newScore)`. On a fresh install it reports zero rows;
running it anyway is the cheapest way to confirm that.

### 8.6 `npm run backfill:assessment-judged-by`

Also for pre-existing data. `ObjectAssessment.assessedBy` names the approver of the report
a finding arrived on, which meant a Дүгнэлт written by a technician and approved by their
manager displayed the manager. `judgedBy`/`judgedByName` now carry the technician; this
fills those two fields in on rows written before they existed
(`backfill-assessment-judged-by.ts:5-13`).

**Dry run by default.** Same flags as 8.5.

```bash
npm run backfill:assessment-judged-by
npm run backfill:assessment-judged-by -- --apply
```

It only ever writes where the field is absent or null, only ever sets those two fields, and
abandons rather than guesses where the trace is ambiguous. Service-request conclusions are
never traced — there is no per-object author to recover — and keep `judgedBy` null.

### 8.7 The remaining scripts, and when they apply

| Script | When it is needed |
|---|---|
| `npm run migrate:task-note` | Only for a database holding planned-work data written before requirement 6 split Тайлбар from Дүгнэлт. Sub-tasks still carrying `conclusion` instead of `note` fall out of DONE and their parent works stop being completable, so it is **not optional cleanup** where it applies. `--dry-run` available; documents holding both keys are reported and left alone |
| `npm run migrate:technician-permissions` | Superseded by 8.3 for the general case. It is the narrow, hand-reasoned version for the TECHNICIAN role specifically, and additionally **withdraws** `employee.view` — which 8.3 will not do without `--revoke-extra`. Withdrawing it closes a confirmed leak: `GET /employees` returns the whole staff directory, so every technician could read every colleague's registration number, phone and email. Run it if the database predates that change. `--dry-run` available |
| `migrate-reports.ts` | Carries the four pre-unification report shapes into the canonical store. **There is no npm script for it** — see open question 16.2. Only relevant to a database with pre-unification history |
| `npm run seed:dev` | **Development only.** Creates technician logins with a known shared password. It refuses to run with `NODE_ENV=production` (`seed-dev-data.ts:774`), which is the only thing standing between it and a production database. Never run it on this server |

---

## 9. systemd

`/etc/systemd/system/monhorus-api.service`:

```ini
[Unit]
Description=Monhorus backend API
Documentation=file:///srv/monhorus/docs/DEPLOYMENT_UBUNTU.md
After=network-online.target mongod.service
Wants=network-online.target
Requires=mongod.service

[Service]
Type=simple
User=monhorus
Group=monhorus
WorkingDirectory=/srv/monhorus/apps/backend
EnvironmentFile=/etc/monhorus/backend.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=20
StandardOutput=journal
StandardError=journal
SyslogIdentifier=monhorus-api

# Hardening. ReadWritePaths must name UPLOAD_DIR, or every upload fails.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/monhorus/uploads

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now monhorus-api
sudo systemctl status monhorus-api
journalctl -u monhorus-api -f
```

Four details that are not interchangeable:

- **`WorkingDirectory` must be `apps/backend`.** `ExecStart` uses the relative
  `dist/server.js`, and sourcemaps and any relative `UPLOAD_DIR` resolve from here too.
- **`TimeoutStopSec=20` exceeds the process's own 10-second shutdown deadline.**
  `server.ts` handles SIGTERM, stops both background jobs, closes the HTTP server and
  disconnects mongoose, forcing an exit after 10 seconds if that stalls. A shorter systemd
  timeout would SIGKILL mid-shutdown.
- **`ReadWritePaths` must name `UPLOAD_DIR`.** `ProtectSystem=strict` makes the entire
  filesystem read-only otherwise, and every upload fails with `EROFS` while the rest of the
  application looks healthy.
- **`Restart=always` is correct here** because the process deliberately exits on an
  unhandled rejection or uncaught exception (`server.ts`, both handlers call
  `shutdown(..., 1)`). Without it, one such event takes the API down permanently.

Two in-process background jobs start with the server and stop with it; nothing needs to be
scheduled in cron for them:

| Job | Interval | Source |
|---|---|---|
| Overdue reconciliation | 1 hour | `jobs/overdue-reconciliation.job.ts:14` |
| Unclaimed work sweep | 5 minutes | `jobs/unclaimed-work.job.ts:18` |

Both are process-local `setInterval` timers, so **running more than one backend instance
would run them more than once.** Single instance only, unless that is examined first.

---

## 10. Web bundle and nginx

### The API base URL is compiled in

`apps/web/src/lib/api-client.ts:6`:

```ts
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';
```

`import.meta.env` is resolved by Vite **at build time**. The variable is
`VITE_API_BASE_URL`, it must include the `/api/v1` path suffix (that is the only place the
prefix appears — `apiClient` is created with it as `baseURL`), and **changing it requires
rebuilding `apps/web`.** There is no runtime configuration file to edit, and no environment
variable the server can set after the fact. The fallback in that line is a development
convenience; if the build is run without the variable, the deployed bundle will try to
reach `localhost:4000` from the visitor's own machine.

```bash
cd /srv/monhorus
VITE_API_BASE_URL=https://<YOUR_DOMAIN>/api/v1 npm run build --workspace @monhorus/web
```

That command assumes `packages/shared/dist` already exists from the root build in section
3. Alternatively put the value in `apps/web/.env.production` — Vite reads it — but the
tracked template is `apps/web/.env.example` and `.env*` is gitignored, so it must be
recreated on every fresh checkout. The explicit command line is harder to forget.

Serving the bundle from a different origin than the API is possible, and then
`VITE_API_BASE_URL` points at the API origin and `CORS_ORIGINS` must name the web origin.
Serving both from one nginx server block, as below, means same-origin requests and no CORS
question for the browser at all — the mobile apps send no `Origin` header and are
unaffected either way (`app.ts:29`).

### nginx

`/etc/nginx/sites-available/monhorus`:

```nginx
server {
    listen <WEB_HTTP_PORT>;
    listen [::]:<WEB_HTTP_PORT>;
    server_name <YOUR_DOMAIN>;
    return 301 https://$host$request_uri;
}

server {
    listen <WEB_HTTPS_PORT> ssl;
    listen [::]:<WEB_HTTPS_PORT> ssl;
    http2 on;
    server_name <YOUR_DOMAIN>;

    ssl_certificate     /etc/letsencrypt/live/<YOUR_DOMAIN>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<YOUR_DOMAIN>/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root  /srv/monhorus/apps/web/dist;
    index index.html;

    # 10 MiB per upload (MAX_FILE_BYTES, storage.service.ts:24) plus multipart overhead.
    # nginx's default is 1m, which rejects almost every photo with a 413 before the
    # request ever reaches the backend.
    client_max_body_size 12m;

    # Hashed asset filenames, safe to cache forever.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # index.html must never be cached, or a deploy leaves browsers on the old bundle
    # requesting asset hashes that no longer exist.
    location = /index.html {
        add_header Cache-Control "no-store";
    }

    # The API.
    location /api/v1/ {
        proxy_pass http://127.0.0.1:<API_PORT>;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # The health endpoint is at the ROOT, not under /api/v1 (app.ts:52). Without this
    # location it is unreachable through nginx and the SPA fallback returns index.html
    # for it, which makes every uptime check pass while the backend is down.
    location = /health {
        proxy_pass http://127.0.0.1:<API_PORT>/health;
        proxy_set_header Host $host;
        access_log off;
    }

    # SPA fallback. The web admin uses BrowserRouter (apps/web/src/App.tsx:66), so every
    # route below / is a client-side path with no file behind it. Without this line
    # every deep link and every page refresh returns 404.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/monhorus /etc/nginx/sites-enabled/monhorus
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

`app.ts:20` sets `app.set('trust proxy', 1)`, which is why `X-Forwarded-For` must be sent:
without it every request appears to originate from `127.0.0.1`, the per-IP login rate
limiter becomes a global limiter shared by all users, and the audit trail records the
proxy's address instead of the client's.

nginx must be able to traverse into `/srv/monhorus/apps/web/dist`. If the checkout is
mode `0750` and owned by a deploy user, add `www-data` to that group or relax the mode on
the path components.

**JSON request bodies are capped at 1 MiB by the backend itself** (`app.ts:42-43`),
independently of `client_max_body_size`. That limit applies to `application/json` and
form-encoded bodies, not to multipart uploads, which multer handles.

---

## 11. HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <YOUR_DOMAIN>
sudo systemctl status certbot.timer   # renewal is installed by the package
```

If `<WEB_HTTP_PORT>` is not 80, certbot's HTTP-01 challenge cannot reach the host and
`--nginx` will fail. Use DNS-01, or keep 80 open for the challenge.

**HTTPS is a hard requirement for the mobile apps, not a recommendation.** Verified against
this tree:

- **iOS.** Each app has exactly one `Info.plist`, shared by all three build configurations
  (`apps/mobile/ios/Runner.xcodeproj/project.pbxproj:489,671,693`). It declares
  `NSAppTransportSecurity` with **`NSAllowsLocalNetworking` only** — lines 54-58 of
  `apps/mobile/ios/Runner/Info.plist` and the identical block in `apps/mobile-employee`.
  `NSAllowsArbitraryLoads` appears nowhere in either app. `NSAllowsLocalNetworking` ships
  in Release too, but it exempts RFC1918 and link-local addresses only, so a **public**
  host over plain HTTP is blocked in every configuration, debug included.
- **Android.** `usesCleartextTraffic="true"` exists only in the `debug` source set —
  `apps/mobile/android/app/src/debug/AndroidManifest.xml:21-22` and
  `apps/mobile-employee/.../debug/AndroidManifest.xml:19-20` — plus, inconsistently,
  `mobile-employee`'s `profile` manifest. Neither app has a `release` source set, and there
  is no `network_security_config.xml` anywhere, so a **release build gets the platform
  default: cleartext blocked.**

A production build of either app pointed at `http://` therefore cannot connect at all, on
either platform. There is no build flag that changes this without editing the manifests.

---

## 12. The mobile apps

Neither Flutter app is deployed to this server. They are not npm workspaces, `npm ci` does
not install them, and the server needs no Flutter toolchain. They reach this host as
ordinary HTTPS clients.

The API origin is compiled in, exactly as the web bundle's is. Both apps share a
byte-identical config file — `apps/mobile/lib/core/config/app_config.dart` and
`apps/mobile-employee/lib/core/config/app_config.dart`:

```dart
static const String _apiBaseUrlOverride = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: '',
);
```

`String.fromEnvironment` is a **compile-time** constant, supplied by `--dart-define`. When
it is empty the app falls back to `http://10.0.2.2:4000` on Android (the emulator's route
to the host) or `http://127.0.0.1:4000` elsewhere, appending `/api/v1`
(`app_config.dart:27-40`).

**The `--dart-define` value is used verbatim and must therefore include `/api/v1` itself.**
Only the fallback appends it.

```bash
cd apps/mobile-employee
flutter build apk --release --dart-define=API_BASE_URL=https://<YOUR_DOMAIN>/api/v1

cd ../mobile
flutter build apk --release --dart-define=API_BASE_URL=https://<YOUR_DOMAIN>/api/v1
```

A release build given an `http://` URL will not connect — section 11.

Both apps constrain the **Dart** SDK to `>=3.5.0 <4.0.0` (`pubspec.yaml:6-7` in each) and
declare no Flutter constraint. There is no `.fvmrc` or `.flutter-version` in the
repository, so the Flutter version is whatever the build machine has.

**Development helper.** `scripts/run-mobile.sh` is for a developer on the same LAN as a
`npm run dev` backend, not for anything on this server. It resolves the machine's LAN
address from `ipconfig getifaddr en0` (falling back to `en1`), builds
`http://<LAN_IP>:4000/api/v1`, health-checks it, and execs `flutter run` with that
`--dart-define`:

```bash
./scripts/run-mobile.sh employee            # apps/mobile-employee
./scripts/run-mobile.sh customer <device>   # apps/mobile
```

It is macOS-specific (`ipconfig getifaddr`) and hardcodes port 4000.

---

## 13. Verification

Run these in order. Each one proves a different layer, and a failure localises the problem
to that layer.

**1. The backend is up and answering, locally.**

```bash
curl -s http://127.0.0.1:<API_PORT>/health
```

Expected: `{"success":true,"data":{"status":"ok","timezone":"Asia/Ulaanbaatar","uptime":...},"message":"Систем хэвийн ажиллаж байна."}`.
The timezone echoed back is `APP_TIMEZONE`, so this also confirms the environment file was
read.

**2. The health endpoint survives the proxy.**

```bash
curl -s https://<YOUR_DOMAIN>/health
```

Same JSON. If this returns HTML, the `location = /health` block is missing and the SPA
fallback is answering — see section 10.

**3. A login returns a token.**

```bash
curl -s -X POST https://<YOUR_DOMAIN>/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<BOOTSTRAP_ADMIN_EMAIL>","password":"<the bootstrap password>"}'
```

Expected: `success: true` and a `data` object carrying `accessToken`, `refreshToken` and
`expiresIn` (`auth.service.ts:64-66`). Capture it:

```bash
TOKEN=$(curl -s -X POST https://<YOUR_DOMAIN>/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<EMAIL>","password":"<PASSWORD>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')
```

**4. The token authenticates.**

```bash
curl -s https://<YOUR_DOMAIN>/api/v1/auth/me -H "Authorization: Bearer $TOKEN"
```

Expected: the current user, with `role: "head_admin"`.

**5. RBAC converged, and transactions are real.** The boot log is the check for both — see
sections 15.1 and 4.1. A correctly configured install logs neither warning.

```bash
journalctl -u monhorus-api --since "10 minutes ago" | grep -iE "default permissions|does not support transactions"
```

Expected: no output. The transaction warning is emitted lazily, on the first call to
`withTransaction`, not at boot — so it may take a planned-work transition before it
appears. Force it, or check the topology directly:

```bash
mongosh --port <MONGO_PORT> --eval 'rs.status().myState'   # 1 = PRIMARY. Anything else, or an error, means no replica set.
```

**6. An upload round-trip.** This exercises multer, `UPLOAD_DIR`'s permissions, nginx's
`client_max_body_size`, and the authenticated download path in one go. The bootstrap
account is a `head_admin`, which resolves STAFF customer scope and passes the guard.

```bash
# A ~2 MB PNG is enough to be a real multipart body.
FILE_ID=$(curl -s -X POST https://<YOUR_DOMAIN>/api/v1/files/object-assessment-photos \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/photo.png;type=image/png" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.id')

# It landed on disk, under an opaque server-generated name.
sudo ls -l /var/lib/monhorus/uploads | tail -3

# And it comes back through the authenticated route.
curl -s -o /tmp/roundtrip.png -w '%{http_code} %{size_download}\n' \
  "https://<YOUR_DOMAIN>/api/v1/files/$FILE_ID" -H "Authorization: Bearer $TOKEN"
```

Expected: `201` on the upload with a `downloadUrl` of `/api/v1/files/<id>`, a new
`*.bin` file in the upload directory, and `200` with the original byte count on the
download. A `413` is nginx (`client_max_body_size`); an `EROFS` in the journal is
`ReadWritePaths`; a `500` mentioning `EACCES` is directory ownership.

That upload leaves a real `StoredFile` row parked on the uploader. Delete it afterwards, or
accept one orphan row on a system that has no other data yet.

**7. The web app serves, including deep links.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<YOUR_DOMAIN>/
curl -s -o /dev/null -w '%{http_code}\n' https://<YOUR_DOMAIN>/some/deep/route
```

Both must be `200`. The second returning `404` means the `try_files` fallback is missing.

**8. The compiled API URL is the right one.**

```bash
grep -ro "https://<YOUR_DOMAIN>/api/v1" /srv/monhorus/apps/web/dist/assets/ | head -1
grep -ro "localhost:4000" /srv/monhorus/apps/web/dist/assets/ | head -1
```

The first must match. The second must return nothing — if it does not, the bundle was
built without `VITE_API_BASE_URL` and every browser will try to reach its own machine.

---

## 14. Deploying an update

```bash
cd /srv/monhorus
git pull
npm ci
npm run build
VITE_API_BASE_URL=https://<YOUR_DOMAIN>/api/v1 npm run build --workspace @monhorus/web
sudo systemctl restart monhorus-api
```

Then, every time:

```bash
journalctl -u monhorus-api --since "2 minutes ago" | grep -i "default permissions"
```

A release that adds a permission key will log the shortfall warning on the first boot after
the upgrade, and section 8.3 is the remedy. This is not a one-time bootstrap step — it
recurs on **every** release that touches `SYSTEM_ROLE_DEFAULT_PERMISSIONS`.

`UPLOAD_DIR` is outside the checkout, so `git pull` cannot touch it. That is the whole
point of section 6.

---

## 15. Troubleshooting

### 15.1 `System roles do not hold all of their default permissions`

Logged at boot by `seedRbac` (`apps/backend/src/modules/rbac/rbac.service.ts:138`), with
the per-role shortfall attached. The full text ends `; grant them from the access screen if
intended`.

It means one or more system roles are missing keys their own shipped default says they
should hold. The user-visible symptom is silent: an endpoint that 403s, or more often a
button the client never draws, for a role whose definition says it works.

```bash
cd /srv/monhorus/apps/backend
set -a; . /etc/monhorus/backend.env; set +a
npm run migrate:system-role-permissions              # read the diff
npm run migrate:system-role-permissions -- --apply   # then apply it
```

See section 8.3, including why `--revoke-extra` is a separate decision.

### 15.2 `EADDRINUSE`

The process exits immediately; `server.ts`'s `shutdown` guards on `server?.listening`
specifically so this error is not masked by an `ERR_SERVER_NOT_RUNNING` from closing a
server that never bound.

```bash
sudo ss -lntp | grep :<API_PORT>
sudo systemctl status monhorus-api
```

Usually a second copy of the service, a leftover `npm run dev` in a terminal, or
`<API_PORT>` colliding with something else on the host. `Restart=always` means systemd
will retry every 5 seconds indefinitely, so the journal fills with the same line — check
the timestamps to tell a restart loop from a single failure.

### 15.3 MongoDB connection refused

The journal shows `MongoDB connection error` from `database.ts`, and startup fails after
`serverSelectionTimeoutMS: 10_000` — ten seconds, so a boot that hangs for exactly ten
seconds and then dies is this.

```bash
sudo systemctl status mongod
sudo ss -lntp | grep :<MONGO_PORT>
mongosh "mongodb://monhorusApp:<PASSWORD>@127.0.0.1:<MONGO_PORT>/monhorus?authSource=monhorus&replicaSet=rs0" --eval 'db.runCommand({ping:1})'
```

Common causes, in order of frequency: `mongod` not started; `<MONGO_PORT>` in
`/etc/mongod.conf` and in `MONGODB_URI` disagreeing; `authSource` omitted from the URI
after `authorization: enabled` was turned on; a password containing a character that needs
percent-encoding.

### 15.4 CORS rejections

The browser console reports a blocked cross-origin request and the API returns 403 with
the Mongolian message `CORS: origin зөвшөөрөгдөөгүй.` (`app.ts:33`).

`CORS_ORIGINS` is a comma-separated list, split and trimmed at `env.ts:83-85`, and matched
by **exact string equality** against the request's `Origin` header. There is no wildcard,
no subdomain matching and no scheme coercion. `https://example.mn` and
`https://example.mn/` and `http://example.mn` and `https://www.example.mn` are four
different values.

```bash
grep CORS_ORIGINS /etc/monhorus/backend.env
sudo systemctl restart monhorus-api   # it is read once, at boot
```

Two things that are *not* CORS problems and are regularly mistaken for them:

- **The mobile apps are unaffected.** Native clients send no `Origin` header, and
  `app.ts:29` admits a request with no origin. A mobile failure is never this.
- **Same-origin serving has no CORS step at all.** With the nginx block in section 10 the
  browser's requests are same-origin, so a CORS error there means something is still
  pointing at a different host — most likely a stale `VITE_API_BASE_URL` baked into the
  bundle. Check it with the grep in verification step 8.

### 15.5 Uploads fail

| Symptom | Cause |
|---|---|
| `413 Request Entity Too Large`, no backend log line | nginx `client_max_body_size`. Default is 1m; needs 12m |
| 400 with `Зөвшөөрөгдөөгүй файлын төрөл` | MIME type outside the allow-list at `storage.service.ts:26-35` |
| 400 with a file-size error from multer | Over 10 MiB — `MAX_FILE_BYTES`, `storage.service.ts:24` |
| 500 with `EROFS` in the journal | `ReadWritePaths` in the unit does not name `UPLOAD_DIR` |
| 500 with `EACCES` in the journal | The upload directory is not owned by `monhorus` |
| Downloads 404 for files that used to work | `UPLOAD_DIR` moved, or the deploy directory was replaced while `UPLOAD_DIR` was still relative. Section 6 |

### 15.6 Login returns 429

`{"code":"RATE_LIMITED"}` from the per-IP limiter: 10 login attempts per 15 minutes in
production (`auth.routes.ts:28`), 120 refreshes (`auth.routes.ts:36`). If a whole office
shares one NAT address this ceiling is per-office, not per-user. The correct first check is
whether `X-Forwarded-For` is reaching the backend at all — without it every request looks
like `127.0.0.1` and the limit becomes global. `RATE_LIMIT_CREDENTIAL_MAX` exists to raise
it but is documented in `.env.example` as something to leave unset in every real
deployment.

Distinct from an account lock: 5 failed passwords locks the account itself for 15 minutes
(`MAX_FAILED_LOGIN_ATTEMPTS`, `ACCOUNT_LOCK_MINUTES`).

### 15.7 `MongoDB deployment does not support transactions`

Logged once, on the first `withTransaction` call, by `transaction.util.ts:57-60`. Nothing
fails — the callback runs anyway, without a session — so this can sit in the journal
unnoticed indefinitely while planned-work approvals write non-atomically.

```bash
mongosh --port <MONGO_PORT> --eval 'rs.status()'
```

An error, or `myState` other than 1, means `mongod` is standalone. Section 4.1 converts it
to a single-node replica set. `MONGODB_URI` must gain `&replicaSet=rs0` at the same time,
and the backend must be restarted — the probe result is cached in module state for the life
of the process (`transaction.util.ts:23`).

### 15.8 The process exits at start with a list of fields

```
Invalid environment configuration:
  - JWT_ACCESS_SECRET: JWT_ACCESS_SECRET must be at least 32 characters
```

Written to stderr by `env.ts:67-74` before the logger exists, so it appears in the journal
as a bare line with no JSON around it. The named field is the whole diagnosis.

---

## 16. Open questions

Recorded rather than guessed. Each is a real gap in what this repository settles.

**16.1 Index creation in production.** `database.ts:24` sets
`autoIndex: !env.isProduction` with the comment *"In production, build indexes via a
migration"*, and no such migration exists — `syncIndexes`, `createIndexes` and
`ensureIndexes` appear nowhere in `apps/backend/src`. A first production boot therefore
builds no indexes at all, including the unique ones the report store's idempotency depends
on. The snippet in section 4 is a placeholder, not a tested procedure. **What should be
run, and whether a one-off `syncIndexes()` script should be added to `apps/backend/src/scripts/`,
is unresolved.** Until then, the pragmatic options are to add that script, or to accept an
unindexed first boot and build them by hand from `mongosh`.

**16.2 `migrate-reports.ts` has no npm script.** Its own header documents the invocation as
`npm run migrate:reports --workspace @monhorus/backend`, but `apps/backend/package.json`
declares no `migrate:reports` entry — the other five scripts in that directory all have
one. Whether the omission is deliberate (the migration is finished and was withdrawn) or an
oversight is not determinable from the tree. Running it today requires
`npx tsx src/scripts/migrate-reports.ts`.

**16.3 The `profile` manifest asymmetry.** `apps/mobile-employee`'s profile build permits
cleartext (`android/app/src/profile/AndroidManifest.xml:15-16`); `apps/mobile`'s does not.
Release builds are unaffected — neither has a release source set — so this changes nothing
for deployment, but it means a profile-mode run of the customer app cannot reach a
plain-HTTP development backend. Whether that is intentional is unclear.

**16.4 `apps/mobile/android/` is untracked.** `git status` reports the whole directory as
untracked, while `apps/mobile-employee/android/` is committed. The files on disk are
hand-edited, not template output — the debug manifest carries a written comment referencing
`apps/mobile-employee`. A fresh clone will therefore not have them, and the Android build
of the customer app will behave differently from what section 11 describes. **This should
be committed before anyone builds the customer app from a clean checkout.**

`scripts/` is untracked in the same way, so `scripts/run-mobile.sh` — the helper section 12
documents — is not in a fresh clone either. It is a development aid and nothing on this
server needs it, but the reference in section 12 will not resolve for anyone who has only
cloned the repository.

**16.5 Single-instance assumption.** The two background jobs in section 9 are process-local
timers. Nothing in the code coordinates them across instances, so horizontal scaling would
run overdue reconciliation and the unclaimed-work sweep once per replica. Whether that is
harmful depends on those jobs' idempotency, which was not audited for this document.

**16.6 Log shipping.** `logger.ts` emits NDJSON to stdout in production with no transport,
and the unit above sends it to the journal. Whether a collector is expected, and which, is
not settled anywhere in the repository.
