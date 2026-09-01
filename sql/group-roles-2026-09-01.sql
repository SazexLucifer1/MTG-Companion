-- Löst die bisherige Einzel-Rechte-Vergabe pro Mitglied (group_member_permissions, siehe
-- sql/group-member-permissions-2026-08-31.sql) durch selbst definierte, benannte ROLLEN ab: der
-- Owner legt in der Gruppen-Rechte-Verwaltung eigene Rollen (Name + Bündel aus GroupPermission-
-- Werten, siehe src/app/group-permissions.ts) an und weist jedem Mitglied genau eine davon zu
-- (GroupService.loadGroupRoles/createRole/updateRole/deleteRole/assignRole).
--
-- Manuell im Supabase SQL-Editor ausführen (keine DB-Zugangsdaten in dieser Session).

-- =====================================================================================
-- 1. Neue Tabelle: welche Rollen gibt es in einer Gruppe, mit welchen Rechten?
-- =====================================================================================
create table if not exists public.group_roles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  permissions text[] not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (group_id, name)
);

alter table public.group_roles enable row level security;

drop policy if exists "group members can view roles" on public.group_roles;
create policy "group members can view roles"
on public.group_roles
for select
to public
using (is_group_member(group_id));

drop policy if exists "host can manage roles" on public.group_roles;
create policy "host can manage roles"
on public.group_roles
for all
to public
using (
  exists (
    select 1 from group_members gm
    where gm.group_id = group_roles.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
)
with check (
  exists (
    select 1 from group_members gm
    where gm.group_id = group_roles.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

-- =====================================================================================
-- 2. group_members: neue Spalte für die zugewiesene Rolle + Policy, damit der Host sie setzen
--    darf. Löschen einer Rolle setzt betroffene Mitglieder automatisch auf "keine Rolle" zurück
--    (on delete set null) - kein manuelles Aufräumen nötig.
-- =====================================================================================
alter table public.group_members
  add column if not exists custom_role_id uuid references public.group_roles(id) on delete set null;

drop policy if exists "host can assign roles" on public.group_members;
create policy "host can assign roles"
on public.group_members
for update
to public
using (
  exists (
    select 1 from group_members gm
    where gm.group_id = group_members.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
)
with check (
  exists (
    select 1 from group_members gm
    where gm.group_id = group_members.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

-- =====================================================================================
-- 3. has_group_permission() umgestellt: der bisherige group_member_permissions-Zweig weicht der
--    zugewiesenen Rolle. Da alle abhängigen Policies (players, tournaments, und die in der
--    "MANUELL NACHZUZIEHEN"-Sektion von sql/group-member-permissions-2026-08-31.sql
--    dokumentierten für matches/decks/groups/etc.) ausschließlich diese Funktion aufrufen, ziehen
--    sie die neue Logik automatisch nach.
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
    select 1 from group_members gm
    join group_roles gr on gr.id = gm.custom_role_id
    where gm.group_id = p_group_id and gm.user_id = auth.uid() and p_permission = any(gr.permissions)
  );
$$;

-- =====================================================================================
-- 4. Migration: bestehende Einzel-Grants (group_member_permissions) in persönliche Rollen
--    überführen, damit beim Umstieg niemand Rechte verliert. group_member_permissions bleibt als
--    Tabelle bestehen (kein Drop, nur nicht mehr gelesen/beschrieben) - für Audit/Rollback.
--    Einmalig auszuführen; bei erneutem Lauf entstehen Duplikat-Rollen (kein Idempotenz-Schutz).
-- =====================================================================================
do $$
declare
  r record;
  new_role_id uuid;
begin
  for r in
    select gmp.group_id, gmp.user_id, array_agg(gmp.permission) as perms, coalesce(p.display_name, 'Unbekannt') as display_name
    from group_member_permissions gmp
    left join profiles p on p.id = gmp.user_id
    group by gmp.group_id, gmp.user_id, p.display_name
  loop
    insert into group_roles (group_id, name, permissions)
    values (r.group_id, 'Migriert: ' || r.display_name, r.perms)
    returning id into new_role_id;

    update group_members
    set custom_role_id = new_role_id
    where group_id = r.group_id and user_id = r.user_id;
  end loop;
end $$;
