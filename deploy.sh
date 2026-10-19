#!/bin/sh
# Cloudflare-Deploy: veröffentlicht die App und übernimmt danach GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET
# aus den Build-Variablen (Cloudflare → garagenbuch → Settings → Build → Variables and secrets) als Geheimnisse.
# Deploy-Befehl bei Cloudflare: sh deploy.sh
npx wrangler --version
npx wrangler deploy || exit 1
for K in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  eval "V=\${$K}"
  if [ -n "$V" ]; then
    printf '%s' "$V" | npx wrangler secret put "$K" && echo "$K übernommen" || echo "WARNUNG: $K konnte nicht übernommen werden"
  else
    echo "WARNUNG: $K fehlt in den Build-Variablen"
  fi
done
exit 0
