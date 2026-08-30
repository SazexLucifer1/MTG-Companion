-- Löst den "Security Definer View"-Kritisch-Fund des Supabase Security Advisors zu
-- public.deck_public_stats auf. Die View war absichtlich mit Ersteller-Rechten gebaut (siehe
-- Kommentar in public-deck-browse-2026-08-26.sql), damit der öffentliche Decks-Suchreiter auch ohne
-- Login/Gruppenmitgliedschaft aggregierte Sieg-/Partienzahlen sehen kann - eine normale View mit
-- "security_invoker" würde dafür an der gruppenbasierten RLS auf match_players/matches scheitern
-- und für anon/authenticated ohne Gruppenzugehörigkeit einfach leer bleiben.
--
-- Statt einer View (die der Advisor grundsätzlich als "Security Definer" kritisiert, sobald sie
-- nicht security_invoker ist) jetzt eine explizite SECURITY DEFINER-Funktion mit fest gesetztem
-- search_path - das ist der von Supabase empfohlene, saubere Weg für genau diesen Anwendungsfall
-- (siehe https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)
-- und behebt zugleich die separate "function search path mutable"-Angriffsklasse (ohne fixen
-- search_path könnte ein Aufrufer über eine eigene Schema-Reihenfolge nicht-schemaqualifizierte
-- Bezeichner umbiegen - hier zwar alle Tabellenverweise schon schemaqualifiziert, aber fester
-- search_path ist Pflicht-Best-Practice für jede SECURITY DEFINER-Funktion).
--
-- Manuell im Supabase SQL-Editor ausführen (keine DB-Zugangsdaten in dieser Session).

drop view if exists public.deck_public_stats;

create or replace function public.deck_public_stats(p_deck_ids uuid[])
returns table (deck_id uuid, games bigint, wins bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    d.id as deck_id,
    count(*) filter (where m.counts_in_general_stats is distinct from false) as games,
    count(*) filter (
      where m.counts_in_general_stats is distinct from false and (
        case
          when m.game_mode = 'Two-Headed Giant' then mp.team is not null and mp.team = m.winner_name
          when m.game_mode = 'Archenemy' then
            case
              when m.winner_name = '__OTHERS__' then not coalesce(mp.is_archenemy, false)
              else p.display_name = m.winner_name
            end
          else p.display_name = m.winner_name
        end
      )
    ) as wins
  from public.decks d
  join public.match_players mp on mp.deck_id = d.id
  join public.matches m on m.id = mp.match_id
  join public.players p on p.id = mp.player_id
  where not d.is_private
    and d.id = any(p_deck_ids)
  group by d.id;
$$;

revoke all on function public.deck_public_stats(uuid[]) from public;
grant execute on function public.deck_public_stats(uuid[]) to anon, authenticated;
