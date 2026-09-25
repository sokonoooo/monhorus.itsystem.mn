#!/usr/bin/env bash
#
# Monhorus production backup: the MongoDB database AND the uploads tree, in one run.
#
#   backup-monhorus.sh
#
# Both halves or neither. /var/lib/monhorus/uploads is the only copy of every file the
# system has ever been given -- there is no S3, no object store, no second host. A dump
# taken without its files restores a system whose every attachment 404s, so this script
# treats a failure of either half as a failure of the whole run and exits non-zero, which
# is what makes `systemctl status monhorus-backup` and `journalctl -u monhorus-backup`
# tell the truth.
#
# Everything is overridable from the environment so the destination can be moved off-host
# (an NFS/sshfs mount at BACKUP_DIR) without editing this file. The systemd unit reads
# /etc/monhorus/backup.env, which is the place to put those overrides.
#
#   BACKUP_DIR      where archives land            (default /var/backups/monhorus)
#   RETENTION_DAYS  archives older than this go    (default 14)
#   KEEP_MIN_RUNS   nightly runs kept regardless of age (default 3). The floor that stops
#                   a long failure streak from emptying the directory -- see "Prune" below.
#   MIN_FREE_MB     headroom to leave on the disk  (default 512)
#   ENV_FILE        source of MONGODB_URI/UPLOAD_DIR (default /etc/monhorus/backend.env)
#   MONGODB_URI     overrides the value in ENV_FILE
#   UPLOAD_DIR      overrides the value in ENV_FILE
#   SKIP_SPACE_CHECK=1  bypass the pre-flight disk estimate (know why before you do)
#   VERIFY_DB=0     skip the database archive's integrity check (know why before you do)
#   OPLOG           auto (default) | 1 = require | 0 = never. See "Point-in-time" below.
#   HEARTBEAT_URL   pinged on success. The dead-man switch -- see "Heartbeat" below.
#
# Failure is notified by systemd, not by this script: monhorus-backup.service names
# monhorus-backup-failure.service in OnFailure=, which runs monhorus-backup-notify.sh.
# ALERT_WEBHOOK_URL in /etc/monhorus/backup.env is what makes that alert reach a human;
# with it unset nothing is delivered and the notifier says so loudly rather than passing.
#
# The host disk runs 83-88% full. Retention and the pre-flight space check are not
# decoration: a dump that fills the last gigabyte takes the API, mongod and four
# neighbouring sites down with it.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/monhorus}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
KEEP_MIN_RUNS="${KEEP_MIN_RUNS:-3}"
MIN_FREE_MB="${MIN_FREE_MB:-512}"
ENV_FILE="${ENV_FILE:-/etc/monhorus/backend.env}"
OPLOG_MODE="${OPLOG:-auto}"

TS="$(date +%F-%H%M%S)"
DB_ARCHIVE="$BACKUP_DIR/db-$TS.archive.gz"
UPLOADS_ARCHIVE="$BACKUP_DIR/uploads-$TS.tar.gz"

log() { printf '%s  %s\n' "$(date +'%F %T')" "$*"; }
die() { printf '%s  ERROR: %s\n' "$(date +'%F %T')" "$*" >&2; exit 1; }

