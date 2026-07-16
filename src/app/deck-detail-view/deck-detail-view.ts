import { Component, inject } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { DeckViewerService } from '../deck-viewer.service';

@Component({
  selector: 'app-deck-detail-view',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './deck-detail-view.html',
  styleUrl: './deck-detail-view.scss',
})
export class DeckDetailView {
  readonly viewer = inject(DeckViewerService);
}
