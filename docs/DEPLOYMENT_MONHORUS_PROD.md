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

### `APP_WEB_BASE_URL` must be set, and its default is a trap

The password-reset release added `APP_WEB_BASE_URL`, and it **defaults to
`http://localhost:5173`**. `auth.service.ts:334` uses it verbatim to build the link that
goes into the reset email:

```ts
return `${env.APP_WEB_BASE_URL.replace(/\/+$/, '')}/reset-password/${token}`;
```

Nothing validates it against reality, and no other response in the system needs a public
address, so this is the first setting the server has to know about itself rather than read
off the request. Left at the default, every reset email a user receives points at their own
machine and the feature is silently useless — the send succeeds, the log looks clean, and
only the recipient ever sees the broken link.

```ini
APP_WEB_BASE_URL=https://monhorus.itsystem.mn
PASSWORD_RESET_TTL_MINUTES=60
```

### Mail degrades instead of failing

`SMTP_HOST` is what switches the transport on (`env.ts`, `mailEnabled`). With it unset the
server **logs the reset link instead of sending it** — deliberate, so a laptop with no mail
server still runs and the test suite stays off the network. The consequence in production is
that password reset appears to work end to end while no mail is ever sent; the link exists
only in the journal. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`
and `MAIL_FROM` before telling anyone the feature is live.

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

On first run it created **205 indexes across 37 models**. Because it is idempotent, the
deploy procedure in section 6 runs it on *every* release rather than asking whoever is
deploying to work out whether this one touched a schema index.

It discovers models by walking the compiled tree for both `*.model.js` **and**
`*.models.js` — five modules (planned-work, objects, org, material, object-master) use the
plural form, so a singular-only glob would silently skip them.

`syncIndexes()` also drops indexes present on the collection but absent from the schema.
An index added by hand from mongosh will be removed; `--dry-run` shows that first.

**The boot now checks that this was actually done.** `config/index-drift.ts` diffs every
model's declared indexes against the database at startup and logs the result with the
phrase `schema indexes`, so drift is greppable in the journal the same way the RBAC
warning is. A missing **unique** index is fatal and the process exits — it is not a
performance matter but the silent removal of a correctness invariant, and nothing
downstream would ever detect it. A missing ordinary index, or an index the schema no
longer declares, is logged as a warning and the service starts. This does not build
anything: `sync-indexes` remains the only thing that writes indexes.

A brand-new database that has never had `sync-indexes` run against it will therefore
refuse to serve. That is intended and it is not a deadlock — `sync-indexes.js` opens its
own connection and does not need the API to be running.

---

## 6. Deploying an update

The web bundle's API origin is compiled in at **build** time, and this host cannot build
(1.6 GB RAM, shared with four live sites — a `vite build` there risks OOM-killing a
neighbour). So build on a workstation and ship artefacts.

**Do not pass `VITE_API_BASE_URL` on the command line.** `apps/web/.env.production` is
committed for exactly this reason and already carries
`https://monhorus.itsystem.mn/api/v1`; a value given on the command line silently
overrides it, and because the origin is compiled in there is no runtime configuration to
correct the bundle afterwards. Until 2026-09-04 this section told you to override it with
`http://103.87.255.221:3020/api/v1` and then `grep` the bundle for that same string — a
check that passed precisely when the build was wrong, shipping an admin console pointed at
the retired plain-HTTP host. If a build genuinely needs a different origin, edit
`.env.production` for that build rather than overriding it here.

```bash
# On the workstation
npm ci
npm run build            # apps/web/.env.production supplies VITE_API_BASE_URL

# Verify before shipping: the bundle must carry the TLS origin, and must carry neither
# localhost nor the retired plain-HTTP origin
grep -ro "monhorus.itsystem.mn/api/v1" apps/web/dist/assets/ | head -1   # must match
grep -ro "localhost:4000"              apps/web/dist/assets/ | head -1   # must be empty
grep -ro "103.87.255.221:3020"         apps/web/dist/assets/ | head -1   # must be empty

tar czf monhorus.tar.gz --exclude=node_modules --exclude=.git --exclude='*.pdf' \
  --exclude=apps/mobile --exclude=apps/mobile-employee \
  package.json package-lock.json turbo.json docs apps packages
```

