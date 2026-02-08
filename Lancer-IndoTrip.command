#!/bin/zsh
set -e

cd "$(dirname "$0")"

RUN_DIR="$PWD/.run"
mkdir -p "$RUN_DIR"

if [ -f "$RUN_DIR/server.pid" ]; then
  kill "$(cat "$RUN_DIR/server.pid")" >/dev/null 2>&1 || true
fi
if [ -f "$RUN_DIR/tunnel.pid" ]; then
  kill "$(cat "$RUN_DIR/tunnel.pid")" >/dev/null 2>&1 || true
fi

nohup node server.js > "$RUN_DIR/server.log" 2>&1 < /dev/null &
echo $! > "$RUN_DIR/server.pid"

nohup npx --yes localtunnel --port 3000 > "$RUN_DIR/tunnel.log" 2>&1 < /dev/null &
echo $! > "$RUN_DIR/tunnel.pid"

URL=""
for _ in {1..45}; do
  if grep -q 'your url is:' "$RUN_DIR/tunnel.log"; then
    URL="$(grep -m1 'your url is:' "$RUN_DIR/tunnel.log" | sed 's/.*your url is: //')"
    break
  fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Echec: impossible d'obtenir le lien public."
  echo "Logs: $RUN_DIR/tunnel.log"
  tail -n 30 "$RUN_DIR/tunnel.log" || true
  exit 1
fi

echo "\n=============================================="
echo "IndoTrip est en ligne"
echo "Lien public: $URL"
echo "==============================================\n"

echo "$URL" | pbcopy >/dev/null 2>&1 || true
open "$URL" >/dev/null 2>&1 || true

echo "Le lien est copie dans le presse-papiers (si disponible)."
echo "Pour arreter l'app: double-clique sur STOP-IndoTrip.command"
