-- Deck-Auswahl-Dialog (Match-Tab: eigenes Deck wählen / Deck ausleihen) braucht einen Jahresfilter,
-- der bei Precons das tatsächliche MTGJSON-Release-Jahr verwendet statt des Import-Zeitpunkts, und
-- bei allen anderen Decks ein stabiles Anlage-Datum statt updated_at (das sich bei jeder Bearbeitung
-- ändert und daher für "Decks aus Jahr X" ungeeignet ist) - siehe DeckService.loadDecksForOwner/
-- saveDeck() und MatchTab.filteredDeckPickerOptions.
--
-- Manuell im Supabase SQL-Editor ausführen (keine DB-Zugangsdaten in dieser Session).

alter table public.decks
  add column if not exists created_at timestamptz not null default now();

-- Backfill für bereits bestehende Decks: updated_at ist der einzig verfügbare Anhaltspunkt (kein
-- separates Anlage-Datum existierte bisher). NUR EINMAL direkt nach der obigen ALTER TABLE
-- ausführen (bei jedem existierenden Deck steht created_at sonst noch auf dem ALTER-Zeitpunkt) -
-- bei einem versehentlichen zweiten Lauf würde dies bereits korrekt divergierte created_at/
-- updated_at-Werte wieder überschreiben. Für neu angelegte Decks ab jetzt greift stattdessen der
-- obige Spalten-Default (now() beim Insert), dieses UPDATE betrifft die nur einmalig.
update public.decks set created_at = updated_at;

alter table public.decks
  add column if not exists precon_release_year integer;

-- Keine neue RLS-Policy nötig: beide Spalten werden über dieselben bestehenden Policies auf
-- "decks" gelesen/geschrieben wie alle anderen Spalten der Tabelle auch.
