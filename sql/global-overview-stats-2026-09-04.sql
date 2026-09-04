-- Übersichts-Kacheln für die "Global"-Ansicht im Statistik-Tab (global-stats.ts): Spiele gesamt,
-- aktive Spieler und gebaute Decks über ALLE Gruppen der Website hinweg - dasselbe, was die
-- Gruppen-Ansicht schon aus den geladenen Matches errechnet. Global geht das nicht clientseitig:
-- RLS lässt einen normalen Query nur die eigenen Gruppen sehen, deshalb - wie bei den beiden
-- bestehenden Global-Funktionen (sql/global-stats-functions-2026-09-03.sql,
-- sql/global-stats-format-filter-2026-09-03.sql) - eine SECURITY DEFINER-Funktion, die
-- ausschließlich Summen liefert, nie einzelne Zeilen oder Spielernamen.
--
-- Setzt voraus, dass sql/match-category-format-split-2026-09-03.sql bereits gelaufen ist
-- (matches.game_format muss existieren).
--
-- Manuell im Supabase-SQL-Editor ausführen (keine DB-Zugangsdaten in dieser Session).
-- Bis das passiert ist, blendet die App die Übersichts-Kacheln einfach aus (siehe
-- DeckService.getGlobalOverviewStats()) - der Rest der Global-Ansicht funktioniert unverändert.

create or replace function public.global_overview_stats(
  p_modes text[] default null,
  p_formats text[] default null
)
returns table (
  games bigint,     -- echte Matches (Excel-Import-Platzhalter rausgerechnet, siehe unten)
  players bigint,   -- Spieler mit mindestens einem gewerteten Match
  decks bigint      -- angelegte, öffentliche Nicht-Precon-Decks
)
language sql
security definer
set search_path = public
stable
as $$
  with counted_matches as (
    -- 'Unbekannt (Import)'/'Archenemy (Import)' sind Platzhalter-Sieger aus dem Excel-Import: der
    -- legt pro real gespieltem Match zusätzlich eine Verlierer-Zeile an. Ohne diesen Filter wäre
    -- "Spiele gesamt" ein Vielfaches der echten Zahl - dieselbe Korrektur wie in
    -- StatsTab.totalGames().
    select m.id
    from matches m
    where m.counts_in_general_stats is distinct from false
      and coalesce(m.winner_name, '') not in ('Unbekannt (Import)', 'Archenemy (Import)')
      and (p_modes is null or m.game_mode = any(p_modes))
      and (p_formats is null or m.game_format = any(p_formats) or m.game_format is null)
  )
  select
    (select count(*) from counted_matches),
    (
      select count(distinct mp.player_id)
      from match_players mp
      join counted_matches cm on cm.id = mp.match_id
      where mp.player_id is not null
    ),
    (
      -- Decks kennen keinen Spielmodus, der Modus-Filter greift hier also bewusst nicht; das
      -- Format kommt dagegen aus decks.format (siehe sql/deck-format-check-2026-09-03.sql).
      select count(*)
      from decks d
      where not d.is_private and not d.is_precon
        and (p_formats is null or d.format = any(p_formats) or d.format is null)
    );
$$;

revoke all on function public.global_overview_stats(text[], text[]) from public;
grant execute on function public.global_overview_stats(text[], text[]) to authenticated, anon;
