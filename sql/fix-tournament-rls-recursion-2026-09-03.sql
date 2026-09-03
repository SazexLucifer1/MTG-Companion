-- =====================================================================================
-- Turnier-RLS: Endlos-Rekursion (Postgres-Fehler 42P17) beheben
--
-- SYMPTOM (Browser-Konsole, jeder Schreibversuch im Turnier, HTTP 500):
--   code: "42P17"
--   'infinite recursion detected in policy for relation "tournament_matches"'
--   'infinite recursion detected in policy for relation "tournament_match_players"'
--
-- Dadurch schlug JEDER Schreibvorgang auf diese beiden Tabellen fehl:
--   * games_won        -> Bo3-Spielstand blieb bei 0:0 stehen
--   * winner_player_id -> Tisch wurde nie entschieden, das nächste Spiel startete endlos neu
--   * started_at       -> "Konnte Start-Zeitpunkt nicht speichern"
-- und in der Folge auch "Sieger festlegen" (schreibt in dieselben Tabellen).
--
-- URSACHE - zwei Zyklen in security-fixes-2026-08-26.sql:
--   1) SELBSTBEZUG: Die UPDATE-Policy auf tournament_match_players fragt in ihrer eigenen
--      Bedingung tournament_match_players ab (Alias self_tmp, Zeilen 417-421 und 439-443).
--      Eine Policy, die ihre eigene Tabelle liest, löst unmittelbar 42P17 aus.
--   2) GEGENSEITIGKEIT: Die UPDATE-Policy auf tournament_matches (Zeilen 337-366) fragt
--      tournament_match_players ab, dessen Policies wiederum tournament_matches abfragen.
--
-- LÖSUNG: Die Prüfungen wandern in SECURITY DEFINER-Funktionen. Die laufen mit den Rechten
-- ihres Besitzers, weshalb darin KEINE RLS-Prüfung ausgelöst wird - der Kreis ist gebrochen.
-- Die Berechtigungen selbst bleiben inhaltlich UNVERÄNDERT: Organizer ODER Gruppen-Besitzer
-- ODER Teilnehmer genau dieses Tisches. Die Absicherung vom 26.08. wird nicht zurückgenommen.
--
-- NICHT betroffen und deshalb bewusst unangetastet:
--   * tournament_participants und tournament_rounds - deren Policies verweisen nur auf
--     tournaments / players / group_members, kein Zyklus.
--   * Die SELECT-, INSERT- und DELETE-Policies der beiden Tabellen hier. Sie verweisen
--     jeweils nur "in eine Richtung" (tmp -> tm -> tournaments) und laufen nach dem Fix
--     unten in keinen Kreis mehr.
--
-- Das Skript ist idempotent und kann gefahrlos mehrfach ausgeführt werden.
-- Im Supabase-SQL-Editor ausführen.
-- =====================================================================================

-- =====================================================================================
-- 1. Hilfsfunktionen
--
-- SECURITY DEFINER umgeht RLS - deshalb ist "set search_path = public" Pflicht, sonst
-- ließe sich die Funktion über einen manipulierten search_path auf fremde Objekte lenken.
-- Beide Funktionen geben nur einen Boolean über den AKTUELLEN Nutzer zurück bzw. eine ID,
-- die der Aufrufer ohnehin schon besitzt - es fließen keine fremden Daten ab.
-- =====================================================================================

create or replace function public.can_manage_tournament(p_tournament_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    -- Organizer: hat das Turnier selbst angelegt
    select 1
    from public.tournaments t
    where t.id = p_tournament_id
      and t.created_by = auth.uid()
  ) or exists (
    -- Gruppen-Besitzer (Host): darf in seiner Gruppe auch fremde Turniere verwalten
    select 1
    from public.tournaments t
    join public.group_members gm on gm.group_id = t.group_id
    where t.id = p_tournament_id
      and gm.user_id = auth.uid()
      and gm.role = 'owner'
  );
$$;

comment on function public.can_manage_tournament(uuid) is
  'Darf der aktuelle Nutzer dieses Turnier verwalten (Organizer oder Gruppen-Besitzer)? '
  'SECURITY DEFINER, damit der Aufruf aus einer RLS-Policy heraus keine weitere '
  'RLS-Prüfung auslöst - genau das erzeugte vorher Fehler 42P17.';

