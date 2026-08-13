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
#
# The host disk runs 83-88% full. Retention and the pre-flight space check are not
# decoration: a dump that fills the last gigabyte takes the API, mongod and four
# neighbouring sites down with it.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/monhorus}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MIN_FREE_MB="${MIN_FREE_MB:-512}"
ENV_FILE="${ENV_FILE:-/etc/monhorus/backend.env}"

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
log "mongodump     -> $(basename "$DB_ARCHIVE")"
mongodump --uri="$MONGODB_URI" --archive="$DB_ARCHIVE.partial" --gzip --quiet \
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

log "ok            db=$db_size uploads=$up_size (${files} files)"
log "free after    $(df -Ph "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
log "backup done   ts=$TS"
