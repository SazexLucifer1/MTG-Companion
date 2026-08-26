-- Nicht-destruktives Sicherheits-Audit für Supabase - liest nur, verändert nichts.
-- Im Supabase-Dashboard unter "SQL Editor" ausführen, Ergebnis der beiden Abfragen zurückmelden.
--
-- Hintergrund: audit-rls.sql (25.08.2026) hat nur geprüft, DASS RLS pro Tabelle aktiv ist und
-- mindestens eine Policy existiert - nicht, WAS die Policy-Bedingungen tatsächlich erlauben.
-- In der App gibt es mehrere Host-/Organizer-/App-Admin-only-Funktionen (Gruppe umbenennen/
-- löschen, Stats-Tab sperren, Qualifikations-Schwellen, Spieler-Sichtbarkeit, Turnier beenden/
-- löschen, Feedback-Verwaltung, Deck-Verwaltung für virtuelle Spieler), die im Angular-Code
-- inzwischen zusätzlich clientseitig geprüft werden - die eigentliche Sicherheitsgrenze ist aber
-- ausschließlich RLS. Diese Abfrage zeigt die tatsächlichen Policy-Bedingungen (qual/with_check),
-- damit sich beurteilen lässt, ob sie wirklich auf Host/Organizer/App-Admin eingeschränkt sind
-- oder zu offen (z.B. "jeder eingeloggte Nutzer"/"jedes Gruppenmitglied").

-- =====================================================================================
-- 1. Policy-Bedingungen der sicherheitsrelevanten Tabellen - qual = Bedingung für
--    SELECT/UPDATE/DELETE (wer darf die Zeile überhaupt sehen/anfassen), with_check =
--    zusätzliche Bedingung für INSERT/UPDATE (wer darf welche NEUEN Werte reinschreiben).
-- =====================================================================================
select
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'groups', 'group_members', 'group_qualification_settings', 'player_stat_visibility',
    'players', 'feedback', 'tournaments', 'tournament_participants', 'tournament_matches',
    'tournament_match_players', 'tournament_rounds', 'decks', 'deck_cards', 'deck_change_log',
    'match_players', 'matches'
  )
order by tablename, cmd, policyname;

-- =====================================================================================
-- 2. Speziell group_members - Privilege-Escalation-Frage: kann sich ein Mitglied selbst zum
--    "owner" befördern (direkter INSERT/UPDATE auf role), obwohl die App das nie tut? Zeigt
--    nur INSERT/UPDATE-Policies auf group_members, damit das gezielt beurteilbar ist.
-- =====================================================================================
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'group_members'
  and cmd in ('INSERT', 'UPDATE')
order by policyname;
