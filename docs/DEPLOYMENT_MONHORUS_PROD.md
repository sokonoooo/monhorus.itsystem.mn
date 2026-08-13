# Monhorus production runbook — 103.87.255.221

The concrete deployment of this repository onto the host `webhost`. Where
`DEPLOYMENT_UBUNTU.md` leaves ports and paths as placeholders, this file resolves them
to what is actually running. Deployed 2026-08-04.

For anything not covered here — why a replica set, why `UPLOAD_DIR` matters, what each
bootstrap script does — read `DEPLOYMENT_UBUNTU.md` first. This file does not repeat it.

---

## 1. What is running

| Concern | Value |
|---|---|
| Web admin + API | **`https://monhorus.itsystem.mn`** |
| Android APK download | **`https://monhorus.itsystem.mn/apk/`** |
| Legacy web + API (kept) | `http://103.87.255.221:3020` |
| Legacy APK download (kept) | `http://103.87.255.221:3021` |
| Backend process | `127.0.0.1:4000`, systemd unit `monhorus-api` |
| MongoDB | `127.0.0.1:27017`, replica set `rs0`, database `monhorus` |
| Deploy tree | `/srv/clients/monhorus` (owner `its`) |
| Uploads | `/var/lib/monhorus/uploads` (owner `monhorus`, 0750) |
| Environment | `/etc/monhorus/backend.env` (0640 `root:monhorus`) |
| Service user | `monhorus`, `/usr/sbin/nologin` |
| Backups target | `/var/backups/monhorus` |

**TLS is live as of 2026-08-13.** The `monhorus.itsystem.mn` A record was repointed from
`103.87.255.199` to this host, certbot issued a certificate (expires 2026-11-11, renewal
timer installed), and `:80` now 301s to `:443`. Section 7 records the migration.

**The IP-and-port sites are deliberately still running.** Every APK installed on a handset
before 2026-08-13 has `http://103.87.255.221:3020/api/v1` compiled into it and would lose
the API the moment `:3020` stopped answering. `CORS_ORIGINS` lists both origins for the
same reason. Retire `:3020` and `:3021` only once no handset carries an old build —
that is a decision about phones, not about the server.

### The host is shared

Four other sites live on this box and must not be disturbed: `itsystem.mn`,
`test.itsystem.mn`, `test1.itsystem.mn`, `wellcom.mn`, plus pm2 apps on `:3001` and
`:3010`, PostgreSQL on `:5432` and the SPIMEX crawler on `:8000`. Every change this
deployment made is **additive** — two new nginx files, one new systemd unit, two new ufw
rules. No existing config was edited. Their md5sums were recorded before and after and
are unchanged.

---

## 2. Ubuntu 25.04 has no MongoDB repository

`repo.mongodb.org/apt/ubuntu/dists/plucky/` returns 404. MongoDB publishes jammy and
noble only.

**The `noble` repository is pinned deliberately** in
`/etc/apt/sources.list.d/mongodb-org-8.0.list`. It is not a copy-paste error, and it
works because `mongodb-org-server` 8.0's declared dependencies are all satisfied on
plucky:

| Requires | plucky has |
|---|---|
| `libssl3t64 (>= 3.0.0)` | 3.4.1 |
| `libcurl4t64 (>= 7.16.2)` | 8.12.1 |
| `libc6 (>= 2.38)` | 2.41 |

Recheck that table before any MongoDB major upgrade. If a future release raises a floor
past what plucky ships, the options are the official tarball or upgrading the OS.

Only three packages are installed — `mongodb-org-server`, `mongodb-mongosh`,
`mongodb-database-tools` — not the `mongodb-org` meta package, which additionally pulls
the deprecated legacy shell. Disk on this host is the binding constraint.

### WiredTiger is capped

`/etc/mongod.conf` sets `cacheSizeGB: 0.25`. **Do not remove this.** The host has 1.6 GB
of RAM shared with everything in section 1; the default would claim ~300 MB and grow.
mongod currently sits around 35–50 MB resident.

