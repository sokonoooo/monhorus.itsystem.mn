#!/usr/bin/env bash
#
# Tells a human that the Monhorus backup failed.
#
#   monhorus-backup-notify.sh [UNIT]        (default unit: monhorus-backup.service)
#
# Run by monhorus-backup-failure.service, which monhorus-backup.service names in
# OnFailure=. Before this existed the entire notification design was "a human runs
# systemctl status", which is why a failure streak could run for a fortnight unnoticed.
#
# A webhook, not mail. This host has no mail relay and none can be assumed: adding one is
# a bigger change than the problem, and a queued-then-bounced mail is another silent
# path. One HTTPS POST with curl reaches Slack, Mattermost, Discord, Telegram, ntfy,
# Gotify or a check-in service, which is every destination this operator plausibly has.
#
#   ALERT_WEBHOOK_URL     REQUIRED for any alert to reach anyone. Unset = nothing is
#                         delivered, and this script says so loudly rather than passing.
#   ALERT_WEBHOOK_FORMAT  json (default) posts {"text": "..."} -- Slack, Mattermost and
#                         anything Slack-compatible. text posts the message as
#                         text/plain -- ntfy, Gotify, healthchecks.io, a plain endpoint.
#   ALERT_WEBHOOK_JSON_KEY  the key to use in json format (default "text"; Discord
#                         wants "content").
#   ALERT_MAIL_TO         additionally mailed here IF a mailer already exists. Strictly a
#                         bonus path -- never the only one, and never assumed to work.
#   BACKUP_DIR            where the unsent-alert marker is left (default
#                         /var/backups/monhorus).
#
# This script must not fail silently either -- a notifier whose own failure is invisible
# reproduces the original bug one level up. So when nothing was delivered it does three
# things: writes an ALERT-UNSENT-*.txt marker into BACKUP_DIR that the next SUCCESSFUL
# backup run prints in its journal, logs the reason, and exits non-zero so its own unit
# enters failed state. "Not configured" counts as "not delivered" -- an alerting path
# that was never set up must be as visible as one that broke.
set -euo pipefail

UNIT="${1:-monhorus-backup.service}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/monhorus}"
ALERT_WEBHOOK_FORMAT="${ALERT_WEBHOOK_FORMAT:-json}"
ALERT_WEBHOOK_JSON_KEY="${ALERT_WEBHOOK_JSON_KEY:-text}"

TS="$(date +'%F %T %Z')"
HOSTNAME_S="$(hostname 2>/dev/null || echo unknown-host)"

log()  { printf '%s  %s\n' "$(date +'%F %T')" "$*"; }
warn() { printf '%s  %s\n' "$(date +'%F %T')" "$*" >&2; }

# ---------------------------------------------------------------------------
# What went wrong
# ---------------------------------------------------------------------------
# The journal tail is the whole value of the alert: "the backup failed" without the
# reason just moves the investigation, it does not start it.
detail=""
if command -v systemctl >/dev/null 2>&1; then
  detail="$(systemctl status --no-pager --lines=0 "$UNIT" 2>/dev/null | head -8 || true)"
fi
journal=""
if command -v journalctl >/dev/null 2>&1; then
  journal="$(journalctl -u "$UNIT" -n 25 --no-pager -o short-iso 2>/dev/null || true)"
fi

SUBJECT="Monhorus BACKUP FAILED on ${HOSTNAME_S}"
MESSAGE="$(printf '%s\n\nhost:  %s\nunit:  %s\nwhen:  %s\n\n--- status ---\n%s\n\n--- last 25 journal lines ---\n%s\n\nThe database and uploads archives are the only copies that exist.\nInvestigate now: journalctl -u %s -n 200 --no-pager\n' \
  "$SUBJECT" "$HOSTNAME_S" "$UNIT" "$TS" "${detail:-<systemctl unavailable>}" "${journal:-<journal unavailable>}" "$UNIT")"

log "alert         $SUBJECT"

# ---------------------------------------------------------------------------
# Deliver
# ---------------------------------------------------------------------------
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\r'/}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\n'/\\n}"
  printf '%s' "$s"
}

delivered=0
reason=""

if [ -z "${ALERT_WEBHOOK_URL:-}" ]; then
  reason="ALERT_WEBHOOK_URL is not set in /etc/monhorus/backup.env -- no alert destination is configured"
elif ! command -v curl >/dev/null 2>&1; then
  reason="curl is not installed, so the webhook could not be posted"
else
  # --retry rides out a brief network blip; --max-time bounds the whole attempt so a
  # hanging endpoint cannot keep this unit alive. -f makes an HTTP 4xx/5xx a failure
  # rather than a body written to stdout and an exit status of 0.
  curl_rc=0
  if [ "$ALERT_WEBHOOK_FORMAT" = "text" ]; then
    curl_out="$(curl -fsS --max-time 30 --retry 3 --retry-delay 5 -o /dev/null \
                  -H 'Content-Type: text/plain; charset=utf-8' \
                  --data-binary "$MESSAGE" \
                  "$ALERT_WEBHOOK_URL" 2>&1)" || curl_rc=$?
  else
    payload="{\"$(json_escape "$ALERT_WEBHOOK_JSON_KEY")\":\"$(json_escape "$MESSAGE")\"}"
    curl_out="$(curl -fsS --max-time 30 --retry 3 --retry-delay 5 -o /dev/null \
                  -H 'Content-Type: application/json' \
                  --data-binary "$payload" \
                  "$ALERT_WEBHOOK_URL" 2>&1)" || curl_rc=$?
  fi
  if [ "$curl_rc" -eq 0 ]; then
    delivered=1
    log "webhook       delivered (${ALERT_WEBHOOK_FORMAT})"
  else
    reason="the webhook POST failed (curl exit ${curl_rc}: ${curl_out:-no output})"
  fi
fi

# A bonus path, never the only one. If no mailer is installed this is skipped in silence
# precisely because it is not what the alert depends on.
if [ -n "${ALERT_MAIL_TO:-}" ] && command -v mail >/dev/null 2>&1; then
  if printf '%s\n' "$MESSAGE" | mail -s "$SUBJECT" "$ALERT_MAIL_TO" 2>/dev/null; then
    delivered=1
    log "mail          sent to $ALERT_MAIL_TO"
  else
    log "mail          FAILED to $ALERT_MAIL_TO (the webhook is the path that matters)"
  fi
fi

# ---------------------------------------------------------------------------
# If nothing got through, be loud about that too
# ---------------------------------------------------------------------------
if [ "$delivered" -eq 1 ]; then
  log "alert         delivered"
  exit 0
fi

marker="$BACKUP_DIR/ALERT-UNSENT-$(date +%F-%H%M%S).txt"
if mkdir -p -- "$BACKUP_DIR" 2>/dev/null && : > "$marker" 2>/dev/null; then
  printf 'UNDELIVERED ALERT\n\nwhy not delivered: %s\n\n%s\n' "$reason" "$MESSAGE" >> "$marker"
  chmod 0600 -- "$marker" 2>/dev/null || true
  warn "ERROR: the backup-failure alert could not be delivered: ${reason}"
  warn "ERROR: written to ${marker}; the next successful backup run will report it"
else
  warn "ERROR: the backup-failure alert could not be delivered: ${reason}"
  warn "ERROR: and the marker file could not be written to ${BACKUP_DIR} either"
fi

# Non-zero so this unit enters failed state and `systemctl --failed` lists it. The alert
# not arriving is itself an incident.
exit 1
