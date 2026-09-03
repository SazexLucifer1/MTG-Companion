/** Übersetzungen: stats. Beide Sprachen bewusst nebeneinander - wer eine ändert, sieht die andere. */
export const stats = {
  de: {
    // --- Stats-Tab: Import-Dialog ---
    'stats.importDialogTitle': 'Alte Stats importieren',
    'stats.importDialogHint':
      'Importiert Commander-Statistiken aus einer Excel-Datei (ein Tab pro Spieler mit Deck-Name und Gespielt/Gewonnen je Modus). Die erzeugten Spiele bekommen das Datum 31.12. des unten gewählten Jahres.',
    'stats.importYearLabel': 'Jahr für die importierten Spiele',
    'stats.importCubeLabel': 'Alle importierten Cube-Spiele zuordnen zu',
    'stats.importCubeNone': 'Kein Cube (allgemein, ohne Zuordnung)',
    'stats.importChooseFile': '📥 Excel-Datei wählen',
    'stats.importReading': 'Datei wird gelesen …',
    'stats.importCheckMapping': 'Zuordnung prüfen',
    'stats.importMappingHint':
      '"-- Überspringen --" für Tabs, die du nicht importieren willst (z.B. veraltete Duplikate). Bei "Neuer Spieler" bitte den Namen exakt eintragen.',
    'stats.importSkip': '-- Überspringen --',
    'stats.importNewPlayer': '➕ Neuer Spieler',
    'stats.importNewPlayerNamePlaceholder': 'Name des neuen Spielers',
    'stats.importing': 'Importiere …',
    'stats.import': 'Importieren',
    'stats.cancel': 'Abbrechen',
    'stats.close': 'Schließen',
    'stats.importOpenAria': 'Alte Stats importieren',

    // --- Stats-Tab: Meldungen (aus stats-tab.ts) ---
    'stats.msg.fileReadError':
      'Datei konnte nicht gelesen werden. Ist es eine gültige .xlsx-Datei?',
    'stats.msg.noMappingSelected': 'Keine Zuordnung ausgewählt – nichts importiert.',
    'stats.msg.recognizingCommanders': 'Erkenne Commander aus den Deck-Kommentaren …',
    'stats.msg.recognizingProgress': 'Erkenne Commander … {{done}} / {{total}}',
    'stats.msg.importingGames':
      'Importiere {{count}} Spiele … das kann etwas dauern, bitte warten.',
    'stats.msg.importDone':
      '{{games}} Spiele aus {{sheets}} Deck-Tab(s) importiert (Jahr {{year}}).',
    'stats.msg.unknownDeleteError': 'Unbekannter Fehler beim Löschen.',

    // --- Stats-Tab: Übersicht/Filter ---
    'stats.title': 'Statistiken',
    'stats.viewStats': '📊 Statistik',
    'stats.viewTournaments': '🏆 Turniere',
    'stats.noMatchesYet':
      'Noch keine Matches gespeichert. Trage im Tab „Match" dein erstes Ergebnis ein!',
    'stats.lockedHint':
      'Der Stats-Tab ist gerade von der veranstaltenden Person gesperrt (z.B. bis zur Jahresend-Enthüllung). Schau später nochmal vorbei!',
    'stats.periodAndMode': 'Zeitraum & Modus',
    'stats.allTime': 'Alle Zeiten',
    'stats.allModes': 'Alle Modi',
    'stats.lockedModesSingular': 'ist für dich gesperrt',
    'stats.lockedModesPlural': 'sind für dich gesperrt',
    'stats.lockedModesSuffix':
      'und daher nicht auswählbar. Wende dich an den Admin der Gruppe, falls du Zugriff haben möchtest.',
    'stats.chooseModeHint': 'Wähle mindestens einen Modus aus, um Stats zu sehen.',

    // --- Stats-Tab: Spieler-Details ---
    'stats.playerDetails': 'Spieler-Details',
    'stats.statsForModeOnly': 'Zeigt Stats von {{player}} nur im Modus „{{mode}}".',
    'stats.choosePlayerHint': 'Wähle einen Spieler aus, um seine Stats zu sehen.',
    'stats.searchPlayerPlaceholder': 'Spieler suchen …',
    'stats.noPlayerFound': 'Kein Spieler gefunden.',
    'stats.changePlayer': 'Ändern',
    'stats.noMatchesForPlayer': '{{player}} hat noch keine Matches gespielt.',
    'stats.noMatchesForPlayerInMode':
      '{{player}} hat im Modus „{{mode}}" noch keine Matches gespielt.',
    'stats.games': 'Spiele',
    'stats.wins': 'Siege',
    'stats.winRate': 'Winrate',
    'stats.avgPlacement': 'Ø-Platzierung ({{count}})',
    'stats.byGameMode': 'Nach Spielmodus',
    'stats.decks': 'Decks',
    'stats.playedCommanders': 'Gespielte Commander',
    'stats.from': 'von {{name}}',

    // --- Stats-Tab: Head-to-Head ---
    'stats.h2h.title': 'Head-to-Head',
    'stats.h2h.hint':
      'Direkte Bilanz zwischen zwei Spielern - berücksichtigt nur live getrackte Spiele, keine per Excel importierten alten Partien.',
    'stats.h2h.playerA': 'Spieler A',
    'stats.h2h.playerB': 'Spieler B',
    'stats.h2h.choosePlayer': 'Bitte wählen…',
    'stats.h2h.choosePlayersHint': 'Wähle zwei Spieler aus, um ihre direkte Bilanz zu sehen.',
    'stats.h2h.samePlayerHint': 'Bitte zwei unterschiedliche Spieler auswählen.',
    'stats.h2h.noGames': '{{a}} und {{b}} haben noch nicht gemeinsam gespielt.',
    'stats.h2h.gamesTogether': 'Gemeinsame Spiele',
    'stats.h2h.winsOf': 'Siege {{name}}',
    'stats.h2h.otherWinner': 'Andere',
    'stats.h2h.commandersOf': 'Commander von {{name}} in diesen Spielen',

    // --- Stats-Tab: Gesamt/Rangliste ---
    'stats.noMatchesInMode': 'Für diesen Modus wurden noch keine Matches gespeichert.',
    'stats.overview': 'Übersicht',
    'stats.totalGames': 'Spiele gesamt',
    'stats.activePlayers': 'Aktive Spieler',
    'stats.commanders': 'Commander',
    'stats.ranking': 'Spieler-Rangliste',
    'stats.notEnoughGamesForRanking':
      'Noch niemand hat genug Spiele für die Rangliste – siehe Qualifikation unten.',
    'stats.notEnoughGamesForRankingDecks':
      'Noch nichts hat genug Spiele für die Rangliste – siehe Qualifikation unten.',
    'stats.previousPage': 'Vorherige Seite',
    'stats.nextPage': 'Nächste Seite',
    'stats.of': 'von',
    'stats.gamesUntilQualification': 'Spiele bis zur Qualifikation',
    'stats.qualificationHint':
      'Ab {{threshold}} Spielen (in diesem Zeitraum/Modus) erscheinen Spieler in der Rangliste.',
    'stats.stillNeeded': 'noch {{count}}',
    'stats.decksAndCommanders': 'Rangliste der Decks & Commander',
    'stats.decksAndCommandersHint':
      'Eigenständige (Nicht-Precon-)Decks bleiben einzeln, Precons und noch nicht verlinkte Commander sind pro Commander zusammengefasst.',
    'stats.playedBy': 'gespielt von',
    'stats.playerQualificationToggle': '▸ Spieler anzeigen ({{count}})',
    'stats.playerQualificationToggleExpanded': '▾ Spieler anzeigen ({{count}})',
    'stats.qualificationToggle': '▸ Spiele bis zur Qualifikation ({{count}})',
    'stats.qualificationToggleExpanded': '▾ Spiele bis zur Qualifikation ({{count}})',

    // --- Stats-Tab: Danger Zone ---
    'stats.dangerZone': '⚠️ Danger Zone',
    'stats.dangerZoneHint':
      'Löscht unwiderruflich den kompletten Spielverlauf, alle Spieler und deren Hintergrundbilder. Cubes bleiben erhalten. Das kann nicht rückgängig gemacht werden!',
    'stats.resetAll': '🗑️ Alle Statistiken zurücksetzen',
    'stats.reallyDeleteAll': 'Wirklich alles löschen?',
    'stats.deleteConfirmWord': 'LÖSCHEN',
    'stats.deleteConfirmHintPrefix': 'Tippe',
    'stats.deleteConfirmHintSuffix':
      'ein, um zu bestätigen. Verlauf, Statistiken und Spielerliste sind danach unwiderruflich weg.',
    'stats.error': 'Fehler: {{message}}',
    'stats.deleting': 'Lösche …',
    'stats.deleteForever': 'Endgültig löschen',
  },
  en: {
    // --- Stats tab: import dialog ---
    'stats.importDialogTitle': 'Import old stats',
    'stats.importDialogHint':
      'Imports commander stats from an Excel file (one tab per player, with deck name and played/won per mode). The generated games get the date Dec 31 of the year chosen below.',
    'stats.importYearLabel': 'Year for the imported games',
    'stats.importCubeLabel': 'Assign all imported cube games to',
    'stats.importCubeNone': 'No cube (general, unassigned)',
    'stats.importChooseFile': '📥 Choose Excel file',
    'stats.importReading': 'Reading file …',
    'stats.importCheckMapping': 'Check mapping',
    'stats.importMappingHint':
      '"-- Skip --" for tabs you don\'t want to import (e.g. outdated duplicates). For "New player" please enter the name exactly.',
    'stats.importSkip': '-- Skip --',
    'stats.importNewPlayer': '➕ New player',
    'stats.importNewPlayerNamePlaceholder': 'Name of the new player',
    'stats.importing': 'Importing …',
    'stats.import': 'Import',
    'stats.cancel': 'Cancel',
    'stats.close': 'Close',
    'stats.importOpenAria': 'Import old stats',

    // --- Stats tab: messages (from stats-tab.ts) ---
    'stats.msg.fileReadError': 'File could not be read. Is it a valid .xlsx file?',
    'stats.msg.noMappingSelected': 'No mapping selected – nothing imported.',
    'stats.msg.recognizingCommanders': 'Recognizing commanders from deck comments …',
    'stats.msg.recognizingProgress': 'Recognizing commanders … {{done}} / {{total}}',
    'stats.msg.importingGames': 'Importing {{count}} games … this may take a while, please wait.',
    'stats.msg.importDone': '{{games}} games from {{sheets}} deck tab(s) imported (year {{year}}).',
    'stats.msg.unknownDeleteError': 'Unknown error while deleting.',

    // --- Stats tab: overview/filters ---
    'stats.title': 'Stats',
    'stats.viewStats': '📊 Stats',
    'stats.viewTournaments': '🏆 Tournaments',
    'stats.noMatchesYet': 'No matches saved yet. Enter your first result in the "Match" tab!',
    'stats.lockedHint':
      'The Stats tab is currently locked by the organizer (e.g. until the year-end reveal). Check back later!',
    'stats.periodAndMode': 'Period & Mode',
    'stats.allTime': 'All time',
    'stats.allModes': 'All modes',
    'stats.lockedModesSingular': 'is locked for you',
    'stats.lockedModesPlural': 'are locked for you',
    'stats.lockedModesSuffix':
      'and therefore not selectable. Contact the group admin if you would like access.',
    'stats.chooseModeHint': 'Choose at least one mode to see stats.',

    // --- Stats tab: player details ---
    'stats.playerDetails': 'Player Details',
    'stats.statsForModeOnly': 'Shows stats for {{player}} only in mode "{{mode}}".',
    'stats.choosePlayerHint': 'Choose a player to see their stats.',
    'stats.searchPlayerPlaceholder': 'Search player …',
    'stats.noPlayerFound': 'No player found.',
    'stats.changePlayer': 'Change',
    'stats.noMatchesForPlayer': '{{player}} has not played any matches yet.',
    'stats.noMatchesForPlayerInMode':
      '{{player}} has not played any matches in mode "{{mode}}" yet.',
    'stats.games': 'Games',
    'stats.wins': 'Wins',
    'stats.winRate': 'Win Rate',
    'stats.avgPlacement': 'Avg. placement ({{count}})',
    'stats.byGameMode': 'By game mode',
    'stats.decks': 'Decks',
    'stats.playedCommanders': 'Played commanders',
    'stats.from': 'from {{name}}',

    // --- Stats tab: head-to-head ---
    'stats.h2h.title': 'Head-to-head',
    'stats.h2h.hint':
      'Direct record between two players - only counts live-tracked games, not old games imported from Excel.',
    'stats.h2h.playerA': 'Player A',
    'stats.h2h.playerB': 'Player B',
    'stats.h2h.choosePlayer': 'Please choose…',
    'stats.h2h.choosePlayersHint': 'Choose two players to see their head-to-head record.',
    'stats.h2h.samePlayerHint': 'Please choose two different players.',
    'stats.h2h.noGames': "{{a}} and {{b}} haven't played together yet.",
    'stats.h2h.gamesTogether': 'Games together',
    'stats.h2h.winsOf': 'Wins {{name}}',
    'stats.h2h.otherWinner': 'Others',
    'stats.h2h.commandersOf': "{{name}}'s commanders in these games",

    // --- Stats tab: overall/ranking ---
    'stats.noMatchesInMode': 'No matches saved yet for this mode.',
    'stats.overview': 'Overview',
    'stats.totalGames': 'Total games',
    'stats.activePlayers': 'Active players',
    'stats.commanders': 'Commanders',
    'stats.ranking': 'Player ranking',
    'stats.notEnoughGamesForRanking':
      'No one has enough games for the ranking yet – see qualification below.',
    'stats.notEnoughGamesForRankingDecks':
      'Nothing has enough games for the ranking yet – see qualification below.',
    'stats.previousPage': 'Previous page',
    'stats.nextPage': 'Next page',
    'stats.of': 'of',
    'stats.gamesUntilQualification': 'Games until qualification',
    'stats.qualificationHint':
      'From {{threshold}} games (in this period/mode) players appear in the ranking.',
    'stats.stillNeeded': '{{count}} more',
    'stats.decksAndCommanders': 'Decks & commanders ranking',
    'stats.decksAndCommandersHint':
      'Standalone (non-precon) decks stay separate; precons and not-yet-linked commanders are grouped per commander.',
    'stats.playedBy': 'played by',
    'stats.playerQualificationToggle': '▸ Show players ({{count}})',
    'stats.playerQualificationToggleExpanded': '▾ Show players ({{count}})',
    'stats.qualificationToggle': '▸ Games until qualification ({{count}})',
    'stats.qualificationToggleExpanded': '▾ Games until qualification ({{count}})',

    // --- Stats tab: danger zone ---
    'stats.dangerZone': '⚠️ Danger Zone',
    'stats.dangerZoneHint':
      'Permanently deletes the entire match history, all players and their background images. Cubes are kept. This cannot be undone!',
    'stats.resetAll': '🗑️ Reset all stats',
    'stats.reallyDeleteAll': 'Really delete everything?',
    'stats.deleteConfirmWord': 'DELETE',
    'stats.deleteConfirmHintPrefix': 'Type',
    'stats.deleteConfirmHintSuffix':
      'to confirm. History, stats and player list will be permanently gone afterwards.',
    'stats.error': 'Error: {{message}}',
    'stats.deleting': 'Deleting …',
    'stats.deleteForever': 'Delete permanently',
  },
};
