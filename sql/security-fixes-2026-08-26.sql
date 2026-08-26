-- Fixes für die Befunde aus sql/audit-permissions-2026-08-26.sql - schließt echte RLS-Lücken, die
-- über die reinen Angular-Client-Checks aus PR #101 hinausgehen (die App-seitigen Checks sind nur
-- Defense-in-Depth/bessere Fehlermeldungen, die eigentliche Sicherheitsgrenze ist immer diese Datei
-- hier). Im Supabase-Dashboard unter "SQL Editor" ausführen. Nicht komplett idempotent (die
-- "drop policy if exists" + "create policy"-Paare schon, die neue Funktion/Trigger auch dank
-- "or replace"/"if exists" - nur die Storage-artigen "update"-Zeilen aus der letzten Datei gibt es
-- hier nicht, alles unten ist gefahrlos mehrfach ausführbar).

-- =====================================================================================
-- 1. group_members: Privilege-Escalation-Lücke schließen. Die bisherige INSERT-Policy
--    ("Users can join groups via invite") hat nur "user_id = auth.uid()" geprüft - weder den
--    Einladungscode (der wurde nur clientseitig in group.service.ts geprüft) noch die role-Spalte.
--    Jeder eingeloggte Nutzer hätte sich per direktem Insert mit role='owner' in JEDE Gruppe
--    eintragen können, oder ganz ohne gültigen Code beitreten können.
--
--    Lösung: join_group_by_code() als SECURITY DEFINER-Funktion (gleiche Konvention wie
--    handle_new_group()/handle_new_user() - search_path explizit gesetzt gegen Injection). Prüft
--    Code + Ablauf serverseitig, verhindert Doppel-Beitritt, fügt danach SELBST group_members mit
--    fest codiertem role='member' ein (nie vom Client beeinflussbar). Die alte INSERT-Policy wird
--    komplett entfernt - ein direkter Client-Insert in group_members ist danach unmöglich, jeder
--    Beitritt läuft zwingend über diese geprüfte Funktion. group.service.ts::joinGroupByCode() ruft
--    sie über supabase.rpc('join_group_by_code', ...) auf statt selbst zu inserten.
-- =====================================================================================
create or replace function public.join_group_by_code(p_code text)
returns table(group_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select gi.group_id, gi.expires_at into v_invite
  from group_invites gi
  where gi.code = upper(trim(p_code));

  if not found then
    raise exception 'invalid code';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'code expired';
  end if;

  if exists (
    select 1 from group_members gm
    where gm.group_id = v_invite.group_id and gm.user_id = v_uid
  ) then
    raise exception 'already a member';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_invite.group_id, v_uid, 'member');

  return query select v_invite.group_id;
end;
$$;

grant execute on function public.join_group_by_code(text) to authenticated;

drop policy if exists "Users can join groups via invite" on public.group_members;

-- =====================================================================================
-- 2. decks/deck_cards: das is_private-Flag wird von der App selbst clientseitig durchgesetzt
--    (deck-list.ts: readonlyMode() blendet private Decks aus), die bisherigen SELECT-Policies
--    ("... readable by authenticated users") haben es komplett ignoriert - jeder eingeloggte
--    Nutzer konnte als privat markierte Decks direkt per API lesen. Eigentümer-/Host-Zugriff auf
--    eigene private Decks bleibt unberührt (läuft über die separaten ALL-Policies weiter, die hier
--    nicht angefasst werden).
-- =====================================================================================
drop policy if exists "Decks are readable by authenticated users" on public.decks;

create policy "Decks are readable by authenticated users"
on public.decks
for select
to public
using (auth.role() = 'authenticated' and not is_private);

drop policy if exists "Deck cards are readable by authenticated users" on public.deck_cards;

create policy "Deck cards are readable by authenticated users"
on public.deck_cards
for select
to public
using (
  auth.role() = 'authenticated'
  and exists (
    select 1 from decks d
    where d.id = deck_cards.deck_id and not d.is_private
  )
);

