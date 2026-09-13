#!/bin/sh
# Garantit que le serveur de test statique tourne sur 8765. Idempotent.
RACINE=$(cd "$(dirname "$0")/.." && pwd)
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8765/index.html 2>/dev/null)
if [ "$code" = "200" ]; then echo "serveur ok"; exit 0; fi
setsid nohup python3 -m http.server 8765 --directory "$RACINE" >/tmp/http-test-8765.log 2>&1 < /dev/null &
i=0
while [ $i -lt 20 ]; do
  sleep 0.5
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8765/index.html 2>/dev/null)
  [ "$code" = "200" ] && { echo "serveur relance"; exit 0; }
  i=$((i+1))
done
echo "ECHEC serveur"; exit 1
