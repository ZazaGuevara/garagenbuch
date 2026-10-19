#!/bin/sh
# Cloudflare-Deploy: übernimmt GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET aus den Build-Variablen
# (Cloudflare → garagenbuch → Settings → Build → Variables and secrets) als Geheimnisse für die App.
# Deploy-Befehl bei Cloudflare: sh deploy.sh
F=.secrets.json
node -e 'const o={};for(const k of ["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET"]){const v=(process.env[k]||"").trim();if(v)o[k]=v;}require("fs").writeFileSync(process.argv[1],JSON.stringify(o));console.log("Geheimnisse übernommen: "+(Object.keys(o).join(", ")||"keine"));' "$F"
npx wrangler deploy --secrets-file "$F" "$@"
S=$?
rm -f "$F"
exit $S
