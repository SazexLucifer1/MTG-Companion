// NEU
import { Component, inject, input } from '@angular/core';
import { I18nService } from '../i18n.service';
import { LegalPageService } from '../legal-page.service';

@Component({
  selector: 'app-legal-footer',
  imports: [],
  templateUrl: './legal-footer.html',
  styleUrl: './legal-footer.scss',
})
export class LegalFooter {
  readonly i18n = inject(I18nService);
  readonly legal = inject(LegalPageService);

  /**
   * Für den Einsatz innerhalb eines Dialogs (siehe login.html).
   *
   * Dort braucht der Footer weder den Freiraum für die schwebende Tab-Bar noch eine eigene
   * Fläche: der Dialog liegt ohnehin über der Seite und bringt seinen eigenen Untergrund mit.
   * Ohne diesen Schalter zieht der Seiten-Footer das Anmeldefenster unnötig in die Höhe.
   */
  readonly compact = input(false);
}
