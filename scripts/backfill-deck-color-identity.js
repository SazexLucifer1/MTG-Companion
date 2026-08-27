// Einmaliges Backfill-Skript für sql/public-deck-browse-2026-08-26.sql: befüllt decks.color_identity
// für alle BESTEHENDEN Decks (neue/bearbeitete Decks pflegen die Spalte ab sofort selbst, siehe
// DeckViewerService.saveEdits()/DeckService.saveDeck()). Reine SQL-Migrationen haben keinen
// Scryfall-Netzwerkzugriff, deshalb läuft das hier als separates Node-Skript statt als Teil der
// SQL-Datei.
//
// Fasst bewusst NUR color_identity an, NICHT decks.commander_types (Kreaturtyp) - das ist seit dem
// Archetyp-/Kreaturtyp-Dropdown im Deck-Editor ein rein manuelles, vom Spieler selbst gesetztes Feld
// (siehe DeckService.updateDeckArchetype()) und darf hier nicht mit dem Commander-eigenen Typ
// überschrieben werden.
//
// Braucht den Supabase SERVICE-ROLE-Key (nicht den öffentlichen Anon-Key aus supabase.client.ts) -
// nur damit lassen sich Decks ALLER Nutzer per Update erreichen, RLS würde einen Anon-Client sonst
// auf die eigenen Decks des jeweils eingeloggten Nutzers beschränken. Den Service-Role-Key NIE
// committen - als Umgebungsvariable übergeben:
//
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/backfill-deck-color-identity.js
//
// Idempotent: kann gefahrlos mehrfach laufen (überschreibt betroffene Decks einfach erneut mit
// demselben Ergebnis) - kein "already processed"-Tracking nötig.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://jkkelwpnrgzbvopszwrl.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('Fehlt: SUPABASE_SERVICE_ROLE_KEY als Umgebungsvariable setzen (siehe Kommentar oben).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gleiche Fuzzy-Suche wie ScryfallService.findCard() - hier als eigenständiger fetch-Aufruf, da dieses Skript ohne Angular-DI läuft. */
async function findCard(name) {
  const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'MTG-App-Backfill/1.0' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return { colorIdentity: data.color_identity ?? [] };
}

async function main() {
  const { data: commanderRows, error } = await supabase
    .from('deck_cards')
    .select('deck_id, card_name')
    .eq('is_commander', true);

  if (error) {
    console.error('Konnte Commander-Karten nicht laden:', error);
    process.exit(1);
  }

  const commandersByDeck = new Map();
  for (const row of commanderRows ?? []) {
    const list = commandersByDeck.get(row.deck_id) ?? [];
    list.push(row.card_name);
    commandersByDeck.set(row.deck_id, list);
  }

  console.log(`${commandersByDeck.size} Decks mit mindestens einem markierten Commander gefunden.`);

  const cardCache = new Map();
  let updated = 0;
  let failed = 0;

  for (const [deckId, commanderNames] of commandersByDeck) {
    const cards = [];
    for (const name of commanderNames) {
      const key = name.toLowerCase();
      if (!cardCache.has(key)) {
        cardCache.set(key, await findCard(name));
        await sleep(100); // Rücksicht auf Scryfalls Rate-Limit, siehe fetchWithRetry() in scryfall.service.ts
      }
      const card = cardCache.get(key);
      if (card) cards.push(card);
    }

    if (cards.length === 0) {
      console.warn(`Deck ${deckId}: keinen Commander bei Scryfall gefunden (${commanderNames.join(', ')}), übersprungen.`);
      failed++;
      continue;
    }

    const colorIdentity = [...new Set(cards.flatMap((c) => c.colorIdentity))].sort();

    const { error: updateError } = await supabase.from('decks').update({ color_identity: colorIdentity }).eq('id', deckId);

    if (updateError) {
      console.error(`Deck ${deckId}: Update fehlgeschlagen:`, updateError);
      failed++;
    } else {
      updated++;
    }
  }

  console.log(`Fertig: ${updated} Decks aktualisiert, ${failed} übersprungen/fehlgeschlagen.`);
}

main();
