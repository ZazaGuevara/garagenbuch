/* Garagenbuch – kleine Server-Funktion (Cloudflare Worker)
   Aufgabe: Anmeldung mit Google und Ausgabe von kurzlebigen Zugangsschlüsseln für Google Drive.
   Die Daten selbst gehen NICHT über diesen Server – die App spricht direkt mit Google Drive.

   Ablauf «Mit Google verbinden»:
   1. App erzeugt eine Kopplungs-Nummer (pair) und öffnet /api/auth/start?pair=…
   2. Google fragt nach Erlaubnis und schickt zurück an /api/auth/callback
   3. Server merkt sich den Google-Schlüssel (refresh token) und legt für das Gerät einen Geräte-Schlüssel ab
   4. App holt den Geräte-Schlüssel mit /api/auth/claim ab (funktioniert auch, wenn das iPhone die Anmeldung
      in einem eigenen Browserfenster gemacht hat)
   5. Danach holt die App mit /api/token jeweils einen Drive-Zugang (1 Stunde gültig)

   Speicher (KV «GB»):  owner = E-Mail des Inhabers (erstes verbundenes Konto) · rt = Google-Schlüssel ·
   at = aktueller Drive-Zugang · dev:<hash> = bekannte Geräte · pair:<nr> = Kopplung (10 Min.) */

import Anthropic from "@anthropic-ai/sdk";

const SCOPE = "openid email https://www.googleapis.com/auth/drive.file";
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/auth/start") return start(url, env);
      if (url.pathname === "/api/auth/callback") return await callback(url, env);
      if (url.pathname === "/api/auth/claim" && req.method === "POST") return await claim(req, env);
      if (url.pathname === "/api/auth/logout" && req.method === "POST") return await logout(req, env);
      if (url.pathname === "/api/token") return await token(req, env);
      if (url.pathname === "/api/status") return await status(env);
      if (url.pathname === "/api/sample") return await sample(req, env);
      if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      return json({ error: "server", message: String(e?.message || e) }, 500);
    }
  }
};

function start(url, env) {
  const pair = url.searchParams.get("pair") || "";
  if (!/^[a-f0-9]{32}$/.test(pair)) return page("Ungültiger Aufruf", "Bitte in der App nochmals auf «Mit Google verbinden» tippen.", 400);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return page("Noch nicht eingerichtet", "Bei Cloudflare fehlen GOOGLE_CLIENT_ID oder GOOGLE_CLIENT_SECRET.", 500);
  const g = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  g.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + "/api/auth/callback", response_type: "code",
    scope: SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: pair
  });
  return Response.redirect(g.toString(), 302);
}

async function callback(url, env) {
  const pair = url.searchParams.get("state") || "", code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return page("Nicht verbunden", "Die Anmeldung bei Google wurde abgebrochen. Sie können es in der App jederzeit nochmals versuchen.");
  if (!/^[a-f0-9]{32}$/.test(pair) || !code) return page("Ungültiger Aufruf", "Bitte in der App nochmals auf «Mit Google verbinden» tippen.", 400);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: url.origin + "/api/auth/callback", grant_type: "authorization_code" })
  });
  const t = await r.json();
  if (!r.ok) return page("Nicht verbunden", "Google hat die Anmeldung abgelehnt (" + (t.error || r.status) + "). Bitte nochmals versuchen.", 400);
  if (!String(t.scope || "").includes("drive.file")) return page("Nicht verbunden", "Bitte bei Google das Häkchen für den Google-Drive-Zugriff setzen und nochmals verbinden.", 400);
  const email = idEmail(t.id_token);
  if (!email) return page("Nicht verbunden", "Google hat keine E-Mail-Adresse geliefert.", 400);
  const owner = await env.GB.get("owner");
  if (owner && owner !== email) return page("Falsches Google-Konto", `Diese App ist mit ${owner} verbunden. Bitte mit diesem Konto anmelden.`, 403);
  if (!owner) await env.GB.put("owner", email);
  if (t.refresh_token) await env.GB.put("rt", t.refresh_token);
  await env.GB.put("at", JSON.stringify({ token: t.access_token, exp: Date.now() + (t.expires_in - 120) * 1000 }));
  const dev = randHex(32);
  await env.GB.put("dev:" + await sha(dev), JSON.stringify({ email, created: Date.now() }));
  await env.GB.put("pair:" + pair, dev, { expirationTtl: 600 });
  return page("Verbunden ✓", "Ihr Google Drive ist mit dem Garagenbuch verbunden. Sie können dieses Fenster schliessen und zur App zurückkehren.", 200, true);
}

