#!/bin/sh
# Cloudflare-Deploy: veröffentlicht die App und übernimmt danach GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET
# aus den Build-Variablen (Cloudflare → garagenbuch → Settings → Build → Variables and secrets) als Geheimnisse.
# Deploy-Befehl bei Cloudflare: sh deploy.sh
npx wrangler --version
# Bei vorübergehenden Fehlern von Cloudflare bis zu 3× versuchen
N=1
until npx wrangler deploy; do
  [ $N -ge 3 ] && exit 1
  echo "Deploy fehlgeschlagen – neuer Versuch in 20 Sekunden ($N/3)"; N=$((N+1)); sleep 20
done
for K in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  eval "V=\${$K}"
  if [ -n "$V" ]; then
    printf '%s' "$V" | npx wrangler secret put "$K" && echo "$K übernommen" || echo "WARNUNG: $K konnte nicht übernommen werden"
  else
    echo "WARNUNG: $K fehlt in den Build-Variablen"
  fi
done
exit 0