---

## 3. Environment file gotchas

Two things about `/etc/monhorus/backend.env` will waste an hour if you hit them cold.

**Values with shell metacharacters must stay quoted.** `MONGODB_URI` contains
`&replicaSet=rs0`. Unquoted, `. /etc/monhorus/backend.env` backgrounds the assignment at
the `&` and the variable ends up empty — the backend then reports `MONGODB_URI: Required`
even though the line is plainly there. systemd's `EnvironmentFile` parses it either way,
so this only bites the bootstrap scripts, which source it.

**Bootstrap keys must be deleted, not blanked.** `BOOTSTRAP_ADMIN_EMAIL`,
`BOOTSTRAP_ADMIN_PASSWORD` and `BOOTSTRAP_ADMIN_NAME` are absent from the file on purpose.
Setting them to an empty value crash-loops the service. `src/config/env.ts` now wraps
them in `optionalEnv()`, which treats empty as absent, so this is fixed going forward —
but a backend built before 2026-08-04 will still fail this way.

Secrets live only in this file and in root-only copies under `/root`:
`.monhorus-dbpass`, `.monhorus-dbadminpass`, `.monhorus-adminpass`.

**Login throttling is disabled here (2026-08-05, by request.)**
`RATE_LIMIT_CREDENTIAL_MAX` and `RATE_LIMIT_REFRESH_MAX` are set to `1000000000`. The
middleware is still mounted, so re-enabling is one line plus `systemctl restart
monhorus-api` — no rebuild. The shipping defaults were 10 logins and 120 refreshes per
15 min per IP; do not restore those numbers as-is without also reading item 16 of
`IMPROVEMENTS.md`, because the limiter counted **successful** logins and locked the head
admin out of a working password after eleven normal sign-ins.

**Per-account lockout is a separate mechanism and is still on**: `MAX_FAILED_LOGIN_ATTEMPTS=5`,
`ACCOUNT_LOCK_MINUTES=15`. It counts only failures and resets the counter on every
successful login (`auth.service.ts:103,149`), so it does not have the defect above.
To clear a lock without waiting: `POST /api/v1/users/:userId/reset-passcode`, or set
`failedLoginAttempts: 0, lockedUntil: null` on the user document.

There is **no nginx-level `limit_req`/`limit_conn`** anywhere on this host, so the
application is the only throttle that ever existed.

---

## 4. Running scripts as the service user

`runuser` scrubs the environment, so `-p` is required. Do not pass secrets on the command
line — this is a shared host and `ps` is readable by other tenants.

```bash
sudo bash -c 'set -a; . /etc/monhorus/backend.env; set +a
cd /srv/clients/monhorus/apps/backend
runuser -p -u monhorus -- node dist/scripts/<script>.js'
```

**Scripts run from `dist/`, not through `tsx`.** Every script under `src/scripts/` is
compiled to `dist/scripts/*.js`, which is why the server installs with `npm ci --omit=dev`
— `node_modules` is 57 MB instead of several hundred. `DEPLOYMENT_UBUNTU.md` §8 says dev
dependencies are required; on this host they are not.

Available: `bootstrap-head-admin`, `converge-system-role-permissions`,
`backfill-user-roles`, `backfill-report-assessment-history`, `backfill-assessment-judged-by`,
`rename-task-conclusion-to-note`, `migrate-reports`, **`sync-indexes`**.
Never `seed-dev-data`.

---

## 5. Indexes must be built by hand — `sync-indexes`

`config/database.ts` connects with `autoIndex: !env.isProduction`, so **a production boot
creates no indexes at all**. This was `DEPLOYMENT_UBUNTU.md` open question 16.1; the
missing migration now exists.

```bash
# dry run first -- shows what would be created and dropped
runuser -p -u monhorus -- node dist/scripts/sync-indexes.js --dry-run
runuser -p -u monhorus -- node dist/scripts/sync-indexes.js
```

