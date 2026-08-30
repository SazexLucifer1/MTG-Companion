-- Einmaliger Daten-Fix (kein Schema-/Policy-Änderung): Die Commander-Namens-Reparatur hat vor dem
-- Bugfix aus PR #138 ("Commander-Auflösung: falsche Zuordnungen bei Teilstring-Treffern
-- verhindern") bei Michi ein Match fälschlich von "T'Challa, the Black Panther" (der echte
-- Black-Panther-Precon-Commander) auf "King T'Challa // Black Panther, Hope Enduring" (eine
-- völlig andere Karte, die "T'Challa" nur zufällig im Namen trägt) umbenannt. Der Bug in
-- resolveCommanderCandidate() ist behoben, aber bereits verfälschte Zeilen bleiben so stehen -
-- die Reparatur würde den jetzt falschen, aber gültigen Kartennamen nicht mehr anfassen.
--
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Erst den SELECT laufen lassen und prüfen,
-- ob wirklich nur die erwartete(n) Zeile(n) auftauchen - dann erst die UPDATEs. Gefahrlos mehrfach
-- ausführbar (die UPDATEs greifen nach dem ersten Lauf nicht mehr, weil der alte Name dann nirgends
-- mehr steht).

-- 1. Vorschau: welche Zeilen wären betroffen?
select
  mp.id as match_player_id,
  p.display_name,
  mp.commander_name,
  mp.partner_commander_name,
  m.played_at
from match_players mp
join players p on p.id = mp.player_id
join matches m on m.id = mp.match_id
where p.display_name ilike 'michi'
  and (
    mp.commander_name = 'King T''Challa // Black Panther, Hope Enduring'
    or mp.partner_commander_name = 'King T''Challa // Black Panther, Hope Enduring'
  );

-- 2. Korrektur, sobald die Vorschau oben wie erwartet aussieht.
update match_players mp
set commander_name = 'T''Challa, the Black Panther'
from players p
where mp.player_id = p.id
  and p.display_name ilike 'michi'
  and mp.commander_name = 'King T''Challa // Black Panther, Hope Enduring';

update match_players mp
set partner_commander_name = 'T''Challa, the Black Panther'
from players p
where mp.player_id = p.id
  and p.display_name ilike 'michi'
  and mp.partner_commander_name = 'King T''Challa // Black Panther, Hope Enduring';
