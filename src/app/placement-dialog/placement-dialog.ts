import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GameSessionService } from '../game-session.service';
import { MtgService } from '../mtg.service';
import { I18nService } from '../i18n.service';

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
      this.draft.set(Object.fromEntries(match.players.map((p) => [p.name, null])));
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
