import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeckPdfService } from '../deck-pdf.service';

@Component({
  selector: 'app-deck-pdf-dialog',
  imports: [FormsModule],
  templateUrl: './deck-pdf-dialog.html',
  styleUrl: './deck-pdf-dialog.scss',
})
export class DeckPdfDialog {
  readonly pdfService = inject(DeckPdfService);
}
