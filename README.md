# MTG Companion

Deutsche, mobile Companion-App für **Magic: The Gathering** – optimiert für das iPhone (Safari), installierbar als Web-App auf dem Home-Bildschirm.

## Features

- **Match**: Spielergebnisse erfassen – Spielmodus wählen, Mitspieler antippen, Commander zuweisen, Gewinner markieren. Inklusive Match-Verlauf.
- **Statistik**: Rangliste mit Siegen und Winrate, erfolgreichste Commander, letzte Spiele.
- **Spieler**: Spieler hinzufügen, umbenennen (Historie wird mitgezogen) und löschen.
- **Foto-Erkennung**: Foto der Karten am Tisch machen – Google Gemini erkennt die Commander, Scryfall verifiziert, dass die Karten wirklich existieren.
- **Kartensuche**: Autovervollständigung über die Scryfall-API beim manuellen Eintragen von Commandern.
- **Persistenz**: Alle Daten (Spieler, Matches, API-Key) liegen im LocalStorage des Browsers – nichts geht beim Neuladen verloren, kein Backend nötig.

## Design

Fantasy-Hintergrund im Magic-Stil (Drache) mit UI-Elementen im iOS-Liquid-Glass-Look: Der Hintergrund schimmert unscharf durch Karten, Buttons und die Tab-Bar hindurch, ohne die Lesbarkeit zu beeinträchtigen.

## Setup

```bash
npm install
npm start
```

Die App läuft dann unter `http://localhost:4200`.

### Produktions-Build

```bash
npm run build
```

Das Ergebnis liegt in `dist/fabi-mtg/browser` und kann auf jedem statischen Webserver (z. B. Netlify, Vercel, GitHub Pages) gehostet werden.

## Gemini-API-Key (für die Foto-Erkennung)

1. Kostenlosen API-Key im [Google AI Studio](https://aistudio.google.com/apikey) erstellen.
2. In der App im Tab **Spieler** unter „Einstellungen“ einfügen und speichern.

Der Key wird ausschließlich lokal auf dem Gerät gespeichert. Ohne Key funktioniert alles außer der Foto-Erkennung – Commander lassen sich dann weiterhin über die Kartensuche eintragen.

## Auf dem iPhone installieren

1. Seite in Safari öffnen.
2. Teilen-Menü → **„Zum Home-Bildschirm“**.
3. Die App startet dann im Vollbild ohne Browser-Leiste. Die Kamera wird über den normalen iOS-Foto-Dialog geöffnet – es sind keine besonderen Berechtigungen nötig.
