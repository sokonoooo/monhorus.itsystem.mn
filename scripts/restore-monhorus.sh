#!/usr/bin/env bash
#
# Restore Monhorus from a backup pair produced by backup-monhorus.sh.
#
#   restore-monhorus.sh 2026-08-13 --confirm          # newest pair from that day
#   restore-monhorus.sh latest --confirm              # newest pair, whatever its date
#   restore-monhorus.sh /var/backups/monhorus/db-2026-08-13-023011.archive.gz --confirm
#
# Rehearse into a scratch database instead of over production:
#
#   restore-monhorus.sh latest --confirm --db monhorus_rehearsal --uploads-dir /tmp/up
#
# This is the destructive half. `mongorestore --drop` empties every collection the archive
# carries before writing it back, so the script refuses to move without --confirm and
# takes a pre-restore dump of the current database first, which is the only thing standing
# between a mistyped date and the loss of everything since the backup.
#
# Options:
#   --confirm            required; without it nothing is touched
#   --db NAME            restore into NAME instead of the database named in the archive
#   --backup-dir DIR     where to look for archives   (default /var/backups/monhorus)
#   --env-file PATH      source of MONGODB_URI/UPLOAD_DIR (default /etc/monhorus/backend.env)
#   --uploads-dir PATH   overrides UPLOAD_DIR
#   --owner USER:GROUP   ownership for restored uploads (default monhorus:monhorus)
#   --service NAME       systemd unit to cycle        (default monhorus-api)
#   --no-service         do not stop/start anything (rehearsals, non-systemd hosts)
#   --no-pre-dump        skip the pre-restore safety dump
#   --db-only / --uploads-only   restore one half (you had better know why)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/monhorus}"
ENV_FILE="${ENV_FILE:-/etc/monhorus/backend.env}"
SERVICE="monhorus-api"
OWNER="monhorus:monhorus"
TARGET_DB=""
UPLOAD_DIR_OVERRIDE="${UPLOAD_DIR:-}"
CONFIRM=0
USE_SERVICE=1
PRE_DUMP=1
DO_DB=1
DO_UPLOADS=1
SOURCE=""

log() { printf '%s  %s\n' "$(date +'%F %T')" "$*"; }
die() { printf '%s  ERROR: %s\n' "$(date +'%F %T')" "$*" >&2; exit 1; }

usage() {
  sed -n '2,30p' "$0" | sed 's/^#\{1,2\} \{0,1\}//'
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --confirm)      CONFIRM=1 ;;
    --db)           TARGET_DB="${2:-}"; shift ;;
    --backup-dir)   BACKUP_DIR="${2:-}"; shift ;;
    --env-file)     ENV_FILE="${2:-}"; shift ;;
    --uploads-dir)  UPLOAD_DIR_OVERRIDE="${2:-}"; shift ;;
    --owner)        OWNER="${2:-}"; shift ;;
    --service)      SERVICE="${2:-}"; shift ;;
    --no-service)   USE_SERVICE=0 ;;
    --no-pre-dump)  PRE_DUMP=0 ;;
    --db-only)      DO_UPLOADS=0 ;;
    --uploads-only) DO_DB=0 ;;
    -h|--help)      usage ;;
    -*)             die "unknown option: $1" ;;
    *)              [ -z "$SOURCE" ] || die "more than one archive argument: '$SOURCE' and '$1'"
                    SOURCE="$1" ;;
  esac
  shift
done

[ -n "$SOURCE" ] || usage

if [ "$CONFIRM" -ne 1 ]; then
  cat >&2 <<EOF
REFUSING TO RUN.

This restore drops and rewrites the '${TARGET_DB:-monhorus}' database and overwrites files
under the uploads directory. Everything written since the backup was taken is lost.

Re-run with --confirm once you are certain of the date, the host and the target database.
EOF
  exit 2
fi

# ---------------------------------------------------------------------------
# Configuration -- same quoting trap as the backup script
# ---------------------------------------------------------------------------
# `. /etc/monhorus/backend.env` breaks on the `&` in &replicaSet=rs0 and leaves
# MONGODB_URI empty. Read the line instead; never let the shell interpret the value.
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

MONGODB_URI="${MONGODB_URI:-$(read_env_var MONGODB_URI "$ENV_FILE" || true)}"
UPLOAD_DIR="${UPLOAD_DIR_OVERRIDE:-$(read_env_var UPLOAD_DIR "$ENV_FILE" || true)}"

[ "$DO_DB" -eq 0 ] || [ -n "$MONGODB_URI" ] || die "MONGODB_URI is empty -- not in the environment and not in $ENV_FILE"
[ "$DO_UPLOADS" -eq 0 ] || [ -n "$UPLOAD_DIR" ] || die "UPLOAD_DIR is empty -- not in the environment and not in $ENV_FILE"

