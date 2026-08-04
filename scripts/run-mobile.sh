#!/usr/bin/env bash
#
# Run a mobile app against the local backend, on a simulator or a real handset.
#
#   scripts/run-mobile.sh employee            # first booted simulator
#   scripts/run-mobile.sh customer <deviceId> # a specific device
#
# Why this exists: AppConfig falls back to http://127.0.0.1:4000 when no
# API_BASE_URL is supplied. On a simulator that is the host machine and works.
# On a physical iPhone 127.0.0.1 is the PHONE, so every request fails and the app
# reports "server connection lost". The fix is a --dart-define pointed at this
# machine's LAN address, which changes whenever the network does - so it is
# resolved here rather than written down anywhere.
set -euo pipefail

APP="${1:-}"
DEVICE="${2:-}"

case "$APP" in
  employee) DIR="apps/mobile-employee" ;;
  customer) DIR="apps/mobile" ;;
  *) echo "usage: $0 {employee|customer} [deviceId]" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# en0 is Wi-Fi on this hardware; en1 is the fallback on machines where it is not.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then
  echo "Could not resolve a LAN address (are you on Wi-Fi?)." >&2
  exit 1
fi

API="http://${LAN_IP}:4000/api/v1"

# Fail early with the real reason rather than letting the app show a generic
# connection error several minutes into a build.
if ! curl -sf --max-time 5 "http://${LAN_IP}:4000/health" >/dev/null; then
  echo "Backend is not reachable at http://${LAN_IP}:4000" >&2
  echo "Start it with:  cd apps/backend && npm run dev" >&2
  exit 1
fi

echo "backend : http://${LAN_IP}:4000  (healthy)"
echo "app     : $DIR"
echo "API_BASE_URL=$API"
echo

cd "$DIR"
if [ -n "$DEVICE" ]; then
  exec flutter run -d "$DEVICE" --dart-define=API_BASE_URL="$API"
fi
exec flutter run --dart-define=API_BASE_URL="$API"