async function claim(req, env) {
  const { pair } = await req.json().catch(() => ({}));
  if (!/^[a-f0-9]{32}$/.test(pair || "")) return json({ error: "bad_request" }, 400);
  const dev = await env.GB.get("pair:" + pair);
  if (!dev) return json({ status: "pending" }, 202);
  await env.GB.delete("pair:" + pair);
  return json({ device: dev, email: await env.GB.get("owner") });
}

async function device(req, env) {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer ([a-f0-9]{64})$/);
  if (!m) return null;
  const d = await env.GB.get("dev:" + await sha(m[1]));
  return d ? { key: m[1], ...JSON.parse(d) } : null;
}

async function logout(req, env) {
  const d = await device(req, env);
  if (d) await env.GB.delete("dev:" + await sha(d.key));
  return json({ ok: true });
}

async function token(req, env) {
  const d = await device(req, env);
  if (!d) return json({ error: "reconnect" }, 401);
  const at = JSON.parse(await env.GB.get("at") || "null");
  if (at && at.exp > Date.now() + 60000) return json({ access_token: at.token, expires_at: at.exp, email: d.email });
  const rt = await env.GB.get("rt");
  if (!rt) return json({ error: "reconnect" }, 401);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: rt, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: "refresh_token" })
  });
  const t = await r.json();
  if (!r.ok) {
    // invalid_grant = Google-Erlaubnis abgelaufen oder entzogen (im Test-Modus nach 7 Tagen) → neu verbinden
    if (t.error === "invalid_grant") { await env.GB.delete("rt"); return json({ error: "reconnect" }, 401); }
    return json({ error: "google", message: t.error || r.status }, 502);
  }
  const exp = Date.now() + (t.expires_in - 120) * 1000;
  await env.GB.put("at", JSON.stringify({ token: t.access_token, exp }));
  return json({ access_token: t.access_token, expires_at: exp, email: d.email });
}

/* ---------- Belege und Kalkulationen lesen (Claude) ----------
   Nur für verbundene Geräte des Inhabers. Monatslimit (Anzahl) als Schutz vor unerwarteten Kosten. */
const MODEL = "claude-opus-5-5";
const IMG_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
async function sample(req, env) {
  const d = await device(req, env);
  if (!d) return json({ error: "not_granted" }, 401);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "unavailable" }, 503);
  const month = new Date().toISOString().slice(0, 7), limit = +env.SCAN_LIMIT || 300;
  const used = +(await env.GB.get("scan:" + month)) || 0;
  if (req.method === "GET") return json({ images: true, used, limit });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);
  if (used >= limit) return json({ error: "limit", used, limit }, 429);
  const { prompt, images } = await req.json().catch(() => ({}));
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 200000) return json({ error: "bad_request" }, 400);
  const imgs = Array.isArray(images) ? images : [];
  if (imgs.length > 6 || imgs.some(i => !IMG_TYPES.includes(i?.media_type) || typeof i?.data !== "string" || i.data.length > 7e6)) return json({ error: "bad_request" }, 400);
  await env.GB.put("scan:" + month, String(used + 1), { expirationTtl: 400 * 86400 });
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) }); // BASE_URL nur für lokale Tests
  try {
    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: [
        ...imgs.map(i => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
        { type: "text", text: prompt }
      ] }]
    });
    if (msg.stop_reason === "refusal") return json({ error: "refused" }, 422);
    if (msg.stop_reason === "max_tokens") return json({ error: "invalid_json" }, 422);
    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
    return json({ text, used: used + 1, limit });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "api_key" }, 502);
    if (e instanceof Anthropic.BadRequestError) return json({ error: "bad_request", message: e.message }, 400);
    if (e instanceof Anthropic.APIError) return json({ error: "claude", message: e.message }, 502);
    throw e;
  }
}