# mongorestore rejects a connection string that names a database while --archive is in
# play; the archive carries its own namespaces. Strip the path, keep the query -- losing
# ?replicaSet=rs0 would silently connect direct and defeat the majority write concern.
uri_strip_db() {
  local uri="$1" scheme rest query authority
  scheme="${uri%%://*}"; rest="${uri#*://}"
  query=""
  case "$rest" in *\?*) query="?${rest#*\?}"; rest="${rest%%\?*}" ;; esac
  authority="${rest%%/*}"
  printf '%s://%s/%s' "$scheme" "$authority" "$query"
}
uri_db_name() {
  local uri="$1" rest db
  rest="${uri#*://}"
  case "$rest" in *\?*) rest="${rest%%\?*}" ;; esac
  case "$rest" in
    */*) db="${rest#*/}"; printf '%s' "$db" ;;
    *)   printf '' ;;
  esac
}

# ---------------------------------------------------------------------------
# Resolve the archive pair
# ---------------------------------------------------------------------------
# One timestamp identifies both halves. Given a path, a date or `latest`, work out the
# stamp and demand that both files exist -- restoring a database without its uploads is
# the exact failure this whole mechanism exists to prevent.
stamp=""
case "$SOURCE" in
  latest)
    newest="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'db-*.archive.gz' 2>/dev/null | sort | tail -n 1)"
    [ -n "$newest" ] || die "no db-*.archive.gz found in $BACKUP_DIR"
    stamp="$(basename "$newest")"; stamp="${stamp#db-}"; stamp="${stamp%.archive.gz}"
    ;;
  */*|db-*|uploads-*)
    base="$(basename "$SOURCE")"
    case "$base" in
      db-*.archive.gz) stamp="${base#db-}";      stamp="${stamp%.archive.gz}" ;;
      uploads-*.tar.gz) stamp="${base#uploads-}"; stamp="${stamp%.tar.gz}" ;;
      *) die "cannot tell which backup '$SOURCE' is -- expected db-<stamp>.archive.gz or uploads-<stamp>.tar.gz" ;;
    esac
    case "$SOURCE" in */*) BACKUP_DIR="$(cd "$(dirname "$SOURCE")" && pwd)" ;; esac
    ;;
  *)
    # A date, or any stamp prefix: take the newest run matching it.
    newest="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "db-${SOURCE}*.archive.gz" 2>/dev/null | sort | tail -n 1)"
    [ -n "$newest" ] || die "no backup matching '$SOURCE' in $BACKUP_DIR"
    stamp="$(basename "$newest")"; stamp="${stamp#db-}"; stamp="${stamp%.archive.gz}"
    ;;
esac

DB_ARCHIVE="$BACKUP_DIR/db-$stamp.archive.gz"
UPLOADS_ARCHIVE="$BACKUP_DIR/uploads-$stamp.tar.gz"

[ "$DO_DB" -eq 0 ]      || [ -s "$DB_ARCHIVE" ]      || die "missing or empty $DB_ARCHIVE"
[ "$DO_UPLOADS" -eq 0 ] || [ -s "$UPLOADS_ARCHIVE" ] || die "missing or empty $UPLOADS_ARCHIVE"

if [ "$DO_DB" -eq 1 ]; then
  command -v mongorestore >/dev/null 2>&1 || die "mongorestore not found (apt install mongodb-database-tools)"
fi

log "restore from  $BACKUP_DIR  stamp=$stamp"
if [ "$DO_DB" -eq 1 ]; then      log "  database    $(basename "$DB_ARCHIVE")"; fi
if [ "$DO_UPLOADS" -eq 1 ]; then log "  uploads     $(basename "$UPLOADS_ARCHIVE") -> $UPLOAD_DIR"; fi
if [ "$(id -u)" -ne 0 ]; then
  log "WARNING: not running as root; the service cycle and chown will fail unless this is a rehearsal"
fi

# ---------------------------------------------------------------------------
# Stop the API
# ---------------------------------------------------------------------------
# The backend must not be writing into a database that is being dropped underneath it.
started_service=0
if [ "$USE_SERVICE" -eq 1 ]; then
  command -v systemctl >/dev/null 2>&1 || die "systemctl not found -- pass --no-service if this host has no systemd"
  log "stopping      $SERVICE"
  systemctl stop "$SERVICE"
  started_service=1
fi