-- =====================================================================================
-- 3. players: die bisherige ALL-Policy ("group members access players") plus die redundante
--    UPDATE-Policy ("Group members can update players") erlaubten JEDEM Gruppenmitglied auch
--    UPDATE/DELETE - deckt sich nicht mit der App-Regel (Umbenennen nur der eigene, verknüpfte
--    Account oder der Host; Löschen nur der Host). SELECT/INSERT bleiben für jedes Mitglied offen
--    (Lesen/neue Spieler anlegen ist ein normaler geteilter Vorgang).
-- =====================================================================================
drop policy if exists "group members access players" on public.players;
drop policy if exists "Group members can update players" on public.players;

create policy "group members can view players"
on public.players
for select
to public
using (is_group_member(group_id));

create policy "group members can add players"
on public.players
for insert
to public
with check (is_group_member(group_id));

create policy "self or host can update players"
on public.players
for update
to public
using (
  user_id = auth.uid()
  or exists (
    select 1 from group_members gm
    where gm.group_id = players.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1 from group_members gm
    where gm.group_id = players.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

create policy "host can delete players"
on public.players
for delete
to public
using (
  exists (
    select 1 from group_members gm
    where gm.group_id = players.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

-- =====================================================================================
-- 4. tournaments: mehrere unterschiedlich sensible Spalten in einer einzigen ALL-Policy für
--    "jedes Gruppenmitglied" - status/round_count/current_round sollten nur der Turnier-Organizer
--    ändern dürfen (endTournament/startTournament/startNextRound), count_in_general_stats nur der
--    Gruppen-Host (setCountInGeneralStats - eigenständige Rolle, nicht zwangsläufig der Organizer),
--    results_dismissed dagegen ist unkritisch und wird von jedem Gruppenmitglied geändert (schließt
--    nur die gemeinsame Ergebnis-Ansicht). RLS kann nicht spaltenweise unterscheiden - dafür ein
--    BEFORE-UPDATE-Trigger (gleiche SECURITY-DEFINER/search_path-Konvention wie handle_new_group()).
--    INSERT bleibt bewusst offen für jedes Gruppenmitglied (wird beim Erstellen automatisch dessen
--    eigenes Turnier/Organizer-Rolle).
-- =====================================================================================
drop policy if exists "tournaments_group_members" on public.tournaments;

create policy "group members can view and create tournaments"
on public.tournaments
for select
to public
using (
  exists (select 1 from group_members gm where gm.group_id = tournaments.group_id and gm.user_id = auth.uid())
);

create policy "group members can create tournaments"
on public.tournaments
for insert
to public
with check (
  created_by = auth.uid()
  and exists (select 1 from group_members gm where gm.group_id = tournaments.group_id and gm.user_id = auth.uid())
);

create policy "group members can update tournaments"
on public.tournaments
for update
to public
using (
  exists (select 1 from group_members gm where gm.group_id = tournaments.group_id and gm.user_id = auth.uid())
)
with check (
  exists (select 1 from group_members gm where gm.group_id = tournaments.group_id and gm.user_id = auth.uid())
);

create policy "organizer or host can delete tournaments"
on public.tournaments
for delete
to public
using (
  created_by = auth.uid()
  or exists (
    select 1 from group_members gm
    where gm.group_id = tournaments.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

create or replace function public.check_tournament_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- status/round_count/current_round steuern den Turnierablauf - nur der Organizer.
  if new.status is distinct from old.status
     or new.round_count is distinct from old.round_count
     or new.current_round is distinct from old.current_round
  then
    if old.created_by is distinct from auth.uid() then
      raise exception 'only the organizer can change tournament status/rounds';
    end if;
  end if;

  -- count_in_general_stats ist eine eigenständige Host-Funktion (setCountInGeneralStats),
  -- unabhängig davon wer Organizer ist.
  if new.count_in_general_stats is distinct from old.count_in_general_stats then
    if not exists (
      select 1 from group_members gm
      where gm.group_id = old.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
    ) then
      raise exception 'only the group host can change count_in_general_stats';
    end if;
  end if;

  -- results_dismissed (gemeinsame Ergebnis-Ansicht schließen) bleibt unkritisch, keine Prüfung.
  return new;
end;
$$;

drop trigger if exists tournament_update_guard on public.tournaments;

create trigger tournament_update_guard
before update on public.tournaments
for each row
execute function public.check_tournament_update();

-- =====================================================================================
-- 5. tournament_participants: INSERT für den Organizer (Turnier-Erstellung, legt Teilnehmer für
--    andere an) ODER für die eigene player_id (Spätbeitritt per Code, joinByCode). UPDATE/DELETE
--    für die eigene player_id (confirmJoin), den Organizer (startNextRound had_bye,
--    removeParticipant) oder den Gruppen-Host (mergePlayers).
-- =====================================================================================
drop policy if exists "tournament_participants_group_members" on public.tournament_participants;

create policy "group members can view participants"
on public.tournament_participants
for select
to public
using (
  exists (
    select 1 from tournaments t
    join group_members gm on gm.group_id = t.group_id
    where t.id = tournament_participants.tournament_id and gm.user_id = auth.uid()
  )
);

create policy "organizer or self can add participants"
on public.tournament_participants
for insert
to public
with check (
  exists (select 1 from tournaments t where t.id = tournament_participants.tournament_id and t.created_by = auth.uid())
  or exists (select 1 from players p where p.id = tournament_participants.player_id and p.user_id = auth.uid())
);

create policy "self, organizer or host can update participants"
on public.tournament_participants
for update
to public
using (
  exists (select 1 from players p where p.id = tournament_participants.player_id and p.user_id = auth.uid())
  or exists (select 1 from tournaments t where t.id = tournament_participants.tournament_id and t.created_by = auth.uid())
  or exists (
    select 1 from tournaments t
    join group_members gm on gm.group_id = t.group_id
    where t.id = tournament_participants.tournament_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
)
with check (
  exists (select 1 from players p where p.id = tournament_participants.player_id and p.user_id = auth.uid())
  or exists (select 1 from tournaments t where t.id = tournament_participants.tournament_id and t.created_by = auth.uid())
  or exists (
    select 1 from tournaments t
    join group_members gm on gm.group_id = t.group_id
    where t.id = tournament_participants.tournament_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

create policy "organizer or host can delete participants"
on public.tournament_participants
for delete
to public
using (
  exists (select 1 from tournaments t where t.id = tournament_participants.tournament_id and t.created_by = auth.uid())
  or exists (
    select 1 from tournaments t
    join group_members gm on gm.group_id = t.group_id
    where t.id = tournament_participants.tournament_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

-- =====================================================================================
-- 6. tournament_matches/tournament_match_players: INSERT nur der Organizer (startNextRound legt
--    Runden/Tische an). UPDATE für den Organizer, den Gruppen-Host (mergePlayers) ODER wer selbst
--    Teilnehmer GENAU dieses Tisches ist (canManageMatch-Muster in tournament-panel.ts - normale
--    Spieler müssen ihre eigenen Ergebnisse eintragen/korrigieren können, das ist bewusst NICHT
--    organizer-only). DELETE nur Organizer oder Host (deleteTournament).
-- =====================================================================================
drop policy if exists "tournament_matches_group_members" on public.tournament_matches;

create policy "group members can view matches"
on public.tournament_matches
for select
to public
using (
  exists (
    select 1 from tournaments t
    join group_members gm on gm.group_id = t.group_id
    where t.id = tournament_matches.tournament_id and gm.user_id = auth.uid()
  )
);

create policy "organizer can create matches"
on public.tournament_matches
for insert
to public
with check (
  exists (select 1 from tournaments t where t.id = tournament_matches.tournament_id and t.created_by = auth.uid())
);

create policy "table participants, organizer or host can update matches"
on public.tournament_matches
for update
to public
using (
  exists (select 1 from tournaments t where t.id = tournament_matches.tournament_id and t.created_by = auth.uid())
  or exists (
    select 1 from tournament_match_players tmp
    join players p on p.id = tmp.player_id
    where tmp.tournament_match_id = tournament_matches.id and p.user_id = auth.uid()
  )
  or exists (
    select 1 from tournaments t
    join group_members gm on gm.group_id = t.group_id
    where t.id = tournament_matches.tournament_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
)
with check (
  exists (select 1 from tournaments t where t.id = tournament_matches.tournament_id and t.created_by = auth.uid())
  or exists (
    select 1 from tournament_match_players tmp
    join players p on p.id = tmp.player_id
    where tmp.tournament_match_id = tournament_matches.id and p.user_id = auth.uid()
  )
  or exists (
    select 1 from tournaments t
    join group_members gm on gm.group_id = t.group_id
    where t.id = tournament_matches.tournament_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

create policy "organizer or host can delete matches"
on public.tournament_matches
for delete
to public
using (
  exists (select 1 from tournaments t where t.id = tournament_matches.tournament_id and t.created_by = auth.uid())
  or exists (
    select 1 from tournaments t
    join group_members gm on gm.group_id = t.group_id
    where t.id = tournament_matches.tournament_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

drop policy if exists "tournament_match_players_group_members" on public.tournament_match_players;

create policy "group members can view match players"
on public.tournament_match_players
for select
to public
using (
  exists (
    select 1 from tournament_matches tm
    join tournaments t on t.id = tm.tournament_id
    join group_members gm on gm.group_id = t.group_id
    where tm.id = tournament_match_players.tournament_match_id and gm.user_id = auth.uid()
  )
);

create policy "organizer can add match players"
on public.tournament_match_players
for insert
to public
with check (
  exists (
    select 1 from tournament_matches tm
    join tournaments t on t.id = tm.tournament_id
    where tm.id = tournament_match_players.tournament_match_id and t.created_by = auth.uid()
  )
);

create policy "table participants, organizer or host can update match players"
on public.tournament_match_players
for update
to public
using (
  exists (
    select 1 from tournament_matches tm
    join tournaments t on t.id = tm.tournament_id
    where tm.id = tournament_match_players.tournament_match_id and t.created_by = auth.uid()
  )
  or exists (
    select 1 from tournament_match_players self_tmp
    join players self_p on self_p.id = self_tmp.player_id
    where self_tmp.tournament_match_id = tournament_match_players.tournament_match_id and self_p.user_id = auth.uid()
  )
  or exists (
    select 1 from tournament_matches tm
    join tournaments t on t.id = tm.tournament_id
    join group_members gm on gm.group_id = t.group_id
    where tm.id = tournament_match_players.tournament_match_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
)
with check (
  exists (
    select 1 from tournament_matches tm
    join tournaments t on t.id = tm.tournament_id
    where tm.id = tournament_match_players.tournament_match_id and t.created_by = auth.uid()
  )
  or exists (
    select 1 from tournament_match_players self_tmp
    join players self_p on self_p.id = self_tmp.player_id
    where self_tmp.tournament_match_id = tournament_match_players.tournament_match_id and self_p.user_id = auth.uid()
  )
  or exists (
    select 1 from tournament_matches tm
    join tournaments t on t.id = tm.tournament_id
    join group_members gm on gm.group_id = t.group_id
    where tm.id = tournament_match_players.tournament_match_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

create policy "organizer or host can delete match players"
on public.tournament_match_players
for delete
to public
using (
  exists (
    select 1 from tournament_matches tm
    join tournaments t on t.id = tm.tournament_id
    where tm.id = tournament_match_players.tournament_match_id and t.created_by = auth.uid()
  )
  or exists (
    select 1 from tournament_matches tm
    join tournaments t on t.id = tm.tournament_id
    join group_members gm on gm.group_id = t.group_id
    where tm.id = tournament_match_players.tournament_match_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

-- =====================================================================================
-- 7. tournament_rounds: nur INSERT (startNextRound) und DELETE (deleteTournament) kommen in der
--    App überhaupt vor, kein UPDATE - deshalb auch keine UPDATE-Policy (bleibt implizit gesperrt,
--    entspricht dem bisherigen tatsächlichen Verhalten).
-- =====================================================================================
drop policy if exists "tournament_rounds_group_members" on public.tournament_rounds;

create policy "group members can view rounds"
on public.tournament_rounds
for select
to public
using (
  exists (
    select 1 from tournaments t
    join group_members gm on gm.group_id = t.group_id
    where t.id = tournament_rounds.tournament_id and gm.user_id = auth.uid()
  )
);

create policy "organizer can create rounds"
on public.tournament_rounds
for insert
to public
with check (
  exists (select 1 from tournaments t where t.id = tournament_rounds.tournament_id and t.created_by = auth.uid())
);

create policy "organizer or host can delete rounds"
on public.tournament_rounds
for delete
to public
using (
  exists (select 1 from tournaments t where t.id = tournament_rounds.tournament_id and t.created_by = auth.uid())
  or exists (
    select 1 from tournaments t
    join group_members gm on gm.group_id = t.group_id
    where t.id = tournament_rounds.tournament_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);