Then on the server:

```bash
tar xzf monhorus.tar.gz -C /srv/clients/monhorus
cd /srv/clients/monhorus && npm ci --omit=dev
sudo chmod -R a+rX /srv/clients/monhorus/apps/web/dist

# 1. What the migrations WOULD do, against the new build. Both are dry by default and
#    write nothing. Read the output; that is the point of the step.
sudo bash -c 'set -a; . /etc/monhorus/backend.env; set +a
cd /srv/clients/monhorus/apps/backend
runuser -p -u monhorus -- node dist/scripts/sync-indexes.js --dry-run
runuser -p -u monhorus -- node dist/scripts/converge-system-role-permissions.js'

# 2. Apply them -- BEFORE the restart, so the service comes up against a database that
#    already matches the code it is about to run. Both are idempotent and are run on
#    every release rather than when someone recalls that this one "touched schema indexes
#    or permissions": that judgement cannot be made reliably from a tarball, and only one
#    half of it ever had a signal. On a release that changed neither, this is two no-ops.
#    `--apply` grants missing defaults only; it never revokes without `--revoke-extra`.
sudo bash -c 'set -a; . /etc/monhorus/backend.env; set +a
cd /srv/clients/monhorus/apps/backend
runuser -p -u monhorus -- node dist/scripts/sync-indexes.js
runuser -p -u monhorus -- node dist/scripts/converge-system-role-permissions.js --apply'

# 3. Now restart.
sudo systemctl restart monhorus-api

# 4. The boot reports on both. A healthy boot prints ONE line -- "Verified schema indexes
#    against the database" -- and nothing about permissions. Anything else is a finding:
#      "Missing UNIQUE schema indexes ..."   the service did NOT start; see below
#      "Missing non-unique schema indexes"   queries will scan; re-run sync-indexes
#      "... schema indexes the code no longer declares"  sync-indexes would drop them
#      "... do not hold all of their default permissions"  grant them from the access screen
sudo journalctl -u monhorus-api --since "2 minutes ago" \
  | grep -iE "schema indexes|default permissions"
```

**If the service does not come back, read that grep before anything else.** Since the
index-drift check was added, a boot that finds a declared UNIQUE index missing from the
database logs `Missing UNIQUE schema indexes` at fatal and exits rather than serving
traffic — deliberately, because those indexes are the only thing preventing a duplicate
invoice, and a process that boots without them is the process that writes the bad data.
The fix is the `sync-indexes.js` line above, which needs no running API. Only if a
degraded system is genuinely the better option mid-incident, set `ALLOW_INDEX_DRIFT=true`
in `/etc/monhorus/backend.env`, restart, and remove it again afterwards; every boot that
uses it says so at error level.

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
either platform**, which is why the cleartext exception in section 8's network security
config existed. That exception is gone; the file itself is kept, and section 8 says why.

The A record was repointed to this host and the migration ran in full:

```bash
sudo certbot --nginx -d monhorus.itsystem.mn        # needs :80 reachable for HTTP-01
```

All four follow-on steps were completed together — doing fewer half-migrates the system:

1. `CORS_ORIGINS=https://monhorus.itsystem.mn,http://103.87.255.221:3020`. Both, not one:
   the second keeps already-installed APKs working. Restart after editing.
2. Web bundle rebuilt against `https://monhorus.itsystem.mn/api/v1`. That value moved
   into the committed `apps/web/.env.production` at the same time, which is why section 6
   no longer sets it on the command line.
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
| applicationId | `mn.itsystem.monhorusEmployee` | `mn.itsystem.monhorus` |
| Label | Monhorus Employee | Monhorus Mobile |
| Size | 55.0 MB | 53.5 MB |
| minSdk / target | 24 (Android 7.0) / 36 | 24 / 36 |
| API origin | `https://monhorus.itsystem.mn/api/v1` | same |

