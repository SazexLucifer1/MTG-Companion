import { Component, inject } from '@angular/core';
import { CardPreviewService } from '../card-preview.service';
import { CardImage } from '../card-image/card-image';

@Component({
  selector: 'app-card-preview-dialog',
  imports: [CardImage],
  templateUrl: './card-preview-dialog.html',
  styleUrl: './card-preview-dialog.scss',
})
export class CardPreviewDialog {
  readonly preview = inject(CardPreviewService);
}
