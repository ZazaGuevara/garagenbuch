# Verlauf – wie das Garagenbuch entstanden ist (Chat vom 19.10.2026)

1. **Wunsch**: komplette Buchhaltung für Einzelfirma (Garage, Dornach) mit Steuern, Gewinnrechnung, Marge. → Zuerst Excel-Arbeitsmappe (Kontenplan, Journal, ER, Bilanz, MWST, AHV, Steuern). Inhaber: «zu kompliziert».
2. **App statt Excel**: einfache App «Einnahme/Ausgabe antippen, Betrag, fertig». Claude.ai-Artifact mit Speicher im Konto.
3. **Teile einkaufen & teurer verkaufen + Beleg fotografieren** → Foto-Erkennung, Teilelager, Kundenaufträge mit Teilemarge.
4. **Am Handy kein Upload** → Datei-Knöpfe direkt antippbar (label statt programmatischem click), HEIC-Umwandlung.
5. **Rechnungen & Kostenvoranschläge** als PDF mit Swiss-QR-Zahlteil; KV → Rechnung.
6. **Versicherungsschaden**: SilverDAT-Kostenzusammenstellung (Experte, z.B. NORWEX AG) 1:1 an Versicherung verrechnen. Zuerst falsch verstanden (Rechnung an Experten) → korrigiert: Versicherung des Kunden aus Liste wählen. Logo & Firmenadresse eingebaut, Bank-QR erstellt (Kontoinhaber erst Muttenz, korrigiert auf Vogelsangstrasse 4, 4058 Basel).
7. **QR soll in der App sein** (nicht als Datei im Chat) → eigener Tab «QR».
8. **MWST geprüft, Zahlungsfrist 10 Tage, Rentabilität pro Kunde** → Kunden-Tab, Kosten Aufträgen zuordnen, Zahlungserinnerungen.
9. **Nicht MWST-pflichtig (< 100k), kein Autohandel, kein Lager, Belege auch als PDF** → MWST aus, Lager/Autos ausgeblendet (in Einstellungen wieder einschaltbar), PDF-Belege via pdf.js.
10. **Übersicht pro Auftrag bis Reingewinn** → Tab «Auswertung» (Treppe, Gemeinkosten-Verteilung nach Stunden, Rücklage AHV/Steuern, Schwelle, möglicher Lohn).
11. **Handy, Jahresabschluss, Verbrauchsmaterial** → Kategorie Verbrauchsmaterial, Kleinmaterial-Pauschale, Jahresabschluss-PDF, Belege-ZIP, Datensicherung.
12. **«Daten können gelöscht werden – keine Lösung für eine Einzelfirma»** → Komplett-Sicherung als ZIP (Daten + Belege + Rechnungs-PDFs), Erinnerung. Ziel: eigenständige App (dieses Projekt).
13. **Selbstbehalt**: Versicherungen wollen ihn unterschiedlich → 4 Varianten (siehe CLAUDE.md), inkl. «Versicherung zahlt Kalkulation, Kunde zahlt SB zusätzlich».
14. Google Drive mit Claude verbunden. Inhaber will **eine richtige App** → Projekt nach Claude Code verschieben.

## Offene Punkte
- Eigenständige PWA bauen (siehe Ziel in CLAUDE.md)
- Automatische Ablage in Google Drive
- MWST-Nummer fehlt (nur nötig, falls MWST-pflichtig)
- Steuersatz (15 %) mit Steuerrechner SO genauer bestimmen
