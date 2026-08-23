import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ManualDeckLinkService } from '../manual-deck-link.service';
import { I18nService } from '../i18n.service';

@Component({
  selector: 'app-manual-deck-link-dialog',
  imports: [FormsModule],
  templateUrl: './manual-deck-link-dialog.html',
  styleUrl: './manual-deck-link-dialog.scss',
})
export class ManualDeckLinkDialog {
  readonly linkService = inject(ManualDeckLinkService);
  readonly i18n = inject(I18nService);
}