`applicationId` is the identity Android and Firebase match on, and is what
`adb uninstall` takes. It is **not** the Gradle `namespace`, which both modules keep at
the original `mn.monhorus.monhorus_*` because it names the generated `R`/`BuildConfig`
classes and renaming it buys nothing. The iOS bundle identifiers match the
`applicationId`s above.

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
flutter build apk --release --dart-define=API_BASE_URL=https://monhorus.itsystem.mn/api/v1
```

**The origin must be the `https://` one.** Both apps deny cleartext outright in
`network_security_config.xml` (below), and iOS App Transport Security exempts only RFC1918
addresses, not a public IP. An APK built against `http://103.87.255.221:3020/api/v1`
therefore cannot open a socket at all — every request fails before it leaves the handset,
and the login screen reports it as a lost connection rather than as a misconfiguration.
Section 7 says the same thing; if these two ever disagree again, section 7 is right.

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

### Cleartext is denied, and stays denied

A release APK cannot reach a plaintext host by default. Both apps carry
`android/app/src/main/res/xml/network_security_config.xml`, referenced from
`main/AndroidManifest.xml`. Until 2026-08-13 it permitted cleartext **to
`103.87.255.221` only**, with the base config denying everything else. Since the TLS
migration (section 7) that exception is gone: in both apps the file is now a bare
`<base-config cleartextTrafficPermitted="false" />` and permits nothing.

**The file is kept rather than deleted, and must not be deleted.** Without it the deny
would be the platform default for `targetSdk >= 28` — and both modules take `targetSdk`
from the Flutter SDK (`targetSdk = flutter.targetSdkVersion`) rather than pinning it, so
the protection would rest on a number nobody in this repository chose. `minSdk` is pinned
to 24 in both `build.gradle.kts` files because the attribute is ignored below API 24.

The consequence for every release build is the one stated above: the `--dart-define`
origin must be `https://`. There is no cleartext exception left to fall back on, in
either app, on either platform.

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
`/var/lib/monhorus`. **These commands are now scheduled and scripted — see section 12**,
which supersedes the manual procedure here and adds retention, a disk-space guard and a
rehearsed restore. Run the ad-hoc commands above only for a one-off dump outside the timer.

### That dump is not a point-in-time snapshot

The command above — and the nightly one, as it runs today — has no `--oplog`. mongod is a
replica set and the API keeps serving through the 02:30 window, so mongodump reads the
collections one after another and the archive is a **smear across the dump's duration**,
not a picture of one instant. A restore of it can hold a row that references a document
written after that document's own collection had already been read. For a database whose
audit rows point at other documents, that is a real inconsistency, not a theoretical one.

`--oplog` closes it: mongodump captures every write made *during* the dump, and
`mongorestore --oplogReplay` applies them afterwards so the restore lands on a single
instant. **It cannot simply be added to the command above.** Two prerequisites, both
confirmed against `mongodump`/`mongorestore` 100.14.0 and a MongoDB 8.2 replica set:

| Prerequisite | Why | What you get without it |
|---|---|---|
| The dump must cover the **whole instance** | A URI with a database path (`…/monhorus?authSource=…`) is a `--db` dump | `Failed: bad option: --oplog mode only supported on full dumps` |
| The credential must read `local.oplog.rs` **and** `config.transactions` | `monhorusApp` is `readWrite` on `monhorus` only | `Failed: error getting oplog start: config.transactions.findOne error: (Unauthorized) not authorized on config` |

So `backup-monhorus.sh` **probes for both before it dumps** and does not assume either. If
the probe passes it dumps the instance with `--oplog` and logs
`oplog  yes -- full-instance point-in-time dump`. If it fails it takes exactly the dump it
has always taken and logs `oplog  NO -- <reason>` followed by a warning that the archive is
not point-in-time. The backup still happens: refusing to dump because a credential lacks a
role would be the worse of the two failures. What it will not do is stay quiet about it.

`OPLOG=1` in `/etc/monhorus/backup.env` makes the missing capability fatal instead
(`NO BACKUP WAS TAKEN`); `OPLOG=0` accepts the smear and stops logging the warning.