On first run it created **205 indexes across 37 models**. Run it after every release that
touches a schema index. It is idempotent.

It discovers models by walking the compiled tree for both `*.model.js` **and**
`*.models.js` — five modules (planned-work, objects, org, material, object-master) use the
plural form, so a singular-only glob would silently skip them.

`syncIndexes()` also drops indexes present on the collection but absent from the schema.
An index added by hand from mongosh will be removed; `--dry-run` shows that first.

---

## 6. Deploying an update

The web bundle's API origin is compiled in at **build** time, and this host cannot build
(1.6 GB RAM, shared with four live sites — a `vite build` there risks OOM-killing a
neighbour). So build on a workstation and ship artefacts.

```bash
# On the workstation
npm ci
npm run build
VITE_API_BASE_URL=http://103.87.255.221:3020/api/v1 npm run build --workspace @monhorus/web

# Verify before shipping: the bundle must carry the server origin and NOT localhost
grep -ro "103.87.255.221:3020/api/v1" apps/web/dist/assets/ | head -1   # must match
grep -ro "localhost:4000"             apps/web/dist/assets/ | head -1   # must be empty

tar czf monhorus.tar.gz --exclude=node_modules --exclude=.git --exclude='*.pdf' \
  --exclude=apps/mobile --exclude=apps/mobile-employee \
  package.json package-lock.json turbo.json docs apps packages
```

Then on the server:

```bash
tar xzf monhorus.tar.gz -C /srv/clients/monhorus
cd /srv/clients/monhorus && npm ci --omit=dev
sudo chmod -R a+rX /srv/clients/monhorus/apps/web/dist
sudo systemctl restart monhorus-api
# then, if the release touched schema indexes or permissions:
#   sync-indexes, and converge-system-role-permissions --apply
sudo journalctl -u monhorus-api --since "2 minutes ago" | grep -i "default permissions"
```

### Uploading files to this host

Two traps, both cost real time:

1. **Set `MSYS_NO_PATHCONV=1` when using Git Bash.** Otherwise MSYS rewrites a
   `/home/its/x` argument into `C:/Program Files/Git/home/its/x` before the program sees
   it. The remote redirect then fails, and because the far end dies mid-transfer the
   symptom is a misleading `OSError: Socket is closed`, not a path error.
2. SFTP fails the remote open for multi-megabyte files on this host. Use `scp`, or the
   chunked base64 uploader in the deployment scratchpad. Always verify with `sha256sum`
   on both ends.

---

## 7. HTTPS — done 2026-08-13

Plain HTTP was a hard blocker for the Flutter apps, not a style preference. iOS declares
`NSAppTransportSecurity` with `NSAllowsLocalNetworking` only, which exempts RFC1918
addresses but not a public IP. Android release builds get the platform default of
cleartext-blocked. **A release APK pointed at `http://103.87.255.221` cannot connect on
either platform**, which is why the network security config in section 8 existed.

The A record was repointed to this host and the migration ran in full:

```bash
sudo certbot --nginx -d monhorus.itsystem.mn        # needs :80 reachable for HTTP-01
```

All four follow-on steps were completed together — doing fewer half-migrates the system:

1. `CORS_ORIGINS=https://monhorus.itsystem.mn,http://103.87.255.221:3020`. Both, not one:
   the second keeps already-installed APKs working. Restart after editing.
2. Web bundle rebuilt with `VITE_API_BASE_URL=https://monhorus.itsystem.mn/api/v1`.
3. Both APKs rebuilt with the matching `--dart-define` (section 8).
4. The cleartext exception is gone from `network_security_config.xml` in both apps. The
   file is kept, reduced to an explicit `cleartextTrafficPermitted="false"`, because the
   implicit default it would otherwise rely on is derived from `targetSdk` — a value both
   modules inherit from the Flutter SDK rather than pinning, so it can move on an SDK
   upgrade without anyone choosing to move it.