# Partial archives are worse than absent ones: they look like a backup until the day you
# need them. Write to .partial and rename only once the tool has exited 0, and sweep the
# partials on any abort.
cleanup() {
  local rc=$?
  rm -f -- "$DB_ARCHIVE.partial" "$UPLOADS_ARCHIVE.partial"
  if [ "$rc" -ne 0 ]; then
    printf '%s  backup FAILED (exit %s)\n' "$(date +'%F %T')" "$rc" >&2
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Do NOT `. /etc/monhorus/backend.env`. MONGODB_URI contains `&replicaSet=rs0`; sourcing
# it unquoted backgrounds the assignment at the `&` and the variable comes back empty --
# the same trap documented in section 3 of the runbook. Read the line, strip one layer of
# quoting, never let the shell interpret it.
read_env_var() {
  local key="$1" file="$2" line value
  [ -r "$file" ] || return 1
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" | tail -n 1 || true)"
  [ -n "$line" ] || return 1
  value="${line#*=}"
  value="${value%$'\r'}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

# mongodump treats a database in the URI path exactly as --db, and --oplog is refused on
# anything but a full-instance dump. Strip the path, keep the query -- losing
# ?replicaSet=rs0 would connect direct to the node and defeat the read preference. Same
# helper, same reasoning, as restore-monhorus.sh.
uri_strip_db() {
  local uri="$1" scheme rest query authority
  scheme="${uri%%://*}"; rest="${uri#*://}"
  query=""
  case "$rest" in *\?*) query="?${rest#*\?}"; rest="${rest%%\?*}" ;; esac
  authority="${rest%%/*}"
  printf '%s://%s/%s' "$scheme" "$authority" "$query"
}

# Can this credential, on this instance, take an --oplog dump? Answers on stdout: nothing
# on success, the reason on failure. Cheap, read-only, and asked before anything is
# written -- the alternative is discovering it from a failed dump at 02:30.
oplog_probe() {
  local uri="$1" out
  command -v mongosh >/dev/null 2>&1 || { printf 'mongosh absent, cannot verify oplog access'; return 1; }
  out="$(mongosh --quiet "$uri" --eval '
    try {
      if (!db.hello().setName) { print("NO:not a replica set member"); quit(0); }
      db.getSiblingDB("local").getCollection("oplog.rs").find().limit(1).toArray();
      db.getSiblingDB("config").getCollection("transactions").find().limit(1).toArray();
      print("YES");
    } catch (e) { print("NO:" + (e.codeName || e.message)); }' 2>/dev/null || true)"
  out="$(printf '%s' "$out" | tr -d '\r' | tail -n 1)"
  case "$out" in
    YES)  return 0 ;;
    NO:*) printf '%s' "${out#NO:}"; return 1 ;;
    *)    printf 'probe returned no answer (mongosh could not connect)'; return 1 ;;
  esac
}

if [ -z "${MONGODB_URI:-}" ] || [ -z "${UPLOAD_DIR:-}" ]; then
  [ -r "$ENV_FILE" ] || die "cannot read $ENV_FILE (run as root, or set MONGODB_URI and UPLOAD_DIR)"
fi
MONGODB_URI="${MONGODB_URI:-$(read_env_var MONGODB_URI "$ENV_FILE" || true)}"
UPLOAD_DIR="${UPLOAD_DIR:-$(read_env_var UPLOAD_DIR "$ENV_FILE" || true)}"

[ -n "$MONGODB_URI" ] || die "MONGODB_URI is empty -- not set in the environment and not found in $ENV_FILE"
[ -n "$UPLOAD_DIR" ]  || die "UPLOAD_DIR is empty -- not set in the environment and not found in $ENV_FILE"
[ -d "$UPLOAD_DIR" ]  || die "UPLOAD_DIR '$UPLOAD_DIR' is not a directory"

command -v mongodump >/dev/null 2>&1 || die "mongodump not found (apt install mongodb-database-tools)"

# The database archive's integrity check needs gzip, so it is a pre-flight requirement
# and not a discovery made after the dump. Checked here, before anything is written, so
# an unusable verifier aborts the run cleanly rather than stranding a half-finished one
# whose db archive nothing can vouch for. gzip is also what tar -czf uses below.
if [ "${VERIFY_DB:-1}" != "0" ]; then
  command -v gzip >/dev/null 2>&1 \
    || die "gzip not found -- it is needed to compress the uploads archive and to integrity-check the database archive. Install it, or set VERIFY_DB=0 to take an UNVERIFIED backup. NO BACKUP WAS TAKEN."
fi

UPLOAD_PARENT="$(cd "$(dirname "$UPLOAD_DIR")" && pwd)"
UPLOAD_NAME="$(basename "$UPLOAD_DIR")"

mkdir -p -- "$BACKUP_DIR"
chmod 0700 -- "$BACKUP_DIR" 2>/dev/null || true

log "backup start  ts=$TS  dest=$BACKUP_DIR  retention=${RETENTION_DAYS}d"
log "uploads       $UPLOAD_DIR"