**To turn point-in-time backups on**, give the backup its own credential — the built-in
`backup` role is exactly the grant, and it is read-only, so it cannot be used to restore:

```bash
mongosh --port 27017 -u monhorusAdmin --authenticationDatabase admin --eval '
  db.getSiblingDB("admin").createUser({
    user: "monhorusBackup", pwd: "<PASSWORD>",
    roles: [{ role: "backup", db: "admin" }] })'
```

Then add the URI to `/etc/monhorus/backup.env` — **with no database in the path**. The
systemd unit already reads that file and the script prefers it over `backend.env`, so no
unit edit is needed:

```ini
MONGODB_URI=mongodb://monhorusBackup:<PASSWORD>@127.0.0.1:27017/?authSource=admin&replicaSet=rs0
```

Confirm from the journal that the next run says `oplog  yes`, and that the closing line
reads `db archive: point-in-time (--oplog)`.

**Know what you are turning on before you do.** An `--oplog` archive is a full-instance
dump, and it changes what a restore of it touches:

- **It contains every database on the host, `admin` included.** `mongorestore` refuses
  `--oplogReplay` alongside any `--nsExclude` (`cannot use --oplogReplay with excludes
  specified`), so a real production restore of one **also restores `admin.system.users`**.
  A mongod password rotated since the backup reverts to the old one, and the backend's
  `MONGODB_URI` stops authenticating until it is rotated again. There is no way around
  this in mongorestore; it is a consequence of the format, and it is why section 12's
  rollback note matters.
- **The archive is larger**, by `admin` and `config` — a few hundred KB, not a factor.
- **Restoring one needs a write-capable credential.** The `backup` role is read-only; use
  `monhorusAdmin` (or a `restore`-role user) for `restore-monhorus.sh`, not the backup user.
- **Rehearsals cannot replay the oplog at all** — see section 12.

Archives taken before this is switched on carry no oplog, and `restore-monhorus.sh` detects
that and restores them exactly as it always has. Nothing already in `/var/backups/monhorus`
becomes unrestorable.

---

## 10. Verification

The TLS origin is what the web bundle and both current APKs are built against, so it is
the one that has to answer. The legacy IP-and-port sites are checked as well because
handsets carrying a pre-2026-08-13 build still depend on them (section 1). Both vhosts
front the same backend, so a path that answers on `:3020` and 404s over TLS means the
`:443` vhost is missing a proxy rule — and every current build talks only to `:443`.

```bash
# /health answers for its dependencies now: 200 only when Mongo is connected AND answered
# a command just then, 503 with a Mongolian reason otherwise. Read the body, not just the
# code -- data.database carries state, ping, pingMs, replicaSet and isPrimary.
curl -s -w '\n%{http_code}\n' https://monhorus.itsystem.mn/health   # 200 + "status":"ok"
curl -s -o /dev/null -w '%{http_code}\n' https://monhorus.itsystem.mn/any/deep/route  # 200 = SPA fallback
curl -s -o /dev/null -w '%{http_code}\n' https://monhorus.itsystem.mn/apk/            # 200 = APK page

curl -s http://103.87.255.221:3020/health                    # timezone echo proves env loaded
curl -s -o /dev/null -w '%{http_code}\n' http://103.87.255.221:3020/any/deep/route   # 200 = SPA fallback
curl -s -o /dev/null -w '%{http_code}\n' http://103.87.255.221:3021/                 # 200 = APK page
```

**These next calls go over TLS, not the legacy origin.** The unauthenticated probes above
deliberately hit `http://103.87.255.221:3020`, because pre-2026-08-13 handsets still
depend on it. These do not: until 2026-09-04 this step posted a real admin password, and
then carried the bearer token it returned, in clear text over the same plain-HTTP origin
that section 6 greps the web bundle to *exclude* twelve lines earlier. Both vhosts front
the same backend, so the TLS origin proves exactly as much.

Login, and note the token path — **`data.tokens.accessToken`**, not `data.accessToken` as
`DEPLOYMENT_UBUNTU.md` §13 states:

```bash
TOKEN=$(curl -s -X POST https://monhorus.itsystem.mn/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"..."}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.tokens.accessToken')
curl -s https://monhorus.itsystem.mn/api/v1/auth/me -H "Authorization: Bearer $TOKEN"
```

Health of the deeper invariants:

```bash
mongosh --quiet "$MONGODB_URI" --eval 'rs.status().myState'   # 1 = PRIMARY; transactions real
sudo journalctl -u monhorus-api | grep -iE "schema indexes|default permissions|does not support transactions"
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

---

## 12. Scheduled backups, and a restore that has actually been run

This supersedes the "Nothing is scheduled yet" note in section 9 — those commands are now
in `scripts/backup-monhorus.sh` and a systemd timer runs them. Section 9 remains accurate
as the description of *what* is dumped and why both halves travel together.

The audit finding this closes was not "there is no backup command". It was that nothing
ran the command and **nobody had ever restored from one**. An untested backup is a belief,
not a control. Rehearse the restore before you need it — the procedure at the end of this
section takes ten minutes and does not touch production.

### Install

Four files, all from `scripts/` in the repository:

```bash
# On the workstation
scp scripts/backup-monhorus.sh scripts/restore-monhorus.sh \
    scripts/monhorus-backup.service scripts/monhorus-backup.timer \
    its@103.87.255.221:/tmp/

# On the host
sudo install -m 0750 -o root -g root /tmp/backup-monhorus.sh  /usr/local/sbin/
sudo install -m 0750 -o root -g root /tmp/restore-monhorus.sh /usr/local/sbin/
sudo install -m 0644 -o root -g root /tmp/monhorus-backup.service /etc/systemd/system/
sudo install -m 0644 -o root -g root /tmp/monhorus-backup.timer   /etc/systemd/system/
sudo mkdir -p /var/backups/monhorus && sudo chmod 0700 /var/backups/monhorus

sudo systemctl daemon-reload
sudo systemctl enable --now monhorus-backup.timer
```

`ExecStart` is the absolute path `/usr/local/sbin/backup-monhorus.sh`, so the units only
work once the scripts are installed there. `0750 root:root` is deliberate — the script
reads `/etc/monhorus/backend.env`, and nothing that is not root has any business running
it.

Enable the **timer**, never the service. The service has no `[Install]` section on
purpose; it is a `Type=oneshot` job that exists to be triggered.

### Verify the timer is armed

```bash
systemctl list-timers monhorus-backup.timer --all
```

`NEXT` must be a real date and `LEFT` must count down. A timer that is loaded but not
enabled shows no `NEXT` — that is the failure mode to look for, because everything else
about it looks healthy.

Force one run immediately rather than waiting until 02:30, and read the result:

```bash
sudo systemctl start monhorus-backup.service     # blocks; oneshot
systemctl status monhorus-backup.service --no-pager
sudo journalctl -u monhorus-backup -n 40 --no-pager
ls -lh /var/backups/monhorus/
```

A good run ends with `ok  db=… uploads=… (N files)` and the unit at
`Active: inactive (dead)` with `status=0/SUCCESS`. Any failure exits non-zero, so
`systemctl status` shows `failed` and the reason is the last line in the journal. The
whole reason the script exits non-zero on a half-failure is so this stays true.

### Schedule and retention

| | |
|---|---|
| When | daily 02:30 local, plus up to 30 min of random delay |
| Missed runs | `Persistent=true` — a run missed while the host was down fires on boot |
| Kept | 14 days, then pruned |
| Where | `/var/backups/monhorus`, mode 0700, archives 0600 |
| Names | `db-<date>-<time>.archive.gz`, `uploads-<date>-<time>.tar.gz` |

`RandomizedDelaySec` is not cosmetic on this box: four other sites and a PostgreSQL share
the disk, and starting every nightly job on the same minute is how a 1.6 GB host falls
over.

Overrides go in `/etc/monhorus/backup.env` — the unit reads it, so a re-install of the
script cannot revert them:

```ini
BACKUP_DIR=/mnt/offhost/monhorus
RETENTION_DAYS=21
MIN_FREE_MB=768
```

**14 days is a disk decision, not a policy decision.** The root filesystem runs 83–88%
full. Before raising retention, measure: `du -sh /var/backups/monhorus` and
`df -h /`. The script refuses to dump when the estimate does not fit and says so in the
journal — `insufficient disk space … NO BACKUP WAS TAKEN` — which is the one message in
this system that must never be ignored, because it means the retention window is quietly
ageing out with nothing replacing it.

**Everything is on one disk.** These archives protect against a bad deploy, a wrong
`deleteMany` and a corrupted collection. They protect against nothing that destroys the
host. Pointing `BACKUP_DIR` at an off-host mount is the single largest remaining
improvement, and the script was written so that it is a one-line change.

### Restore

```bash
sudo /usr/local/sbin/restore-monhorus.sh 2026-08-13 --confirm
```

The argument is a date, a full stamp, `latest`, or a path to either archive; the script
finds the matching pair and refuses to proceed if one half is missing. Without
`--confirm` it prints what it would destroy and exits 2.

It reads `MONGODB_URI` from `/etc/monhorus/backend.env`, which is the application user.
That is enough for any archive taken today. **Once section 9's `--oplog` backups are
switched on it is not** — a full-instance archive writes into `admin` as well, which
`monhorusApp` cannot do and the read-only `backup` user cannot either. Restore those with
an administrative credential:

```bash
sudo MONGODB_URI='mongodb://monhorusAdmin:<PASSWORD>@127.0.0.1:27017/monhorus?authSource=admin&replicaSet=rs0' \
     /usr/local/sbin/restore-monhorus.sh latest --confirm
