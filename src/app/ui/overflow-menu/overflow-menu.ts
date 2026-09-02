import { Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { I18nService } from '../../i18n.service';

/**
 * "⋮"-Knopf, der seine Aktionen in einem Sheet öffnet.
 *
 * Das Muster gab es bereits handgebaut im Ingame-Tracker, und das zugehörige CSS
 * (.options-menu-overlay/.options-menu-sheet) liegt seit Längerem global in styles.scss - aber
 * ohne Komponente drumherum, weshalb es an 41 Stellen mit eigenem signal(false) und eigenem @if
 * nachgebaut wurde.
 *
 * Gegenüber dem Handbau kommen zwei Dinge dazu, die dort überall fehlten: Escape schließt, und der
 * Fokus bleibt im Sheet gefangen (cdkTrapFocus), statt hinter dem Overlay weiterzuwandern.
 *
 * Die Aktionen kommen per Content-Projection vom Aufrufer. Ein Klick im Sheet schließt es nach dem
 * Ausführen automatisch - der Klick des projizierten Buttons läuft zuerst, danach erst dieser hier.
 */
@Component({
  selector: 'app-overflow-menu',
  imports: [A11yModule],
  templateUrl: './overflow-menu.html',
  styleUrl: './overflow-menu.scss',
})
export class OverflowMenu {
  readonly i18n = inject(I18nService);

  /** Vorgelesener Name des Knopfs, z.B. "Weitere Aktionen für Gruppe X". */
  readonly label = input<string>('');
  /** Überschrift im Sheet. Ohne Angabe bleibt das Sheet überschriftenlos. */
  readonly heading = input<string>('');

  readonly open = signal(false);

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    // Fokus zurück auf den auslösenden Knopf, sonst landet er nach dem Schließen am Seitenanfang.
    this.trigger()?.nativeElement.focus();
  }
}