# ---------------------------------------------------------------------------
# Prune first, but never below a floor
# ---------------------------------------------------------------------------
# Expired archives are expired whether or not tonight's run succeeds, and reclaiming
# their space before the dump is what lets a nearly-full disk keep backing itself up.
# That ordering is deliberate and stays.
#
# What does NOT hold -- and what this comment claimed until it was measured -- is that a
# failure after this point still leaves RETENTION_DAYS-1 days of history. It leaves that
# much only while the last SUCCESS is inside the window. Once the backup has been failing
# for longer than RETENTION_DAYS every archive on disk is expired, and an age-only prune
# deletes all of them: on the fifteenth consecutive failure this loop empties the
# directory it exists to fill, and the timer still reports itself armed. Demonstrated at
# RETENTION_DAYS=14 against 15 nightly pairs plus a pre-restore dump -- 31 files in, 0 out.
#
# So age is no longer the only rule. KEEP_MIN_RUNS of each nightly family survive
# regardless of age. In the healthy case the floor never binds -- fourteen runs on disk,
# the fifteenth expires, thirteen remain -- so the space argument above is untouched. It
# binds only when everything on disk is already expired, which is exactly the case where
# there is almost nothing left to reclaim anyway, so the trade the prune-first ordering
# was making has already lost its value by then.
#
# The floor binding is itself the alarm. It cannot happen unless no backup has succeeded
# in RETENTION_DAYS, which makes it a better failure detector than the prune was, so it
# is logged as loudly as it deserves rather than passing quietly.
#
# pre-restore-*.archive.gz is deliberately outside the floor. It is the rollback for one
# specific manual restore, not a copy of the system's history, and pinning those on a disk
# at 88% forever is the worse trade.
pruned=0
held=0

