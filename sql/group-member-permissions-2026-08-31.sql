-- Granulares Rechte-System: der Gruppen-Owner kann bisher owner-exklusive Einzelaktionen gezielt an
-- bestimmte Mitglieder freischalten (statt alles-oder-nichts Owner/Mitglied). Siehe
-- GroupService.hasPermission()/grantPermission()/revokePermission() und src/app/group-permissions.ts
-- für den vollständigen Rechte-Katalog.
--
-- Manuell im Supabase SQL-Editor ausführen (keine DB-Zugangsdaten in dieser Session).
--
-- WICHTIGER HINWEIS ZUM UMFANG DIESER MIGRATION:
-- Die App-Seite (Angular) setzt für ALLE ~17 Rechte aus group-permissions.ts sowohl die UI
-- (Buttons/Panels erscheinen nur mit Recht) als auch die Service-Methoden (hasPermission()-Check
-- vor jedem Schreibzugriff) durch - das ist die praktisch wirksame Absicherung für normale Nutzung
-- der App. Für einen Teil der Rechte unten wird zusätzlich die Datenbank-Ebene (RLS) erweitert,
-- für den Rest fehlen mir aus dieser Session heraus die AKTUELLEN Policy-Definitionen der
-- betroffenen Tabellen (matches, match_players, decks, cubes, groups, group_qualification_settings,
-- player_stat_visibility, group_invites, player_backgrounds - deren Policies existieren nur direkt
-- in Supabase, nicht in diesem Repo) - die kann ich nicht blind überschreiben, ohne den bisherigen
-- Zugriff versehentlich zu verengen oder eine Policy mit falschem Namen doppelt anzulegen. Der
-- Abschnitt "MANUELL NACHZUZIEHEN" ganz unten listet für jede dieser Tabellen die exakte
-- has_group_permission()-Bedingung, die dort als zusätzliche (permissive) Policy ergänzt werden
-- sollte, sobald die tatsächliche Policy in Supabase Studio eingesehen werden kann.

-- =====================================================================================
-- 1. Neue Tabelle: welche Person hat in welcher Gruppe welches Einzelrecht?
-- =====================================================================================
create table if not exists public.group_member_permissions (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id),
  primary key (group_id, user_id, permission)
);

alter table public.group_member_permissions enable row level security;

drop policy if exists "group members can view permissions" on public.group_member_permissions;
create policy "group members can view permissions"
on public.group_member_permissions
for select
to public
using (is_group_member(group_id));

