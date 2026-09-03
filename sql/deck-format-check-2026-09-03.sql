-- Decks lassen sich jetzt einem offiziellen MTG-Spielformat zuordnen (Dropdown beim Anlegen und
-- beim nachträglichen Bearbeiten, siehe DeckService.saveDeck()/updateDeckInfo() und
-- models.ts DECK_FORMATS). Die Spalte decks.format existierte bereits (bisher immer fest auf
-- "Commander" gesetzt, siehe deck-import.service.ts) - dieses Skript beschränkt sie per
-- CHECK-Constraint auf genau die Werte aus DECK_FORMATS, damit keine Tippfehler/Freitext-Werte
-- reinrutschen. Bestehende Decks haben bereits "Commander" oder NULL und sind davon nicht
-- betroffen, kein Backfill nötig.
--
-- Manuell im Supabase SQL-Editor ausführen (keine DB-Zugangsdaten in dieser Session).

alter table public.decks drop constraint if exists decks_format_check;

alter table public.decks
  add constraint decks_format_check
  check (format is null or format in (
    'Standard',
    'Pioneer',
    'Modern',
    'Legacy',
    'Vintage',
    'Pauper',
    'Commander',
    'Pauper Commander',
    'Brawl',
    'Historic Brawl',
    'Alchemy',
    'Explorer',
    'Timeless'
  ));

-- Keine neue RLS-Policy nötig: die Spalte wird über dieselben bestehenden Policies auf "decks"
-- gelesen/geschrieben wie alle anderen Spalten der Tabelle auch.