create or replace function public.plays_at_tournament_table(p_tournament_match_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.tournament_match_players tmp
    join public.players p on p.id = tmp.player_id
    where tmp.tournament_match_id = p_tournament_match_id
      and p.user_id = auth.uid()
  );
$$;

comment on function public.plays_at_tournament_table(uuid) is
  'Sitzt der aktuelle Nutzer selbst an diesem Turnier-Tisch? Trifft für accountlose '
  'Mitspieler (players.user_id IS NULL) nie zu - deren Ergebnisse trägt der Organizer '
  'oder der Gruppen-Besitzer ein. SECURITY DEFINER, siehe can_manage_tournament().';

create or replace function public.tournament_of_match(p_tournament_match_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select tm.tournament_id
  from public.tournament_matches tm
  where tm.id = p_tournament_match_id;
$$;

comment on function public.tournament_of_match(uuid) is
  'Zu welchem Turnier gehört dieser Tisch? Nur ein Nachschlagen der Fremdschlüssel-ID, '
  'damit die Policy auf tournament_match_players can_manage_tournament() aufrufen kann, '
  'ohne selbst tournament_matches abzufragen.';

revoke execute on function public.can_manage_tournament(uuid) from public;
revoke execute on function public.plays_at_tournament_table(uuid) from public;
revoke execute on function public.tournament_of_match(uuid) from public;

grant execute on function public.can_manage_tournament(uuid) to authenticated;
grant execute on function public.plays_at_tournament_table(uuid) to authenticated;
grant execute on function public.tournament_of_match(uuid) to authenticated;

-- =====================================================================================
-- 2. tournament_matches: UPDATE-Policy ohne Zyklus neu anlegen
--
-- Vorher: fragte tournament_match_players direkt ab -> tm -> tmp -> tm.
-- Jetzt:  derselbe Test über plays_at_tournament_table().
-- =====================================================================================

drop policy if exists "table participants, organizer or host can update matches"
  on public.tournament_matches;

create policy "table participants, organizer or host can update matches"
on public.tournament_matches
for update
to public
using (
  public.can_manage_tournament(tournament_matches.tournament_id)
  or public.plays_at_tournament_table(tournament_matches.id)
)
with check (
  public.can_manage_tournament(tournament_matches.tournament_id)
  or public.plays_at_tournament_table(tournament_matches.id)
);

-- =====================================================================================
-- 3. tournament_match_players: UPDATE-Policy ohne Selbstbezug neu anlegen
--
-- Vorher: prüfte über den Alias self_tmp die eigene Tabelle -> sofortige Rekursion.
--         Das ist die Policy, die den Bo3-Spielstand (games_won) blockiert hat.
-- Jetzt:  derselbe Test über plays_at_tournament_table().
-- =====================================================================================

drop policy if exists "table participants, organizer or host can update match players"
  on public.tournament_match_players;

create policy "table participants, organizer or host can update match players"
on public.tournament_match_players
for update
to public
using (
  public.can_manage_tournament(
    public.tournament_of_match(tournament_match_players.tournament_match_id)
  )
  or public.plays_at_tournament_table(tournament_match_players.tournament_match_id)
)
with check (
  public.can_manage_tournament(
    public.tournament_of_match(tournament_match_players.tournament_match_id)
  )
  or public.plays_at_tournament_table(tournament_match_players.tournament_match_id)
);

-- =====================================================================================
-- 4. Gegenprobe - nach dem Ausführen einzeln laufen lassen
--
-- a) Keine Policy darf mehr ihre eigene Tabelle im Bedingungstext nennen:
--
--    select tablename, policyname, cmd, qual, with_check
--    from pg_policies
--    where schemaname = 'public' and tablename like 'tournament%'
--    order by tablename, cmd;
--
--    Erwartung: bei tournament_match_players/UPDATE und tournament_matches/UPDATE stehen
--    nur noch die drei Funktionsaufrufe, kein "select 1 from tournament_..." mehr.
--
-- b) Schreibtest gegen einen echten Tisch (ersetzt die IDs durch eigene) - darf keinen
--    42P17 mehr werfen:
--
--    update public.tournament_match_players
--       set games_won = games_won
--     where tournament_match_id = '<tisch-id>';
-- =====================================================================================