```

What it does, in order: stops `monhorus-api` → takes a `pre-restore-*.archive.gz` of the
current database → `mongorestore --drop` → extracts the uploads → `chown -R
monhorus:monhorus` and sets dirs `0750`, files `0640` → starts `monhorus-api`. The service
is restarted even if the restore fails partway.

Four things to know before you rely on it:

- **Whether the restore is point-in-time depends on the archive.** The script asks the
  archive rather than assuming: it probes with `mongorestore --dryRun --oplogReplay`, which
  writes nothing, and adds `--oplogReplay` only when an oplog is actually there. An archive
  taken before section 9's `--oplog` change has none, and passing `--oplogReplay` to one is
  a hard failure (`no oplog file to replay; make sure you run mongodump with --oplog`) —
  which is precisely why it is detected rather than assumed. The journal says which you got:
  `oplog  replaying`, or `oplog  none in this archive -- restoring as-is, NOT point-in-time`.
- **`--drop` only drops what the archive contains.** A collection created after the
  backup survives the restore. Usually harmless; occasionally the explanation for
  behaviour that makes no sense afterwards.
- **Uploads are extracted as an overlay, not a wipe.** Files added since the backup are
  left in place rather than deleted — the safer default when the archive is the only copy
  and the disk has no room for a second one. The script reports the count difference.
- **`sync-indexes` is mandatory afterwards.** `config/database.ts` uses
  `autoIndex: !isProduction`, so nothing rebuilds indexes on boot. `mongorestore`
  restores the index set *as of the backup*, which is older than the deployed schema by
  every release since. The script prints the exact commands (section 5) when it finishes.
  Note that the restore script restarts `monhorus-api` itself: if any index added since
  the backup was a **unique** one, that restart will fail the boot check and the service
  will stay down until `sync-indexes` has been run. Run it before assuming the restore
  broke something. A missing ordinary index only makes queries slow, and for those the
  boot warning in the journal is the only thing that will tell you.

### Rehearse it — before you need it

This is the part that closes the finding. It runs against production data on the
production host and touches neither the live database nor the live uploads:

```bash
sudo mkdir -p /tmp/restore-rehearsal
sudo /usr/local/sbin/restore-monhorus.sh latest --confirm \
     --db monhorus_rehearsal \
     --uploads-dir /tmp/restore-rehearsal \
     --owner root:root \
     --no-service --no-pre-dump