# Protect the newest $2 by NAME, not by mtime: the names carry a sortable %F-%H%M%S stamp,
# so `sort` is chronological, and a copy or a touch cannot re-order what is protected.
prune_family() {
  local pattern="$1" keep="$2" label="$3"
  local -a all=() keepers=()
  local file k start is_protected

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    all+=("$file")
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$pattern" 2>/dev/null | sort)

  [ "${#all[@]}" -gt 0 ] || return 0

  if [ "$keep" -gt 0 ]; then
    start=$(( ${#all[@]} - keep ))
    if [ "$start" -lt 0 ]; then start=0; fi
    keepers=("${all[@]:$start}")
  fi

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    is_protected=0
    for k in ${keepers[@]+"${keepers[@]}"}; do
      if [ "$k" = "$file" ]; then is_protected=1; break; fi
    done
    if [ "$is_protected" -eq 1 ]; then
      log "keep          $(basename "$file")  (past retention, held by the ${label} floor of ${keep})"
      held=$((held + 1))
      continue
    fi
    log "prune         $(basename "$file")"
    rm -f -- "$file"
    pruned=$((pruned + 1))
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$pattern" \
             -mtime "+$RETENTION_DAYS" 2>/dev/null | sort)
}

prune_family 'db-*.archive.gz'          "$KEEP_MIN_RUNS" 'database'
prune_family 'uploads-*.tar.gz'         "$KEEP_MIN_RUNS" 'uploads'
prune_family 'pre-restore-*.archive.gz' 0                'pre-restore'

log "pruned        $pruned archive(s) older than ${RETENTION_DAYS} days, held $held by the floor"

# Not one archive on this disk is inside the retention window. Only a failure streak
# longer than RETENTION_DAYS produces that, so say so in the words an operator needs.
fresh_db="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'db-*.archive.gz' \
              ! -mtime "+$RETENTION_DAYS" 2>/dev/null | wc -l | tr -d ' ')"
if [ "$held" -gt 0 ] && [ "$fresh_db" -eq 0 ]; then
  log "WARNING       every archive in $BACKUP_DIR is past its retention date. The nightly"
  log "              backup has not succeeded in ${RETENTION_DAYS} days and nobody acted."
  log "              KEEP_MIN_RUNS=${KEEP_MIN_RUNS} is the only reason anything is left --"
  log "              these are the last copies of this system's data. Check why:"
  log "                journalctl -u monhorus-backup --since '-${RETENTION_DAYS} days'"
  log "              and check that ALERT_WEBHOOK_URL in /etc/monhorus/backup.env works."
fi

# ---------------------------------------------------------------------------
# Pre-flight: is there room?
# ---------------------------------------------------------------------------
# Estimate, conservatively: uploads are photographs and PDFs that gzip barely touches, so
# budget their full size. The BSON dump does compress -- a factor of 4 is pessimistic in
# practice -- and MIN_FREE_MB is headroom the disk keeps regardless. Better to abort with
# a legible message than to discover the shortfall by filling the root filesystem.
if [ "${SKIP_SPACE_CHECK:-0}" != "1" ]; then
  avail_kb="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
  uploads_kb="$(du -sk "$UPLOAD_DIR" | awk '{print $1}')"

  db_kb=0
  if command -v mongosh >/dev/null 2>&1; then
    db_bytes="$(mongosh --quiet "$MONGODB_URI" \
      --eval 'const s = db.stats(); print(s.dataSize + s.indexSize)' 2>/dev/null || true)"
    case "$db_bytes" in
      ''|*[!0-9]*) log "db size       unknown (mongosh query failed) -- estimating from uploads only" ;;
      *)           db_kb=$(( db_bytes / 1024 / 4 )) ;;
    esac
  else
    log "db size       unknown (mongosh absent) -- estimating from uploads only"
  fi

  required_kb=$(( uploads_kb + db_kb + MIN_FREE_MB * 1024 ))
  log "space         need ~$((required_kb / 1024)) MB, have $((avail_kb / 1024)) MB free on $BACKUP_DIR"

  if [ "$avail_kb" -lt "$required_kb" ]; then
    die "insufficient disk space: need ~$((required_kb / 1024)) MB (uploads $((uploads_kb / 1024)) MB + dump estimate $((db_kb / 1024)) MB + ${MIN_FREE_MB} MB headroom), only $((avail_kb / 1024)) MB free. Lower RETENTION_DAYS, point BACKUP_DIR off-host, or free space. NO BACKUP WAS TAKEN."
  fi
fi

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
# Point-in-time, or not.
#
# Without --oplog mongodump reads the collections one after another while the API keeps
# serving, so the archive is a smear across the minute or two the dump takes rather than a
# picture of one instant. A restore can then hold an audit row referencing a document
# written after that document's own collection had already been read. --oplog closes the
# gap: mongodump captures every write made *during* the dump and mongorestore --oplogReplay
# applies them afterwards, landing the restore on a single consistent instant.
#
# It cannot simply be switched on here. Two prerequisites, both confirmed against
# mongodump 100.14.0 and a MongoDB 8.2 replica set:
#
#   1. The dump must cover the whole instance. MONGODB_URI names a database
#      (.../monhorus?authSource=monhorus&replicaSet=rs0) and a URI with a database path is
#      a --db dump, which mongodump refuses outright:
#          Failed: bad option: --oplog mode only supported on full dumps
#      Hence uri_strip_db above.
#   2. The credential must read local.oplog.rs and config.transactions. The application
#      user this deployment documents is readWrite on monhorus alone and gets:
#          Failed: error getting oplog start: config.transactions.findOne error:
#          (Unauthorized) not authorized on config to execute command
#      MongoDB's built-in `backup` role is exactly the grant that satisfies both reads.
#
# So it is opt-in by capability rather than by assumption: probe, and if the answer is no,
# take the dump this script has always taken and say so in the journal in as many words.
# Refusing to back up at all because a credential lacks a role would be the worse failure
# of the two -- but a quieter backup that does not announce itself is the failure this
# whole script is written against, so it announces itself. OPLOG=1 makes it fatal instead.
#
# To turn it on, put a backup-role credential in /etc/monhorus/backup.env, which the
# systemd unit already reads and which overrides the value in backend.env:
#     mongosh --port 27017 -u monhorusAdmin --authenticationDatabase admin --eval \
#       'db.getSiblingDB("admin").createUser({user:"monhorusBackup",pwd:"<PW>",
#          roles:[{role:"backup",db:"admin"}]})'
#     # /etc/monhorus/backup.env
#     MONGODB_URI="mongodb://monhorusBackup:<PW>@127.0.0.1:27017/?authSource=admin&replicaSet=rs0"
#
# Read section 9 of DEPLOYMENT_MONHORUS_PROD.md before doing so: an --oplog archive is a
# full-instance dump, and mongorestore forbids --oplogReplay together with any --nsExclude,
# so a production restore of one also rewrites admin.system.users.
DUMP_URI="$MONGODB_URI"
dump_args=(--archive="$DB_ARCHIVE.partial" --gzip --quiet)
oplog_note="not point-in-time"

if [ "$OPLOG_MODE" = "0" ]; then
  log "oplog         disabled (OPLOG=0) -- archive is not a point-in-time snapshot"
else
  instance_uri="$(uri_strip_db "$MONGODB_URI")"
  if oplog_reason="$(oplog_probe "$instance_uri")"; then
    DUMP_URI="$instance_uri"
    dump_args+=(--oplog)
    oplog_note="point-in-time (--oplog)"
    log "oplog         yes -- full-instance point-in-time dump"
  elif [ "$OPLOG_MODE" = "1" ]; then
    die "OPLOG=1 was requested but this dump cannot carry an oplog: ${oplog_reason}. Give the backup credential the built-in 'backup' role and put it in MONGODB_URI in /etc/monhorus/backup.env, or unset OPLOG. NO BACKUP WAS TAKEN."
  else
    log "oplog         NO -- ${oplog_reason}"
    log "WARNING       this archive is NOT a point-in-time snapshot. Collections are read"
    log "              sequentially while the API keeps writing, so a restore of it can"
    log "              contain a row referencing a document whose collection was dumped"
    log "              before that document existed. To fix, give the backup credential the"
    log "              built-in 'backup' role and set MONGODB_URI in /etc/monhorus/backup.env"
    log "              -- section 9 of DEPLOYMENT_MONHORUS_PROD.md has the commands and the"
    log "              consequences. Set OPLOG=0 to accept it and stop logging this."
  fi
fi

log "mongodump     -> $(basename "$DB_ARCHIVE")  [$oplog_note]"
mongodump --uri="$DUMP_URI" "${dump_args[@]}" \
  || die "mongodump failed"
[ -s "$DB_ARCHIVE.partial" ] || die "mongodump produced an empty archive"

# Cheap proof the archive is complete -- the exact counterpart of the tar -tzf the uploads
# half has always had, and which the database half went without.
#
# A non-zero byte count is not that proof. An archive truncated by a full disk is
# non-empty, so it was renamed to its final name and counted as a good backup until the
# day it was needed. On a disk that runs 83-88% full that is not a theoretical shape.
#
# mongodump --archive --gzip writes ONE gzip stream (magic 1f8b), so `gzip -t` walks it
# end to end and checks the CRC32 and length in the trailer. That catches a truncated or
# corrupted write, works identically for both archive shapes -- --oplog and not -- and
# needs no server, no credential and no network, so it cannot touch the live database and
# cannot be told to.
#
# NOT mongorestore --dryRun, which is the obvious candidate and does not work. Measured
# against mongorestore 100.14.0 and MongoDB 8.2.3: --dryRun never reads the archive body,
# so it exits 0 on archives truncated to HALF their length, in both shapes --
#     plain.trunc50 exit=0    oplog.trunc50 exit=0   "0 document(s) restored successfully"
# -- and would have been a check that always passes. It short-circuits before the
# demultiplexer runs. Do not "restore" it here.
#   (restore-monhorus.sh:159 uses --dryRun only to ask whether an oplog is PRESENT. That
#   is answered from the prelude, so it is unaffected by this and stays as it is.)
#
# The other reason to prefer gzip over a mongorestore-based check: gzip cannot mistake a
# connection failure for a corrupt archive. Conflating those is the exact fault this audit
# found in archive_has_oplog, and a verifier that fails spuriously would throw away good
# backups. So there is nothing here to classify -- gzip -t answers about the file alone.
if [ "${VERIFY_DB:-1}" = "0" ]; then
  log "WARNING       VERIFY_DB=0 -- this database archive is NOT integrity-checked. A dump"
  log "              truncated by a full disk will be renamed to its final name and"
  log "              counted as a good backup. Unset VERIFY_DB to restore the check."
else
  log "verify        gzip -t $(basename "$DB_ARCHIVE")"
  gzip -t -- "$DB_ARCHIVE.partial" \
    || die "the database archive failed its integrity check: the gzip stream is truncated or corrupt, which is what a full disk produces. The partial has been discarded and NO USABLE DUMP WAS TAKEN -- the previous archives are untouched. Disk now: $(df -Ph "$BACKUP_DIR" | awk 'NR==2 {print $5 " used, " $4 " free"}')"
fi

mv -f -- "$DB_ARCHIVE.partial" "$DB_ARCHIVE"

# ---------------------------------------------------------------------------
# Uploads
# ---------------------------------------------------------------------------
log "tar uploads   -> $(basename "$UPLOADS_ARCHIVE")"
tar -czf "$UPLOADS_ARCHIVE.partial" -C "$UPLOAD_PARENT" "$UPLOAD_NAME" \
  || die "tar of $UPLOAD_DIR failed"
[ -s "$UPLOADS_ARCHIVE.partial" ] || die "tar produced an empty archive"

# Cheap proof the gzip stream is complete and the member list is readable. It is not a
# restore rehearsal -- only section 12 of the runbook is -- but it catches a truncated
# write, which is the failure a full disk actually produces.
tar -tzf "$UPLOADS_ARCHIVE.partial" >/dev/null || die "uploads archive is unreadable"
mv -f -- "$UPLOADS_ARCHIVE.partial" "$UPLOADS_ARCHIVE"

chmod 0600 -- "$DB_ARCHIVE" "$UPLOADS_ARCHIVE" 2>/dev/null || true

db_size="$(du -h "$DB_ARCHIVE" | awk '{print $1}')"
up_size="$(du -h "$UPLOADS_ARCHIVE" | awk '{print $1}')"
files="$(tar -tzf "$UPLOADS_ARCHIVE" | grep -cv '/$' || true)"

log "ok            db=$db_size uploads=$up_size (${files} files)  db archive: $oplog_note"
log "free after    $(df -Ph "$BACKUP_DIR" | awk 'NR==2 {print $4}')"

# ---------------------------------------------------------------------------
# An alert nobody received
# ---------------------------------------------------------------------------
# monhorus-backup-notify.sh leaves a marker here when it could not deliver -- including
# when ALERT_WEBHOOK_URL was never configured. Surface it from a run that succeeded,
# because the operator reading a healthy journal is the one audience guaranteed to exist:
# an undelivered alert visible only in the failed notifier's own journal would reproduce,
# one level up, the silence this whole mechanism exists to break.
unsent=0
while IFS= read -r marker; do
  [ -n "$marker" ] || continue
  unsent=$((unsent + 1))
  log "ALERT UNSENT  $(basename "$marker") -- an earlier failure was never notified"
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ALERT-UNSENT-*.txt' 2>/dev/null | sort)
if [ "$unsent" -gt 0 ]; then
  log "              ${unsent} undelivered alert(s) above. Tonight's backup is fine, but"
  log "              the alerting path is not: read them, fix ALERT_WEBHOOK_URL in"
  log "              /etc/monhorus/backup.env, test with"
  log "                systemctl start monhorus-backup-failure"
  log "              and delete the files once the alert arrives."
fi

# ---------------------------------------------------------------------------
# Heartbeat
# ---------------------------------------------------------------------------
# The dead-man switch, and the only part of this that catches the failure the others
# cannot. OnFailure= fires when a run fails; nothing fires for a run that never happened
# -- a masked unit, a disabled timer, a host that stayed off -- and that is precisely the
# fifteen-day scenario. Only something OFF this host, noticing the ABSENCE of this ping,
# sees it. Any check-in service works: healthchecks.io, Better Uptime, a cron monitor.
#
# A failed ping is not a failed backup: the archives above are good and exit status stays
# 0. It is logged anyway, because a heartbeat that stops arriving will raise the alarm at
# the other end and the journal should explain why.
if [ -n "${HEARTBEAT_URL:-}" ]; then
  if ! command -v curl >/dev/null 2>&1; then
    log "WARNING       HEARTBEAT_URL is set but curl is absent -- no heartbeat was sent."
  elif curl -fsS --max-time 15 --retry 2 -o /dev/null "$HEARTBEAT_URL"; then
    log "heartbeat     ok"
  else
    log "WARNING       the heartbeat ping to HEARTBEAT_URL failed. The backup itself is"
    log "              fine; the monitor watching for this ping will alarm regardless."
  fi
fi

log "backup done   ts=$TS"
