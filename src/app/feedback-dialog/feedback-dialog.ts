import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FeedbackService } from '../feedback.service';
import { I18nService } from '../i18n.service';

@Component({
  selector: 'app-feedback-dialog',
  imports: [FormsModule],
  templateUrl: './feedback-dialog.html',
  styleUrl: './feedback-dialog.scss',
})
export class FeedbackDialog {
  readonly feedback = inject(FeedbackService);
  readonly i18n = inject(I18nService);
}
