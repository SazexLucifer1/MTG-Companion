-- Zwei SECURITY DEFINER-Funktionen für die neue "Global"-Ansicht im Stats-Tab: Decks & Commander
-- sowie Lieblingsfarben/Farbkombinationen über ALLE Spieler der gesamten Website hinweg, nicht nur
-- die eigenen Gruppen. RLS auf players/matches/match_players ist strikt is_group_member(group_id)
-- (siehe security-fixes-2026-08-26.sql) - ein normaler Client-Query sieht grundsätzlich nur die
-- eigenen Gruppen. "Weltweit" ist deshalb nur über eine Funktion mit erhöhten Rechten möglich, die
-- NUR aggregierte Zahlen zurückgibt - exakt das bereits etablierte Muster aus
-- deck-public-stats-function-2026-08-30.sql (dort für die öffentliche Deck-Suche).
--
-- Bewusste Einschränkungen (mit dem User abgestimmt):
--   - Keine Spielernamen: die Decks&Commander-Liste zeigt Name/Bild/Siege/Partien, aber kein
--     "gespielt von X" - sonst gäbe die weltweite Ansicht erstmals Namen aus fremden, nie für eine
--     weltweite Ansicht freigegebenen Gruppen preis.
--   - Private Decks (is_private) bleiben ausgeschlossen, wie bei der öffentlichen Deck-Suche.
--   - Nur an "authenticated" freigegeben, nicht an "anon" - anders als die öffentliche Deck-Suche
--     ist das eine eingeloggte Statistik-Ansicht, kein Marketing-Feature für nicht angemeldete
--     Besucher.
--
-- Manuell im Supabase-SQL-Editor ausführen (keine DB-Zugangsdaten in dieser Session, sql/-Dateien
-- laufen nie automatisch).

create or replace function public.global_deck_commander_stats()
returns table (
  bucket text,               -- 'deck' | 'commander'
  deck_id uuid,
  name text,                 -- Deck- oder Commander-Name
  commander_image_url text,
  games bigint,
  wins bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with deck_bucket as (
    select
      d.id as deck_id,
      d.name as deck_name,
      (
        select dc.image_url from deck_cards dc
        where dc.deck_id = d.id and dc.is_commander and dc.image_url is not null
        limit 1
      ) as commander_image_url,
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
    from decks d
    join match_players mp on mp.deck_id = d.id
    join matches m on m.id = mp.match_id
    join players p on p.id = mp.player_id
    where not d.is_private and not d.is_precon
    group by d.id, d.name
  ),
  commander_bucket as (
    select
      mp.commander_name,
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
    from match_players mp
    join matches m on m.id = mp.match_id
    join players p on p.id = mp.player_id
    left join decks d on d.id = mp.deck_id
    where mp.commander_name is not null
      and (mp.deck_id is null or (d.is_precon and not d.is_private))
    group by mp.commander_name
  )
  select 'deck', deck_id, deck_name, commander_image_url, games, wins
  from deck_bucket
  union all
  select
    'commander',
    null,
    commander_name,
    (
      select dc.image_url from deck_cards dc
      join decks d2 on d2.id = dc.deck_id
      where dc.card_name = commander_bucket.commander_name and dc.is_commander
        and dc.image_url is not null and not d2.is_private
      limit 1
    ),
    games,
    wins
  from commander_bucket;
$$;

revoke all on function public.global_deck_commander_stats() from public;
grant execute on function public.global_deck_commander_stats() to authenticated;

create or replace function public.global_color_and_combo_stats()
returns table (kind text, colors text[], games bigint, decks bigint)
language sql
security definer
set search_path = public
stable
as $$
  with combo as (
    select
      d.color_identity as colors,
      count(*) filter (where m.counts_in_general_stats is distinct from false) as games,
      count(distinct d.id) as decks
    from decks d
    join match_players mp on mp.deck_id = d.id
    join matches m on m.id = mp.match_id
    where not d.is_private and not d.is_precon
    group by d.color_identity
  )
  select 'combo', colors, games, decks from combo
  union all
  select 'axis', array[c], sum(games), sum(decks)
  from combo
  cross join lateral unnest(
    case when cardinality(colors) = 0 then array['C'] else colors end
  ) as c
  group by c;
$$;

revoke all on function public.global_color_and_combo_stats() from public;
grant execute on function public.global_color_and_combo_stats() to authenticated;
