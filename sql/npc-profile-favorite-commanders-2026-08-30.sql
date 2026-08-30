-- NPC-Profile (accountlose Spieler, players.user_id ist null) bekommen ein eigenes
-- Lieblingscommander-Feld, analog zu profiles.favorite_commanders bei echten Accounts - vom Host
-- über den Gruppen-Tab pflegbar (siehe MtgService.setPlayerFavoriteCommanders).
--
-- Wird beim Verknüpfen mit einem Account per Alles-oder-nichts-Regel übernommen (nur wenn der
-- Account noch KEINE eigenen Lieblingscommander gesetzt hat) und danach am NPC-Eintrag wieder
-- geleert - siehe MtgService.linkPlayerToUser.
--
-- Manuell im Supabase SQL-Editor ausführen (keine DB-Zugangsdaten in dieser Session).

alter table public.players
  add column if not exists favorite_commanders text[] not null default '{}';

-- Keine neue RLS-Policy nötig: die bestehende Policy "self or host can update players"
-- (security-fixes-2026-08-26.sql) erlaubt bereits ein UPDATE beliebiger Spalten der Zeile durch
-- den verknüpften Account selbst ODER den Host der Gruppe - das deckt auch diese neue Spalte ab.
