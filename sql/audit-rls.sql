-- Nicht-destruktives Sicherheits-Audit für Supabase - liest nur, verändert nichts.
-- Im Supabase-Dashboard unter "SQL Editor" ausführen, Ergebnis der drei Abfragen zurückmelden.
-- Go-Live-Vorbereitung Abschnitt E: RLS-Lücken, SECURITY DEFINER-Funktionen ohne search_path,
-- und Storage-Bucket-Policies finden.

-- =====================================================================================
-- 1. RLS-Status pro Tabelle - zeigt sofort, welche der App-Tabellen kein RLS aktiv haben
--    (rls_enabled = false ist der kritische Fall) oder RLS aktiv haben, aber 0 Policies
--    (dann sperrt RLS praktisch alles, auch für berechtigte Nutzer).
-- =====================================================================================
select
  t.tablename,
  t.rowsecurity as rls_enabled,
  count(p.policyname) as policy_count,
  coalesce(array_agg(p.policyname) filter (where p.policyname is not null), '{}') as policies
from pg_tables t
left join pg_policies p
  on p.schemaname = t.schemaname
  and p.tablename = t.tablename
where t.schemaname = 'public'
  and t.tablename in (
    'backgrounds', 'background_shares', 'cubes', 'deck_cards', 'deck_change_log', 'decks',
    'feedback', 'group_invites', 'group_members', 'group_qualification_settings', 'groups',
    'live_game_sessions', 'match_players', 'matches', 'player_backgrounds', 'player_stat_visibility',
    'players', 'profiles', 'tournament_match_players', 'tournament_matches', 'tournament_participants',
    'tournament_rounds', 'tournaments'
  )
group by t.tablename, t.rowsecurity
order by t.rowsecurity asc, t.tablename;

-- =====================================================================================
-- 2. SECURITY DEFINER-Funktionen - laufen mit den Rechten des Funktions-EIGENTÜMERS statt
--    des Aufrufers und umgehen damit RLS. "config" zeigt an, ob search_path explizit gesetzt
--    ist (z.B. "search_path=public") - fehlt das (config ist NULL/leer), ist die Funktion ein
--    potenzieller Injection-Vektor (siehe Checkliste Abschnitt 3.1).
-- =====================================================================================
select
  n.nspname as schema,
  p.proname as function_name,
  p.prosecdef as is_security_definer,
  p.proconfig as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true
order by p.proname;

-- =====================================================================================
-- 3. Storage-Buckets (avatars/deck-art/backgrounds) - eigener Policy-Namespace, getrennt von
--    den normalen Tabellen-Policies oben. "public" = true bedeutet, jeder kann Dateien lesen,
--    ohne Auth (bei Avataren/Deck-Art meist gewollt, sicherheitshalber trotzdem prüfen).
-- =====================================================================================
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('avatars', 'deck-art', 'backgrounds');

select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
