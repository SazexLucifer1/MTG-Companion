import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeckImportService } from '../deck-import.service';

@Component({
  selector: 'app-deck-import-dialogs',
  imports: [FormsModule],
  templateUrl: './deck-import-dialogs.html',
  styleUrl: './deck-import-dialogs.scss',
})
export class DeckImportDialogs {
  readonly importService = inject(DeckImportService);
}