/* Prüfseite: zeigt, ob die Einstellungen bei Cloudflare ankommen (nur ja/nein, nie die Werte) */
async function status(env) {
  const has = k => typeof env[k] === "string" && env[k].trim().length > 0;
  const idOk = has("GOOGLE_CLIENT_ID") && env.GOOGLE_CLIENT_ID.trim().endsWith(".apps.googleusercontent.com");
  let kv = false; try { await env.GB.get("owner"); kv = true; } catch (e) {}
  const owner = kv ? await env.GB.get("owner") : null;
  const row = (l, ok, hint, yes = "✅ vorhanden", no = "❌ fehlt") => `<tr><td>${l}</td><td style="text-align:right">${ok ? yes : no}</td></tr>${!ok && hint ? `<tr><td colspan="2" style="color:#9A6A12;font-size:.9rem;padding-bottom:10px">${hint}</td></tr>` : ""}`;
  const names = Object.keys(env).filter(k => !["ASSETS", "GB"].includes(k)).sort().join(", ") || "keine";
  return new Response(`<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Prüfung – Garagenbuch</title>
<style>body{margin:0;font:17px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#F1F1F2;color:#1C1C1F}main{max-width:520px;margin:6vh auto;padding:16px}table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px}td{padding:10px 12px;border-bottom:1px solid #eee}small{color:#626268}</style></head>
<body><main><h1>Garagenbuch – Prüfung</h1><table>
${row("GOOGLE_CLIENT_ID", has("GOOGLE_CLIENT_ID"), "Bei Cloudflare unter Settings → «Variables and Secrets» (nicht unter «Build») eintragen.")}
${has("GOOGLE_CLIENT_ID") ? row("Client-ID sieht richtig aus", idOk, "Die Client-ID muss auf .apps.googleusercontent.com enden – evtl. wurde der Clientschlüssel ins falsche Feld kopiert.", "✅ ja", "❌ nein") : ""}
${row("GOOGLE_CLIENT_SECRET", has("GOOGLE_CLIENT_SECRET"), "Bei Cloudflare unter Settings → «Variables and Secrets» (nicht unter «Build») eintragen.")}
${row("ANTHROPIC_API_KEY (Belege lesen)", has("ANTHROPIC_API_KEY"), "Unter Settings → Build → Variables and secrets als Secret eintragen, dann neu bereitstellen.")}
${row("Speicher (KV)", kv, "")}
</table><p><small>Verbunden mit Google: ${owner ? "ja" : "noch nicht"}<br>Vorhandene Namen: ${esc(names)}</small></p></main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/* ---------- Hilfen ---------- */
function idEmail(idToken) {
  try {
    const p = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p), x => x.charCodeAt(0))));
    return c.email_verified !== false ? String(c.email || "").toLowerCase() : "";
  } catch (e) { return ""; }
}
function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, "0")).join(""); }
async function sha(s) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); }
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function page(title, text, status = 200, back = false) {
  return new Response(`<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} – Garagenbuch</title><style>body{margin:0;font:17px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#F1F1F2;color:#1C1C1F}
main{max-width:520px;margin:12vh auto;padding:24px 16px;text-align:center}h1{font-size:1.6rem}a{display:inline-block;margin-top:16px;background:#C8202A;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(text)}</p><a href="/">Zur App</a></main>${back ? `<script>setTimeout(()=>location.replace("/"),2500)</script>` : ""}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