**iOS is no longer blocked by transport security.** Nothing else about an iOS build has
been attempted — no signing identity, no provisioning profile, no App Store account.

### Renewal

Certbot installed its own systemd timer. The renewal hook reloads nginx; nothing in this
deployment needs to be touched. Verify with `sudo certbot renew --dry-run` if in doubt.
The vhost file `/etc/nginx/sites-available/monhorus.itsystem.mn` is certbot-managed from
the `listen 443` line down — the `/apk/` location was spliced in by locating the `:443`
block's closing brace rather than by line number, precisely so a renewal rewrite cannot
shift it onto the wrong block.

---

## 8. The Android apps

Rebuilt and republished **2026-08-13** against the TLS origin. Downloadable from
`https://monhorus.itsystem.mn/apk/` (and still from `http://103.87.255.221:3021`).

| | Employee | Customer |
|---|---|---|
| File | `monhorus-employee.apk` | `monhorus-customer.apk` |
| applicationId | `mn.monhorus.monhorus_employee` | `mn.monhorus.monhorus_mobile` |
| Label | Monhorus Employee | Monhorus Mobile |
| Size | 55.0 MB | 53.5 MB |
| minSdk / target | 24 (Android 7.0) / 36 | 24 / 36 |
| API origin | `https://monhorus.itsystem.mn/api/v1` | same |

The previous build is kept beside each as `*.apk.prev`, so a bad release can be rolled
back by renaming rather than rebuilding.

### Always verify the signature, never assume it

`build.gradle.kts` falls back to the **debug** key when `android/key.properties` is absent,
so that a developer without the keystore can still run `flutter build apk --release`. That
convenience means a release built on a machine missing the file is silently signed with
the wrong key — and Android refuses to install an update whose signing certificate differs,
so every user would have to uninstall first and lose their local data. The build does not
warn. Check it explicitly:

```bash
apksigner verify --print-certs app-release.apk | grep "SHA-256"
keytool -list -v -keystore monhorus-release.jks -alias monhorus | grep "SHA256:"
```

Both must be `01a103a7b36d89c88e131b20feda1d7983a20408b6e6c6150ead401ae1920948`
(`CN=Monhorus, OU=IT System, O=IT System LLC, L=Ulaanbaatar, C=MN`). That fingerprint is
the apps' identity on every handset; if it ever changes, in-place upgrades are over.

Not built on this server — it has no JDK and 2.6 GB of disk. The toolchain lives on the
workstation at `C:\dev` (Flutter 3.44.8 / Dart 3.12.2, Temurin JDK 17, Android SDK 36).

### Rebuilding

```bash
cd apps/mobile-employee     # and again in apps/mobile
flutter build apk --release --dart-define=API_BASE_URL=http://103.87.255.221:3020/api/v1
```

**The `--dart-define` value is used verbatim** (`app_config.dart`) — only the unset
fallback appends `/api/v1`, so it must be included here. Omitting the flag entirely
produces an APK that points at `10.0.2.2:4000`, the Android emulator's route to its host,
and fails on every real phone.

Then upload to `/srv/clients/monhorus/apk/`, `chmod a+r`, and update the size and date on
`index.html`. nginx serves `.apk` as `application/vnd.android.package-archive` with
`Cache-Control: no-store`, so a rebuild is picked up immediately.

### Signing — read before you lose it

Both apps are signed with **one shared release keystore**:

```
C:\Ajil\monhorus-keys\monhorus-release.jks      (password in keystore-password.txt beside it)
alias monhorus · RSA 4096 · valid 10,000 days · CN=Monhorus, O=IT System LLC
```

Each app reads it through `android/key.properties`, which is gitignored, as are `*.jks`
and `*.keystore`. `key.properties.example` is the tracked template. When `key.properties`
is absent the build silently falls back to the **debug** key — fine locally, never for a
published APK.

**Back that directory up somewhere off this machine.** Android identifies an app by its
signing certificate: lose the keystore and no future build can update an installed app.
Every phone would have to uninstall and reinstall, losing local data.

