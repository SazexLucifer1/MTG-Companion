-- Fixes für die drei Befunde aus dem ersten Lauf von audit-rls.sql (25.08.2026).
-- Bereits im Supabase-Dashboard ausgeführt und verifiziert - hier nur zur Dokumentation und
-- falls einer dieser Zustände (z.B. durch eine spätere Migration) mal zurückgesetzt wird.
-- Idempotent, gefahrlos mehrfach ausführbar.

-- =====================================================================================
-- 1. search_path für SECURITY DEFINER-Funktionen ohne explizite Angabe (Injection-Vektor).
--    handle_new_user_profile/is_group_member hatten das schon richtig gesetzt.
-- =====================================================================================
alter function public.handle_new_group() set search_path = public;
alter function public.handle_new_user() set search_path = public;

-- =====================================================================================
-- 2. Serverseitige Upload-Limits für die drei aktiv genutzten Storage-Buckets - vorher gab es
--    nur die clientseitige 10-MB-/Bildtyp-Prüfung in der App (profile.service.ts/
--    background.service.ts/deck.service.ts), die über die Storage-API direkt umgehbar war.
-- =====================================================================================
update storage.buckets
set file_size_limit = 10485760, -- 10 MB, spiegelt die App-seitigen Limits
    allowed_mime_types = array['image/*']
where id in ('avatars', 'backgrounds', 'deck-art');

-- =====================================================================================
-- 3. group-backgrounds: verwaister vierter Bucket (im aktuellen App-Code nicht mehr
--    referenziert, vermutlich Rest einer älteren Version des Hintergrundbild-Features,
--    enthielt zum Zeitpunkt des Audits eine Datei). SELECT (öffentlich lesbar) und DELETE
--    (schon über storage.objects.owner beschränkt) waren in Ordnung, nur INSERT erlaubte
--    jedem angemeldeten Nutzer beliebige Pfade statt nur den eigenen - jetzt genauso
--    pfad-beschränkt wie bei den anderen drei Buckets.
-- =====================================================================================
drop policy if exists "Authenticated users can upload group backgrounds" on storage.objects;

drop policy if exists "Eigene group-backgrounds hochladen" on storage.objects;

create policy "Eigene group-backgrounds hochladen"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'group-backgrounds'
  and (storage.foldername(name))[1] = auth.uid()::text
);
