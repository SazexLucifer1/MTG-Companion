import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GameSessionService } from '../game-session.service';
import { MtgService } from '../mtg.service';
import { I18nService } from '../i18n.service';
import { ARCHENEMY_OTHERS, DRAW } from '../match-utils';
import { MatchPlayer } from '../models';

/**
 * Erscheint automatisch direkt nachdem ein Live-Match gespeichert wurde (siehe
 * GameSessionService.lastFinishedMatch) und bietet optional an, für jeden Spieler seinen
 * Platz (1., 2., 3., ...) einzutragen - rein zusätzliche Info zum ohnehin gespeicherten
 * Sieger/Verlierer-Status, komplett überspringbar.
 */
@Component({
  selector: 'app-placement-dialog',
  imports: [FormsModule],
  templateUrl: './placement-dialog.html',
  styleUrl: './placement-dialog.scss',
})
export class PlacementDialog {
  readonly session = inject(GameSessionService);
  private readonly mtg = inject(MtgService);
  readonly i18n = inject(I18nService);

  readonly draft = signal<Record<string, number | null>>({});
  readonly saving = signal(false);

  constructor() {
    effect(() => {
      const match = this.session.lastFinishedMatch();
      if (!match) return;
      this.draft.set(initialPlacements(match.players, match.winner));
      this.saving.set(false);
    });
  }

  placementOptions(): number[] {
    const count = this.session.lastFinishedMatch()?.players.length ?? 0;
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  setPlacement(name: string, value: string): void {
    this.draft.update((d) => ({ ...d, [name]: value === '' ? null : Number(value) }));
  }

  async save(): Promise<void> {
    const match = this.session.lastFinishedMatch();
    if (!match) return;

    this.saving.set(true);
    const draft = this.draft();
    await this.mtg.setPlacements(
      match.matchId,
      match.players.map((p) => ({ name: p.name, placement: draft[p.name] ?? null }))
    );
    this.session.lastFinishedMatch.set(null);
  }

  skip(): void {
    this.session.lastFinishedMatch.set(null);
  }
}

/**
 * Befüllt den Platzierungs-Entwurf mit dem beim Live-Tracking schon ausgewählten Sieger vor, damit
 * man ihn nicht ein zweites Mal als "1. Platz" auswählen muss - modusabhängig, da "Sieger" je nach
 * Modus unterschiedlich auf einzelne Spieler abgebildet wird (siehe isPlayerWinner() in
 * match-utils.ts, das dieselbe Fallunterscheidung für die reine Sieg/Niederlage-Frage nutzt).
 * Bleibt bei einem Unentschieden bzw. wenn sich der Sieger keinem Spieler/Team eindeutig zuordnen
 * lässt komplett leer - der Nutzer kann jeden Wert danach trotzdem frei überschreiben.
 */
function initialPlacements(players: MatchPlayer[], winner: string): Record<string, number | null> {
  const archenemy = players.find((p) => p.isArchenemy);
  if (archenemy) {
    if (winner === DRAW) return Object.fromEntries(players.map((p) => [p.name, null]));
    const archenemyWon = winner === archenemy.name;
    return Object.fromEntries(
      players.map((p) => [p.name, !!p.isArchenemy === archenemyWon ? 1 : 2])
    );
  }

  const hasTeams = players.some((p) => p.team);
  if (hasTeams) {
    return Object.fromEntries(players.map((p) => [p.name, p.team ? (p.team === winner ? 1 : 2) : null]));
  }

  return Object.fromEntries(players.map((p) => [p.name, p.name === winner ? 1 : null]));
}