### Cleartext, and what has to change for HTTPS

A release APK cannot reach a plaintext host by default. Both apps carry
`android/app/src/main/res/xml/network_security_config.xml`, referenced from
`main/AndroidManifest.xml`, permitting cleartext **to `103.87.255.221` only** with the
base config still denying everything else. `minSdk` is pinned to 24 in both
`build.gradle.kts` files because the attribute is ignored below API 24.

When the server moves to HTTPS (section 7), delete that file and the manifest attribute,
then rebuild both apps with the `https://` origin.

`DEPLOYMENT_UBUNTU.md` open question 16.4 says `apps/mobile/android/` is untracked. That
is **no longer true** — 19 files under it are tracked, as is `scripts/run-mobile.sh`. Both
apps' Android trees are in the repository, so the network security config, the corrected
applicationId and the signing wiring all survive a fresh clone. 16.4 can be closed.

Flutter 3.44's migrator added `android.builtInKotlin=false` and `android.newDsl=false` to
both `android/gradle.properties` during the first build. Keep them: some plugins this
project depends on have not migrated to Built-in Kotlin, and removing the flags breaks the
build.

---

## 9. Backups

Database **and** uploads, always in the same run — a dump without its files restores a
system whose every attachment 404s.

```bash
sudo bash -c 'set -a; . /etc/monhorus/backend.env; set +a
mongodump --uri="$MONGODB_URI" --archive=/var/backups/monhorus/db-$(date +%F).archive --gzip'
sudo tar czf /var/backups/monhorus/uploads-$(date +%F).tar.gz -C /var/lib/monhorus uploads
```

Restore: `mongorestore --archive=... --gzip --drop`, then untar uploads back to
`/var/lib/monhorus`. **Nothing is scheduled yet** — see `IMPROVEMENTS.md`.

---

## 10. Verification

```bash
curl -s http://103.87.255.221:3020/health                    # timezone echo proves env loaded
curl -s -o /dev/null -w '%{http_code}\n' http://103.87.255.221:3020/any/deep/route   # 200 = SPA fallback
curl -s -o /dev/null -w '%{http_code}\n' http://103.87.255.221:3021/                 # 200 = APK page
```

Login, and note the token path — **`data.tokens.accessToken`**, not `data.accessToken` as
`DEPLOYMENT_UBUNTU.md` §13 states:

```bash
TOKEN=$(curl -s -X POST http://103.87.255.221:3020/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"..."}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.tokens.accessToken')
curl -s http://103.87.255.221:3020/api/v1/auth/me -H "Authorization: Bearer $TOKEN"
```

Health of the deeper invariants:

```bash
mongosh --quiet "$MONGODB_URI" --eval 'rs.status().myState'   # 1 = PRIMARY; transactions real
sudo journalctl -u monhorus-api | grep -iE "default permissions|does not support transactions"
sudo ss -tlnp | grep -E ':4000|:27017'                        # both must be 127.0.0.1 only
```

After any change, re-check the neighbours:

```bash
for h in itsystem.mn test.itsystem.mn test1.itsystem.mn wellcom.mn; do
  echo -n "$h "; curl -s -o /dev/null -w '%{http_code}\n' -k -H "Host: $h" https://127.0.0.1/
done
```
Baseline is `200 / 000 / 200 / 307`. `test.itsystem.mn` returning `000` predates this
deployment.

---

## 11. Rollback

Everything is additive:

```bash
sudo systemctl disable --now monhorus-api
sudo rm /etc/nginx/sites-enabled/monhorus /etc/nginx/sites-enabled/monhorus-apk
sudo nginx -t && sudo systemctl reload nginx
sudo ufw delete allow 3020/tcp && sudo ufw delete allow 3021/tcp
```

`/srv/clients/monhorus`, `/var/lib/monhorus`, the `monhorus` database and the `monhorus`
user can then be removed independently. No other tenant is touched at any point.
