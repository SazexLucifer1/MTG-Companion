-- Spielmodi lassen sich jetzt aus zwei unabhängigen Dropdowns zusammensetzen: Kategorie
-- (Normal/Two-Headed Giant/Archenemy/Cube/Draft/Spezialevent) UND Format (Commander/Modern/...),
-- kombinierbar (z.B. Cube+Modern) - siehe models.ts GameMode/DeckFormat, GameSessionService.setMode(),
-- match-tab.html. matches.game_mode/tournaments.game_mode enthielten bisher (nach PR #174) teils
-- direkt einen Format-String statt einer Kategorie (z.B. "Modern" statt "Commander") - dieses
-- Skript trennt beides sauber in zwei Spalten je Tabelle.
--
-- Manuell im Supabase SQL-Editor ausführen (keine DB-Zugangsdaten in dieser Session).

alter table public.matches add column if not exists game_format text;
alter table public.tournaments add column if not exists game_format text;

-- Schritt 1: Zeilen, deren game_mode bereits direkt ein Format ist (nur möglich im kurzen Zeitfenster
-- zwischen PR #174 und diesem Fix) - Format übernehmen, Kategorie auf 'Normal' zurücksetzen.
update public.matches
set game_format = game_mode,
    game_mode = 'Normal'
where game_mode in (
  'Standard', 'Pioneer', 'Modern', 'Legacy', 'Vintage', 'Pauper',
  'Commander', 'Pauper Commander', 'Brawl', 'Historic Brawl',
  'Alchemy', 'Explorer', 'Timeless'
);

update public.tournaments
set game_format = game_mode,
    game_mode = 'Normal'
where game_mode in (
  'Standard', 'Pioneer', 'Modern', 'Legacy', 'Vintage', 'Pauper',
  'Commander', 'Pauper Commander', 'Brawl', 'Historic Brawl',
  'Alchemy', 'Explorer', 'Timeless'
);

-- Schritt 2: Alle übrigen bestehenden Zeilen (echte Kategorien: Two-Headed Giant/Archenemy/Cube/
-- Draft, sowie die eben auf 'Normal' gesetzten) waren schon immer Commander - diese App war bis zu
-- diesem Feature reine Commander-App. Spezialevent bekommt bewusst kein Format.
update public.matches
set game_format = 'Commander'
where game_format is null and game_mode <> 'Spezialevent';

update public.tournaments
set game_format = 'Commander'
where game_format is null and game_mode <> 'Spezialevent';

-- CHECK-Constraints: game_mode auf die 6 Kategorien beschränken, game_format auf die offizielle
-- Formatliste (siehe deck-format-check-2026-09-03.sql) oder NULL (nur bei Spezialevent gültig).
alter table public.matches drop constraint if exists matches_game_mode_check;
alter table public.matches
  add constraint matches_game_mode_check
  check (game_mode in ('Normal', 'Two-Headed Giant', 'Archenemy', 'Cube', 'Draft', 'Spezialevent'));

alter table public.matches drop constraint if exists matches_game_format_check;
alter table public.matches
  add constraint matches_game_format_check
  check (game_format is null or game_format in (
    'Standard', 'Pioneer', 'Modern', 'Legacy', 'Vintage', 'Pauper',
    'Commander', 'Pauper Commander', 'Brawl', 'Historic Brawl',
    'Alchemy', 'Explorer', 'Timeless'
  ));

alter table public.tournaments drop constraint if exists tournaments_game_mode_check;
alter table public.tournaments
  add constraint tournaments_game_mode_check
  check (game_mode in ('Normal', 'Two-Headed Giant', 'Archenemy', 'Cube', 'Draft', 'Spezialevent'));

alter table public.tournaments drop constraint if exists tournaments_game_format_check;
alter table public.tournaments
  add constraint tournaments_game_format_check
  check (game_format is null or game_format in (
    'Standard', 'Pioneer', 'Modern', 'Legacy', 'Vintage', 'Pauper',
    'Commander', 'Pauper Commander', 'Brawl', 'Historic Brawl',
    'Alchemy', 'Explorer', 'Timeless'
  ));

-- Keine neue RLS-Policy nötig: beide neuen Spalten werden über dieselben bestehenden Policies auf
-- "matches"/"tournaments" gelesen/geschrieben wie alle anderen Spalten der Tabellen auch.