drop policy if exists "host can grant permissions" on public.group_member_permissions;
create policy "host can grant permissions"
on public.group_member_permissions
for insert
to public
with check (
  exists (
    select 1 from group_members gm
    where gm.group_id = group_member_permissions.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

drop policy if exists "host can revoke permissions" on public.group_member_permissions;
create policy "host can revoke permissions"
on public.group_member_permissions
for delete
to public
using (
  exists (
    select 1 from group_members gm
    where gm.group_id = group_member_permissions.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

-- =====================================================================================
-- 2. Helper-Funktion für RLS-Policies: Owner ODER explizit vergebenes Einzelrecht.
-- =====================================================================================
create or replace function public.has_group_permission(p_group_id uuid, p_permission text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from group_members gm
    where gm.group_id = p_group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  ) or exists (
    select 1 from group_member_permissions gmp
    where gmp.group_id = p_group_id and gmp.user_id = auth.uid() and gmp.permission = p_permission
  );
$$;

grant execute on function public.has_group_permission(uuid, text) to authenticated;

-- =====================================================================================
-- 3. players: bestehende Policies aus security-fixes-2026-08-26.sql um has_group_permission()
--    erweitert (additive Policy - Postgres kombiniert mehrere permissive Policies für denselben
--    Befehl automatisch per OR, die bisherigen Policies bleiben unverändert bestehen).
-- =====================================================================================
drop policy if exists "granted member can delete players" on public.players;
create policy "granted member can delete players"
on public.players
for delete
to public
using (has_group_permission(players.group_id, 'player.delete'));

drop policy if exists "granted member can rename other players" on public.players;
create policy "granted member can rename other players"
on public.players
for update
to public
using (has_group_permission(players.group_id, 'player.renameOthers'))
with check (has_group_permission(players.group_id, 'player.renameOthers'));

-- =====================================================================================
-- 4. tournaments: "organizer or host can delete tournaments" additiv erweitert, plus
--    check_tournament_update()-Trigger für count_in_general_stats (setCountInGeneralStats) um
--    has_group_permission() erweitert - hier MUSS die Funktion komplett neu definiert werden (kein
--    additiver Mechanismus für Trigger-Funktionen), der Rest der Funktion bleibt unverändert.
-- =====================================================================================
drop policy if exists "granted member can delete tournaments" on public.tournaments;
create policy "granted member can delete tournaments"
on public.tournaments
for delete
to public
using (has_group_permission(tournaments.group_id, 'tournament.manage'));

create or replace function public.check_tournament_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     or new.round_count is distinct from old.round_count
     or new.current_round is distinct from old.current_round
  then
    if old.created_by is distinct from auth.uid() then
      raise exception 'only the organizer can change tournament status/rounds';
    end if;
  end if;

  if new.count_in_general_stats is distinct from old.count_in_general_stats then
    if not has_group_permission(old.group_id, 'tournament.manage') then
      raise exception 'only the group host or a granted member can change count_in_general_stats';
    end if;
  end if;

  return new;
end;
$$;

-- =====================================================================================
-- MANUELL NACHZUZIEHEN (Policy-Definitionen dieser Tabellen liegen nur in Supabase, nicht in
-- diesem Repo - dort jeweils als ZUSÄTZLICHE permissive Policy ergänzen, mit genau dieser using-
-- Bedingung; die bestehende(n) Policy(s) der Tabelle NICHT löschen):
--
--   matches (UPDATE für winner_name/cube_id, DELETE)
--     using (has_group_permission(matches.group_id, 'match.editResult'))   -- winner_name
--     using (has_group_permission(matches.group_id, 'match.editCube'))    -- cube_id
--     using (has_group_permission(matches.group_id, 'match.delete'))      -- delete
--
--   match_players (UPDATE für placement/commander_name/partner_commander_name/deck_id)
--     using (exists (select 1 from matches m where m.id = match_players.match_id
--            and has_group_permission(m.group_id, 'match.editResult')))    -- placement
--     using (exists (select 1 from matches m where m.id = match_players.match_id
--            and has_group_permission(m.group_id, 'match.editCommander'))) -- commander_name etc.
--
--   group_qualification_settings (ALL)
--     using (has_group_permission(group_qualification_settings.group_id, 'stats.qualificationThreshold'))
--
--   player_stat_visibility (ALL)
--     using (has_group_permission(player_stat_visibility.group_id, 'stats.visibility'))
--
--   groups (UPDATE für name, DELETE)
--     using (has_group_permission(groups.id, 'group.rename'))  -- name
--     using (has_group_permission(groups.id, 'group.delete'))  -- delete
--
--   players (UPDATE für favorite_commanders - NPC-Lieblingscommander)
--     using (has_group_permission(players.group_id, 'npc.favoriteCommanders'))
--
--   decks/deck_cards (UPDATE/INSERT/DELETE, wenn decks.player_id zu einem Spieler dieser Gruppe gehört)
--     using (exists (select 1 from players p where p.id = decks.player_id
--            and has_group_permission(p.group_id, 'deck.editOthers')))
--
-- Ohne diese manuellen Ergänzungen bleiben die betroffenen Aktionen serverseitig auf dem
-- BISHERIGEN Zugriffsniveau (meist: jedes Gruppenmitglied, da für diese Tabellen bisher keine
-- eigene owner-only-RLS bekannt ist) - die App selbst verhindert die Nutzung für nicht-berechtigte
-- Mitglieder aber bereits vollständig über hasPermission()-Prüfungen vor jedem Aufruf.
