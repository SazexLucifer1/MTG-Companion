-- Rollen/Rechte-System: NPC-Profil / Player-Profil / Admin / Developer.
--
-- Bisher konnte ein Gruppen-Host über MtgService.linkPlayerToUser() (beim Verknüpfen einer NPC mit
-- einem Account) unbeabsichtigt in profiles.favorite_commanders eines FREMDEN echten Accounts
-- schreiben - der einzige Codepfad, über den ein "Admin" tatsächlich ins Profil eines anderen
-- Spielers schreiben konnte (siehe Fix in MtgService.linkPlayerToUser). Diese Migration ergänzt die
-- serverseitige Durchsetzung dazu:
--   - NPC (players.user_id is null): Host darf weiterhin alles ändern (bestehende Policies/Rechte,
--     unverändert).
--   - Player-Profil (profiles): nur der Account selbst oder ein Developer darf schreiben - ein
--     Gruppen-Owner/Admin bekommt HIER bewusst KEINEN Bypass (anders als bei stats-/match-/
--     deck-bezogenen Tabellen), weil Gruppenrechte nur Stats/NPC-Daten abdecken sollen, nicht das
--     Profil eines fremden echten Accounts.
--   - Developer: profiles.is_app_admin wird zu profiles.is_developer umgewidmet (bisher nur
--     Feedback-Sichtbarkeit, jetzt zusätzlich genereller Support/Debugging-Bypass).
--
-- Manuell im Supabase SQL-Editor ausführen (keine DB-Zugangsdaten in dieser Session).

-- =====================================================================================
-- 1. is_app_admin -> is_developer umbenennen (Spalte + Bedeutung).
-- =====================================================================================
alter table public.profiles rename column is_app_admin to is_developer;

-- =====================================================================================
-- 2. Helper-Funktion für RLS-Policies, analog has_group_permission() in
--    sql/group-member-permissions-2026-08-31.sql.
-- =====================================================================================
create or replace function public.is_developer(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select p.is_developer from profiles p where p.id = p_user_id), false);
$$;

grant execute on function public.is_developer(uuid) to authenticated;

-- =====================================================================================
-- 3. players: additive Policy, damit der Developer zu Support-/Debugging-Zwecken auch
--    Spieler-/NPC-Daten in Gruppen reparieren kann, in denen er kein Mitglied ist (gleiches
--    additives Muster wie die "granted member can ..."-Policies in
--    sql/group-member-permissions-2026-08-31.sql - bestehende Policies bleiben unverändert).
-- =====================================================================================
drop policy if exists "developer can update players" on public.players;
create policy "developer can update players"
on public.players
for update
to public
using (is_developer(auth.uid()))
with check (is_developer(auth.uid()));

-- =====================================================================================
-- 4. MANUELL NACHZUZIEHEN: profiles-UPDATE-Policy.
--
-- Die aktuelle UPDATE-Policy von public.profiles liegt nicht in diesem Repo (nur live in
-- Supabase) und kann daher nicht blind per "drop policy if exists <bekannter Name>" ersetzt werden
-- (siehe gleiches Problem im "MANUELL NACHZUZIEHEN"-Abschnitt von
-- sql/group-member-permissions-2026-08-31.sql). Bitte im Supabase Studio unter
-- Authentication/Database -> Policies -> profiles die bestehende UPDATE-Policy öffnen und ihre
-- using/with-check-Bedingung um den Developer-Bypass erweitern (voraussichtlich aktuell
-- "auth.uid() = id" o.ä.):
--
--   using (auth.uid() = id or is_developer(auth.uid()))
--   with check (auth.uid() = id or is_developer(auth.uid()))
--
-- Das ist die eigentliche serverseitige Durchsetzung von "Player darf nur sein eigenes Profil
-- ändern, Admin/Owner bekommt KEINEN Sonderzugriff, nur der Developer schon" - der Bugfix in
-- MtgService.linkPlayerToUser() verhindert den bisher bekannten Codepfad bereits clientseitig,
-- diese Policy ist die zusätzliche Absicherung auf DB-Ebene für jeden anderen (auch künftigen)
-- Schreibversuch auf ein fremdes Profil.
