# Garagenbuch – Buchhaltungs-App für Garage Dornach Coskun

Diese Datei liest Claude Code bei jedem Start. Sie fasst alles zusammen, was im ursprünglichen Chat (19.10.2026) entschieden wurde.
Sprache mit dem Inhaber: **Deutsch, Schweizer Schreibweise** (ss statt ß, CHF 1'234.50, Datum TT.MM.JJJJ). Er ist Garagist, kein Programmierer: einfach erklären, keine Fachbegriffe ohne Erklärung, nicht zu viele Rückfragen.

## Der Betrieb
- **Garage Dornach Coskun**, Einzelfirma, Weidenstrasse 27, 4143 Dornach (Kanton Solothurn)
- Inhaber: Seyit Coskun. Kontoinhaber für QR-Rechnungen: Seyit Coskun, Vogelsangstrasse 4, 4058 Basel
- IBAN: CH75 0023 3233 2789 4740 B (Prüfziffer verifiziert; Achtung: endet auf Buchstabe – IBAN-Prüfung muss Buchstaben erlauben, mod-97 rechnen)
- Tätigkeiten: Carrosserie, Mechanik, Aufbereitung (siehe Logo). **Kein Autohandel, kein Teilelager** (Funktionen vorhanden, aber standardmässig aus – evtl. später)
- Geräte: **iPhone + Mac**
- Umsatz < CHF 100'000 → **nicht MWST-pflichtig**

## Was die App vorher war
`app/garagenbuch.html` ist ein Claude.ai-Artifact (eine einzige HTML-Datei, Vanilla JS, kein Build).
Es nutzt Claude-Laufzeit-Funktionen über `window.claude.use(...)`, die es **nur in claude.ai** gibt:
- `db` (Speicher pro Benutzer, Pfad `data/users/<id>/store/{buchungen,auftraege,teile,fahrzeuge}` + `data/users/<id>/settings`)
- `sample` (Claude liest Belege/Kalkulationen aus Foto oder PDF → JSON)
- `assets` (Belegfotos/PDFs ablegen, Abruf über `/_blob/<id>`)
- `downloads` (PDF/ZIP/CSV speichern), `user`
Fallback ohne Claude: `localStorage` (nur Browser-lokal).
Bibliotheken per CDN: jsPDF 2.5.1, qrcode-generator 1.4.4, pdf.js 3.11.174 (Worker als Script im Hauptthread), JSZip 3.10.1.

## Ziel dieses Projekts
Eine **eigenständige App**, die unabhängig von Claude.ai läuft – der Inhaber will nicht, dass Buchhaltungsdaten irgendwo gelöscht werden können (10 Jahre Aufbewahrungspflicht, Art. 958f OR).
Anforderungen:
1. **Installierbar auf dem iPhone** (PWA mit Manifest + Service Worker, «Zum Home-Bildschirm»), funktioniert auch offline.
2. **Daten gehören ihm**: lokal (IndexedDB) **plus automatische Sicherung in sein Google Drive** (Ordner «Garagenbuch»: Daten-JSON, jeder Beleg, jede Rechnung als PDF, Jahresabschlüsse).
3. **Belege lesen** (Foto/PDF → Betrag, Datum, Lieferant, Positionen) über die Claude API mit eigenem API-Schlüssel – Schlüssel **nie** im Frontend, sondern in einer kleinen Serverless-Funktion.
4. Kostengünstig: Gratis-Hosting (z.B. Vercel/Netlify/Cloudflare Pages), nur API-Kosten fürs Beleglesen.
5. Bestehende Daten übernehmen: Import der «Komplett-Sicherung» (ZIP mit `garagenbuch-daten.json`, Ordnern `belege/` und `rechnungen/`) aus dem Artifact.

Vorgehen: zuerst Plan vorschlagen und vom Inhaber bestätigen lassen, dann in kleinen Schritten bauen. Die Geschäftslogik aus `app/garagenbuch.html` übernehmen, nicht neu erfinden.

## Funktionen (alle im heutigen Code vorhanden)
- **Übersicht**: Einnahmen/Ausgaben/Gewinn/Reingewinn, offene & überfällige Rechnungen (Erinnerung als PDF), Rentabilität, Monatsgrafik, Sicherungs-Erinnerung (> 30 Tage)
- **+ Beleg**: Foto aufnehmen oder Foto/PDF wählen → Claude liest aus; Kategorie-Chips; optional einem Auftrag zuordnen; Belegdatei wird archiviert
- **Rechnungen & Kostenvoranschläge**: Arbeit (Std × Satz), Teile (Einkauf + Verkauf mit Aufschlag), Kleinmaterial-Pauschale, PDF mit Logo + Schweizer QR-Zahlteil; KV → Rechnung mit einem Tipp; bezahlt markieren; Zahlungserinnerung
- **Versicherungsschaden**: Experten-Kalkulation (z.B. SilverDAT, Text aus PDF via pdf.js) hochladen → Positionen 1:1 → Versicherung aus Liste wählen → Rechnung(en)
- **Kunden**: Umsatz, Kosten, Deckungsbeitrag, offen, pro Kunde & pro Auftrag; Kosten Aufträgen zuordnen
- **Auswertung**: Treppe Umsatz → Material → Fixkosten → Rücklage AHV/Steuern → Reingewinn; Tabelle pro Auftrag mit Gemeinkosten-Anteil (nach Arbeitsstunden); Monat/Jahr; Schwelle; möglicher Lohn
- **Abschluss & Steuern**: MWST-Grenze mit Hochrechnung, AHV-/Steuerschätzung, Termine, Jahresabschluss-PDF, Buchungsjournal CSV, Belege-ZIP, Komplett-Sicherung ZIP + Wiederherstellen
- **QR**: Zahlungs-QR mit/ohne Betrag (Bild/PDF)
- **Einstellungen**: Firma, Logo, Bank, Stundensatz, Aufschlag, Kleinmaterial %, Zahlungsfrist, Versicherer-Liste, Zusatzfunktionen (Lager, Autohandel)

## Geschäftsregeln (verbindlich)
- **MWST**: nicht pflichtig → auf Rechnungen **keine MWST ausweisen** (sonst geschuldet, Art. 27 Abs. 2 MWSTG). Bei Versicherungsrechnungen das Total **exkl. MWST** der Kalkulation verrechnen. Umsatzgrenze CHF 100'000 überwachen (Hochrechnung), bei Überschreiten Anmeldung innert 30 Tagen. MWST-Modus (Saldo 3,0 % Reparaturwerkstätte / effektiv) ist umschaltbar vorhanden.
- **Zahlungsfrist**: 10 Tage. Rundung Rechnungstotal auf 5 Rappen; Buchungen müssen exakt das Rechnungstotal ergeben.
- **Einkauf** zählt brutto (kein Vorsteuerabzug).
- **Selbstbehalt bei Versicherungsrechnungen** – 4 Varianten, pro Versicherung gemerkt:
  - `sep`: SB ist in Kalkulation enthalten → Versicherung = Kalkulation − SB, Kunde = SB (eigene Rechnung)
  - `beide`: SB kommt dazu → Versicherung = Kalkulation, Kunde = SB (eigene Rechnung), total Kalkulation + SB
  - `plus`: Versicherung zahlt Kalkulation + SB, Kunde keine Rechnung
  - `keiner`: Versicherung = Kalkulation
- **Verbrauchsmaterial** (Klebband, Schleifvlies, Lack …): eigene Kategorie, keinem Kunden zugeordnet, wird in der Auswertung nach Arbeitsstunden auf Aufträge verteilt; auf Rechnungen optional «Klein- und Verbrauchsmaterial» = 5 % der Arbeit.
- Standardwerte: Stundensatz CHF 125, Teile-Aufschlag 35 %, Kleinmaterial 5 %.
- **AHV Selbständige 2026**: 10 % (AHV 8,1 / IV 1,4 / EO 0,5) ab CHF 60'500, sinkende Skala ab 10'100 (tiefster Satz 5,371 %), Mindestbeitrag CHF 530; + Verwaltungskosten (Annahme 3 %).
- **Steuern** (Schätzung, Satz einstellbar, Standard 15 %): Kanton SO 104 %, Gemeinde Dornach 92 % (2026).
- **Buchführung**: Einzelfirma < CHF 500'000 → einfache Buchhaltung (Einnahmen/Ausgaben/Vermögenslage), **keine Revision** nötig. Aufbewahrung 10 Jahre.
- **QR-Rechnung**: Swiss QR, Adresstyp S, Referenz NON (QRR nur bei QR-IBAN), Kreditor = Kontoinhaber.

## Versicherer (Adressen, Stand 10/2026)
AXA Versicherungen AG, General-Guisan-Strasse 40, 8400 Winterthur · Allianz Suisse, Richtiplatz 1, 8304 Wallisellen · Die Mobiliar, Bundesgasse 35, 3001 Bern · Zurich Schweiz, Scanning GIC, 8085 Zürich (offizielle Adresse für Schadendokumente) · Helvetia (inkl. ehem. Baloise), St. Alban-Anlage 26, 4002 Basel · Generali, Soodmattenstrasse 2, 8134 Adliswil · Vaudoise, Place de Milan 120, 1001 Lausanne · TCS Versicherungen, Chemin de Blandonnet 4, 1214 Vernier · Simpego (inkl. Dextra), Hohlstrasse 556, 8048 Zürich · ELVIA (Allianz), Richtiplatz 1, 8304 Wallisellen · Sympany, Peter Merian-Weg 4, 4002 Basel · PostFinance Autoversicherung, c/o TONI Digital Solutions AG, Seefeldstrasse 5a, 8008 Zürich.
Hinweis: meist Hauptsitz-Adressen; spezielle Schadenadressen vom Versicherungsschreiben übernehmen. AXA wünscht Einreichung über GaragenHub-Portal.

## Entscheid 20.10.2026: Claude-App bleibt die Haupt-App
Der Inhaber will das Belegelesen über sein Claude-Abo behalten und keinen eigenen API-Schlüssel bezahlen. Darum:
- **Haupt-App = das Claude-Artifact** https://claude.ai/artifact/Wf73PiPxqe6WRQFu3V4vgC (Version 16). Quelltext-Kopie: `app/garagenbuch-claude.html`. Änderungen immer am Artifact (Artifact-Tool mit `url`, vorher lesen) und die Kopie hier nachziehen.
- **Google-Drive-Sicherung im Artifact** über die `mcp`-Fähigkeit mit dem Claude-Connector «Google Drive» (Werkzeuge `search_files`, `create_file`, `trash_file`). Ordner «Garagenbuch» (existiert, ID `12XCt407eUVeu7ea_Z28d4Di6hiFKOwRs`): `daten/garagenbuch-daten JJJJ-MM-TT.json` (ein Stand pro Tag, gleiches Format wie die Komplett-Sicherung), `belege/JJJJ/`, `rechnungen/JJJJ/`, `abschluesse/JJJJ/`. Der Connector kann nicht überschreiben → neue Datei anlegen, alte Fassung in den Papierkorb. Merkliste im Artifact-Speicher unter `data/users/<id>/store/gdrive/{state,belege_JJJJ,re_JJJJ}`. Einschalten per Knopf (Einstellungen oder Übersicht), danach automatisch bei jeder Änderung, solange die App offen ist.
- Die eigenständige App (unten, Cloudflare) ist **pausiert**, nicht gelöscht.

## Stand der Umsetzung (eigenständige App, pausiert)
Plan vom Inhaber bestätigt (19.10.2026). Hosting: Cloudflare Workers mit Static Assets (`wrangler.jsonc`, Ordner `public/`, gratis, gewerbliche Nutzung erlaubt; Deploy automatisch bei jedem Push auf `main`). Achtung: Cloudflare leitet `/index.html` auf `/` um – im Service Worker immer `./` cachen, nie `index.html`. Google-Konto: das, welches der Inhaber mit Claude verbunden hat.
- [x] Schritt 1 – App von Claude.ai gelöst: `public/platform.js` bildet `window.claude.use(...)` als `platform.use(...)` nach (gleiche Schnittstelle). Speicher = IndexedDB (`docs`, `blobs`, `meta`), Dateien sichern = iPhone «Teilen» bzw. Download am Mac, Belege öffnen über `a[data-blob]`.
- [x] Schritt 2 – PWA: `manifest.webmanifest`, `sw.js` (bei jeder Änderung `VERSION` erhöhen!), Icons aus dem Logo, Bibliotheken und Schriften lokal in `public/vendor` bzw. `public/fonts` (kein CDN → offline).
- [x] Schritt 3 – Import der Komplett-Sicherung: Daten + Einstellungen (Stundensatz, Versicherer, Selbstbehalt-Modi …) + Belegdateien (Zuordnung über `belegPfad(e)`, gleiche Asset-ID).
- [x] Schritt 0 – Konten: Cloudflare (App: https://garagenbuch.guelverens.workers.dev/), Google Cloud Projekt «Garagenbuch» (OAuth-Client Webanwendung, Weiterleitung `/api/auth/callback`, Scope `drive.file`). Google-App bleibt im **Test-Modus** mit dem Inhaber als Testnutzer (er will nichts veröffentlichen) → Google-Erlaubnis läuft alle 7 Tage ab, die App zeigt dann «Neu verbinden». `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` stehen im Cloudflare-Dashboard unter **Settings → Build → Variables and secrets** (die Laufzeit-Variablen liessen sich im Dashboard nicht setzen). Deploy-Befehl bei Cloudflare ist deshalb `sh deploy.sh`: setzt die Werte nach dem Deploy mit `wrangler secret put` als Geheimnisse (`--secrets-file` kennt der Cloudflare-Build nicht), mit 3 Versuchen bei Cloudflare-Fehlern. Prüfseite: `/api/status`.
- [x] Schritt 4 – Google-Drive-Sicherung: `worker/index.js` (Anmeldung, Geräte-Kopplung über `pair`, `/api/token` gibt Drive-Zugang; KV-Binding `GB` wird von wrangler automatisch angelegt) + `public/drive.js` (App spricht direkt mit der Drive-API). Ordner `Garagenbuch/`: `daten/garagenbuch-daten.json` (Format der Komplett-Sicherung + `sync`-Teil), `daten/verlauf/` (Stand pro Tag), `belege/JJJJ/` (appProperty `asset`), `rechnungen/JJJJ/` (appProperty `job`), `abschluesse/JJJJ/`. Mehrere Geräte: pro Eintrag gewinnt die neuere Änderung, Löschungen über Löschmarken (`platform.applyRemote`). Ordner NIE über den Claude-Drive-Connector anlegen – mit `drive.file` sieht die App nur selbst erstellte Dateien. Getestet mit nachgebautem Drive (zwei Geräte), mit echtem Google noch nicht.
- [~] Schritt 5 – Beleglesen: `/api/sample` im Worker (offizielles SDK `@anthropic-ai/sdk`, Modell `claude-opus-5-5`, effort `medium`, `fallbacks: "default"` mit Beta `server-side-fallback-2026-07-01`; nur mit Geräte-Schlüssel der Google-Verbindung; Monatslimit Anzahl `SCAN_LIMIT`, Standard 300, Zähler in KV `scan:JJJJ-MM`). In der App: `platform.use("sample")` → `limits()` / `json(prompt,{images,signal})`, Antwort-JSON wird aus dem Text gelesen. `ANTHROPIC_API_KEY` kommt wie die Google-Werte aus den Build-Variablen (deploy.sh). Getestet mit nachgebautem Claude; echter Schlüssel fehlt noch. Versicherungsschaden geht zusätzlich «Von Hand erfassen».
- [ ] Schritt 6 – Parallelbetrieb, dann Umstieg.

## Dateien
- `worker/index.js` – kleine Server-Funktion (Google-Anmeldung, Drive-Zugang, Beleglesen mit Claude). `package.json` nur für das Anthropic-SDK.
- `public/` – die eigenständige App (wird so veröffentlicht, kein Build). `index.html` = Geschäftslogik aus dem Artifact, nur an den Plattform-Stellen angepasst.
- `app/garagenbuch-claude.html` – aktuelle Claude-App (Artifact-Version 16, mit Google-Drive-Sicherung).
- `app/garagenbuch.html` – Original (Artifact-Version 13), nur noch als Referenz; nicht mehr ändern. Enthält Logo (base64) und Bankdaten als Standardwerte.
- `assets/logo.png`, `assets/logo-original.pdf` – Logo (Schwarz/Rot: «/// GARAGE DORNACH – Carrosserie | Mechanik | Aufbereitung»). App-Farben passen dazu (Akzent #C8202A).
- `docs/verlauf.md` – wie die App entstanden ist (Entscheidungen in Reihenfolge)
- `docs/Buchhaltung_Garage_Dornach_2026.xlsx` – erste Excel-Version (veraltet: rechnete noch mit MWST)

## Datenschutz
Keine echten Kundendaten in Code, Beispiele oder Tests. Beispieldaten klar als «Beispiel» markieren. Der API-Schlüssel gehört nur in Umgebungsvariablen der Serverless-Funktion.
