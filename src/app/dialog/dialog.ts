import { Component, inject } from '@angular/core';
import { DialogService } from '../dialog.service';
import { I18nService } from '../i18n.service';

/** Globales Overlay für DialogService.confirm()/alert() - gemountet in app.html. */
@Component({
  selector: 'app-dialog',
  imports: [],
  templateUrl: './dialog.html',
  styleUrl: './dialog.scss',
})
export class Dialog {
  readonly dialog = inject(DialogService);
  readonly i18n = inject(I18nService);

  respond(value: boolean): void {
    this.dialog.respond(value);
  }
}