```

`--db` remaps the namespace, `--uploads-dir` redirects the files and `--no-service` leaves
the API running. Then check what came back:

**A rehearsal never replays the oplog, and cannot.** `mongorestore` refuses the
combination outright — `cannot use --oplogReplay with namespace renames specified` — so a
`--db`-remapped restore reproduces the dump's own smear rather than the point-in-time
state, whatever the archive holds. The script says so in the journal rather than leaving
you to infer it. This is a limit on what a rehearsal can prove, not a fault in the
archive: the un-remapped production restore does replay it.

Two things the script does automatically when rehearsing a full-instance (`--oplog`)
archive, both of which matter:

- **`admin.*` and `config.*` are excluded from the source.** A full-instance archive
  carries this host's database users, and a rehearsal that restored them would rewrite the
  live instance's credentials while claiming to touch nothing. Excluded, it cannot.
- **The target database name is excluded from the source too.** A full-instance archive
  taken while a previous `monhorus_rehearsal` was still lying around contains that database
  as well, and remapping `monhorus.*` onto it collides with its own stale copy —
  `Failed: cannot restore with conflicting namespace destinations`. This is why the
  clean-up below is a prerequisite for the *next* rehearsal, not just tidiness. The script
  now excludes it so a forgotten drop cannot fail the run, but drop it anyway: the disk
  does not have room for a spare copy of the database either.

```bash
mongosh --quiet "mongodb://127.0.0.1:27017/monhorus_rehearsal?replicaSet=rs0" --eval '
  db.getCollectionNames().forEach(c => print(c + " " + db[c].countDocuments({})))'
find /tmp/restore-rehearsal -type f | wc -l
```

Compare the counts against the live database. When satisfied, clean up — the rehearsal
copy is a second full set of uploads on a disk that does not have room for one:

```bash
sudo rm -rf /tmp/restore-rehearsal
mongosh --quiet "mongodb://127.0.0.1:27017/monhorus_rehearsal?replicaSet=rs0" \
  --eval 'db.dropDatabase()'
```

Do this after any change to the schema, the upload path or the Mongo version, and record
the date here when you do. **The first time these scripts run must not be the day the
database is gone.**

### Verified 2026-08-13

The full cycle was proven before these scripts were committed — MongoDB 8.2 single-node
replica set, `mongodump`/`mongorestore` 100.14.0, throwaway database and uploads tree:
backup taken, database dropped outright and the uploads directory deleted, restore run,
and all documents, indexes and files came back — the four files byte-identical by
`sha256`. The disk-space abort, the 14-day prune, the `--confirm` refusal and the
namespace remap were each exercised separately.

Two findings from that rehearsal are worth keeping:

- Restoring into a differently-named uploads directory originally extracted over the
  *real* one, because a tar archive carries the directory name it was made from. The
  script now extracts with `--strip-components=1` into the target directory. This is why
  rehearsals happen on a throwaway copy.
- Sourcing `/etc/monhorus/backend.env` to read `MONGODB_URI` was confirmed to yield an
  empty string when the value is unquoted, exactly as section 3 warns. Both scripts parse
  the file with `grep` instead and never let the shell interpret the value.

Not verified: the systemd units have never been loaded by a running systemd (they were
written and syntax-checked on macOS). Run the `list-timers` and manual-start checks above
on the host the first time, and do not assume the timer is armed until `NEXT` shows a
date.

**This sign-off covers the archive format as it stands today, and only that.** The
2026-09-07 change in section 9 leaves that format untouched *until someone creates the
`backup`-role credential* — the probe fails on the current application user, so the nightly
dump is byte-for-byte the one this rehearsal proved. The day that credential is added the
archive becomes a full-instance `--oplog` dump, which is a **different shape**: it carries
`admin.*`, a production restore of it rewrites `admin.system.users`, and it needs a
write-capable credential to restore. *That* is a change to the schema and the Mongo
handling of the kind the paragraph above says to re-rehearse after, and this record does
not cover it. Re-run the rehearsal against the first `--oplog` archive before relying on
one, and sign it off below. Whether the existing entry stands until then is the operator's
call, not this document's.