restart_service_on_exit() {
  local rc=$?
  if [ "$started_service" -eq 1 ]; then
    printf '%s  starting      %s\n' "$(date +'%F %T')" "$SERVICE"
    systemctl start "$SERVICE" || printf '%s  ERROR: %s did not start -- investigate before walking away\n' "$(date +'%F %T')" "$SERVICE" >&2
  fi
  if [ "$rc" -ne 0 ]; then
    printf '%s  restore FAILED (exit %s)\n' "$(date +'%F %T')" "$rc" >&2
  fi
}
trap restart_service_on_exit EXIT

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
if [ "$DO_DB" -eq 1 ]; then
  base_uri="$(uri_strip_db "$MONGODB_URI")"
  archive_db="$(uri_db_name "$MONGODB_URI")"

  if [ "$PRE_DUMP" -eq 1 ]; then
    mkdir -p -- "$BACKUP_DIR"
    pre="$BACKUP_DIR/pre-restore-$(date +%F-%H%M%S).archive.gz"
    log "safety dump   $(basename "$pre")  (current state, before anything is dropped)"
    if ! mongodump --uri="$MONGODB_URI" --archive="$pre" --gzip --quiet; then
      rm -f -- "$pre"
      die "the pre-restore safety dump failed -- refusing to drop a database we cannot roll back. Pass --no-pre-dump to override."
    fi
  fi

  restore_args=(--uri="$base_uri" --archive="$DB_ARCHIVE" --gzip --drop --quiet)
  if [ -n "$TARGET_DB" ] && [ -n "$archive_db" ] && [ "$TARGET_DB" != "$archive_db" ]; then
    log "remapping     $archive_db -> $TARGET_DB"
    restore_args+=(--nsFrom="$archive_db.*" --nsTo="$TARGET_DB.*")
  fi

  log "mongorestore  --drop  (collections in the archive are emptied first)"
  mongorestore "${restore_args[@]}" || die "mongorestore failed"
  log "database      restored"
fi

# ---------------------------------------------------------------------------
# Uploads
# ---------------------------------------------------------------------------
if [ "$DO_UPLOADS" -eq 1 ]; then
  mkdir -p -- "$UPLOAD_DIR"

  # --strip-components=1 drops the archive's own top-level directory name and drops the
  # members straight into UPLOAD_DIR. Extracting into the *parent* instead would be
  # subtly wrong: the archive carries the directory it was made from, so a rehearsal
  # aimed at --uploads-dir /tmp/rehearsal would silently write over the real
  # /var/lib/monhorus/uploads and leave the rehearsal directory empty. Caught exactly
  # that way during the rehearsal recorded in section 12 of the runbook.
  #
  # Extracted as an overlay, deliberately. Wiping the directory first would need a second
  # full copy of the uploads to be safe, and this disk does not have one; worse, it would
  # delete files uploaded after the backup was taken. Anything present in the archive is
  # overwritten by the archive's copy; anything newer survives and is reported below.
  log "extracting    $(basename "$UPLOADS_ARCHIVE") -> $UPLOAD_DIR"
  tar -xzf "$UPLOADS_ARCHIVE" --strip-components=1 -C "$UPLOAD_DIR" \
    || die "extracting $UPLOADS_ARCHIVE failed"

  # Files land owned by root out of the tar; the backend runs as monhorus and would get
  # EACCES on every read. This is the step people forget, and the symptom -- every
  # attachment 500s after an otherwise clean restore -- looks nothing like its cause.
  owner_user="${OWNER%%:*}"
  if id -u "$owner_user" >/dev/null 2>&1; then
    log "chown         $OWNER $UPLOAD_DIR"
    chown -R "$OWNER" "$UPLOAD_DIR" || die "chown failed"
  else
    die "user '$owner_user' does not exist on this host -- pass --owner USER:GROUP"
  fi

  # u=rwX,g=rX,o= gives directories 0750 and files 0640: the tree mode the runbook
  # records for /var/lib/monhorus/uploads, without marking every JPEG executable.
  log "chmod         dirs 0750, files 0640"
  chmod -R u=rwX,g=rX,o= "$UPLOAD_DIR" || die "chmod failed"

  restored="$(tar -tzf "$UPLOADS_ARCHIVE" | grep -cv '/$' || true)"
  present="$(find "$UPLOAD_DIR" -type f | wc -l | tr -d ' ')"
  log "uploads       $restored file(s) from the archive; $present now present in $UPLOAD_DIR"
  if [ "$present" -gt "$restored" ]; then
    log "NOTE          $((present - restored)) file(s) predate nothing in this archive -- they were"
    log "              uploaded after the backup and were left in place, not deleted."
  fi
fi

log "restore done  stamp=$stamp"

cat <<EOF

------------------------------------------------------------------------------
RUN sync-indexes NOW. The restore is not finished without it.

  config/database.ts connects with autoIndex: !isProduction, so production builds no
  indexes on boot. mongorestore recreates the indexes recorded in the archive -- which is
  the index set as it stood on the day of the backup, not the set the currently deployed
  schema expects. Every index added by a release since then is missing, and queries will
  merely be slow rather than broken, so nothing will alert you.

  sudo bash -c 'set -a; . /etc/monhorus/backend.env; set +a
  cd /srv/clients/monhorus/apps/backend
  runuser -p -u monhorus -- node dist/scripts/sync-indexes.js --dry-run
  runuser -p -u monhorus -- node dist/scripts/sync-indexes.js'

Then confirm the service is actually serving:

  systemctl status ${SERVICE} --no-pager
  curl -s https://monhorus.itsystem.mn/health
------------------------------------------------------------------------------
EOF
