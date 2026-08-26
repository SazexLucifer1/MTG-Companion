-- Grundlage für den neuen "Decks"-Suchreiter (öffentliche, nicht-private Decks aller Nutzer
-- durchsuchbar/filterbar machen, auch ohne Login - passend zum Rest des Such-Tabs, der laut
-- search-tab.ts bewusst account-frei nutzbar sein soll). Im Supabase-Dashboard unter "SQL Editor"
-- ausführen. Komplett idempotent (alle "add column if not exists"/"create or replace"/
-- "drop policy if exists" + "create policy"-Paare sind gefahrlos mehrfach ausführbar).
--
-- WICHTIGER Hinweis zur Sichtbarkeits-Ausweitung: bisher war jedes nicht-private Deck nur für
-- EINGELOGGTE Nutzer lesbar (RLS-Policy unten), nicht für die Öffentlichkeit. Diese Migration
-- macht jedes nicht-private Deck JEDES Nutzers für JEDEN im Internet lesbar (nicht nur eingeloggte
-- Nutzer). Das ist eine bewusste Produktentscheidung (kein neues, separates Opt-in-Feld), sollte
-- den Nutzern aber im Profil-Tab beim "privat"-Umschalter kommuniziert werden - das ist NICHT Teil
-- dieser Migration.
--
-- deck_change_log bleibt bewusst unangetastet - der neue Suchreiter liest nur decks/deck_cards/
-- deck_public_stats, nie die Änderungshistorie (die enthält u.a. Bearbeiter-Identität, nichts wovon
-- die öffentliche Deck-Suche etwas wissen muss).

-- =====================================================================================
-- 1. Neue Spalten auf decks für Farb-/Typal-Filter im Decks-Suchreiter. Werden NICHT hier befüllt
--    (reine SQL-Migration hat keinen Scryfall-Netzwerkzugriff) - Bestandsdecks bekommen ihre Werte
--    über ein einmaliges Backfill-Skript (siehe scripts/backfill-deck-color-identity.js), neue/
--    bearbeitete Decks schreibt die App ab sofort selbst mit (siehe deck-viewer.service.ts).
-- =====================================================================================
alter table public.decks add column if not exists color_identity text[] not null default '{}';
alter table public.decks add column if not exists commander_types text[] not null default '{}';

comment on column public.decks.color_identity is
  'Scryfall-Farbidentität des/der Commander (z.B. {W,U}) - für den Farb-Filter im öffentlichen Decks-Suchreiter. App-gepflegt, siehe deck-viewer.service.ts.';
comment on column public.decks.commander_types is
  'Kreaturtypen des Commanders aus dessen type_line (z.B. {Human,Cleric}) - für den Typal-Filter im öffentlichen Decks-Suchreiter. App-gepflegt, siehe deck-viewer.service.ts.';

-- =====================================================================================
-- 2. Winrate-Aggregation als View - Portierung von isPlayerWinner() (match-utils.ts) nach SQL,
--    exakt gleiche Fallunterscheidung (Two-Headed Giant/Archenemy/normal). '__OTHERS__' entspricht
--    der ARCHENEMY_OTHERS-Konstante in match-utils.ts.
--
--    Views laufen standardmäßig mit den Rechten des ERSTELLERS (kein "security_invoker"), nicht mit
--    denen des aufrufenden Nutzers - das "where not d.is_private" unten ist deshalb die eigentliche
--    Zugriffsschranke dieser View, nicht RLS auf match_players/matches/players (die haben dafür gar
--    keine öffentliche Policy). Absichtlich so, analog zu einer SECURITY DEFINER-Funktion, aber
--    eng auf reine Zähl-Aggregate beschränkt - keine einzelnen Spielernamen/Partien werden über
--    diese View exponiert, nur deck_id + games + wins pro Deck.
-- =====================================================================================
create or replace view public.deck_public_stats as
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
group by d.id;

grant select on public.deck_public_stats to anon, authenticated;

-- =====================================================================================
-- 3. RLS: decks/deck_cards öffentlich lesbar machen (auch ohne Login), nicht mehr nur für
--    eingeloggte Nutzer - Nachfolger der Policies aus security-fixes-2026-08-26.sql §2. Nur das
--    "auth.role() = 'authenticated' and"-Fragment entfernt, der Rest ist identisch - die separaten
--    Eigentümer-ALL-Policies für private/eigene Decks bleiben unberührt.
-- =====================================================================================
drop policy if exists "Decks are readable by authenticated users" on public.decks;
drop policy if exists "Public decks are readable by anyone" on public.decks;

create policy "Public decks are readable by anyone"
on public.decks
for select
to public
using (not is_private);

drop policy if exists "Deck cards are readable by authenticated users" on public.deck_cards;
drop policy if exists "Public deck cards are readable by anyone" on public.deck_cards;

create policy "Public deck cards are readable by anyone"
on public.deck_cards
for select
to public
using (
  exists (
    select 1 from decks d
    where d.id = deck_cards.deck_id and not d.is_private
  )
);
