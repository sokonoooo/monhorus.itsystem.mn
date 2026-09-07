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
#   MIN_FREE_MB     headroom to leave on the disk  (default 512)
#   ENV_FILE        source of MONGODB_URI/UPLOAD_DIR (default /etc/monhorus/backend.env)
#   MONGODB_URI     overrides the value in ENV_FILE
#   UPLOAD_DIR      overrides the value in ENV_FILE
#   SKIP_SPACE_CHECK=1  bypass the pre-flight disk estimate (know why before you do)
#   OPLOG           auto (default) | 1 = require | 0 = never. See "Point-in-time" below.
#
# The host disk runs 83-88% full. Retention and the pre-flight space check are not
# decoration: a dump that fills the last gigabyte takes the API, mongod and four
# neighbouring sites down with it.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/monhorus}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
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

UPLOAD_PARENT="$(cd "$(dirname "$UPLOAD_DIR")" && pwd)"
UPLOAD_NAME="$(basename "$UPLOAD_DIR")"

mkdir -p -- "$BACKUP_DIR"
chmod 0700 -- "$BACKUP_DIR" 2>/dev/null || true

log "backup start  ts=$TS  dest=$BACKUP_DIR  retention=${RETENTION_DAYS}d"
log "uploads       $UPLOAD_DIR"

# ---------------------------------------------------------------------------
# Prune first
# ---------------------------------------------------------------------------
# Expired archives are expired whether or not tonight's run succeeds, and reclaiming
# their space before the dump is what lets a nearly-full disk keep backing itself up.
# Nothing inside the retention window is touched, so a failure after this point still
# leaves RETENTION_DAYS-1 days of history.
pruned=0
while IFS= read -r old; do
  [ -n "$old" ] || continue
  log "prune         $(basename "$old")"
  rm -f -- "$old"
  pruned=$((pruned + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f \
           \( -name 'db-*.archive.gz' -o -name 'uploads-*.tar.gz' -o -name 'pre-restore-*.archive.gz' \) \
           -mtime "+$RETENTION_DAYS" 2>/dev/null | sort)
log "pruned        $pruned archive(s) older than ${RETENTION_DAYS} days"

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
log "backup done   ts=$TS"
