import { Component, inject } from '@angular/core';
import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeckViewerService } from '../deck-viewer.service';

@Component({
  selector: 'app-deck-detail-view',
  imports: [DatePipe, DecimalPipe, PercentPipe, FormsModule],
  templateUrl: './deck-detail-view.html',
  styleUrl: './deck-detail-view.scss',
})
export class DeckDetailView {
  readonly viewer = inject(DeckViewerService);

  curveBarHeight(count: number): number {
    const max = Math.max(1, ...this.viewer.manaCurve().map((b) => b.count));
    return count === 0 ? 0 : Math.max(6, (count / max) * 100);
  }

  pipBarWidth(count: number): number {
    const max = Math.max(1, ...this.viewer.pipDistribution().map((p) => p.count));
    return count === 0 ? 0 : Math.max(6, (count / max) * 100);
  }

  private readonly expandedEdhrecCategories = new Set<string>();

  isEdhrecCategoryExpanded(tag: string): boolean {
    return this.expandedEdhrecCategories.has(tag);
  }

  toggleEdhrecCategory(tag: string): void {
    if (this.expandedEdhrecCategories.has(tag)) this.expandedEdhrecCategories.delete(tag);
    else this.expandedEdhrecCategories.add(tag);
  }
}
