import { Injectable, inject, signal } from '@angular/core';
import { supabase } from './supabase.client';
import { AuthService } from './auth.service';
import { ProfileService } from './profile.service';
import { I18nService } from './i18n.service';

export type FeedbackCategory = 'bug' | 'idea';
export type FeedbackStatus = 'open' | 'done';

export interface FeedbackEntry {
  id: string;
  displayName: string;
  category: FeedbackCategory;
  message: string;
  status: FeedbackStatus;
  createdAt: string;
}

/**
 * Bugreport-/Feedback-Formular (für alle Nutzer) + Verwaltungsansicht (nur für Accounts mit
 * profiles.is_app_admin) - hält den Zustand global, damit der Einreichen-Dialog als eigene,
 * root-level gerenderte Komponente existieren kann (analog DeckPdfService).
 */
@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private readonly auth = inject(AuthService);
  private readonly profileService = inject(ProfileService);
  private readonly i18n = inject(I18nService);

  // --- Einreichen-Dialog (für alle Nutzer) ---

  readonly showDialog = signal(false);
  readonly category = signal<FeedbackCategory>('bug');
  readonly message = signal('');
  readonly busy = signal(false);
  readonly resultMessage = signal('');
  readonly resultIsError = signal(false);

  open(): void {
    this.category.set('bug');
    this.message.set('');
    this.resultMessage.set('');
    this.resultIsError.set(false);
    this.showDialog.set(true);
  }

  close(): void {
    this.showDialog.set(false);
  }

  setCategory(category: FeedbackCategory): void {
    this.category.set(category);
  }

  setMessage(value: string): void {
    this.message.set(value);
  }

  async submit(): Promise<void> {
    const text = this.message().trim();
    const user = this.auth.currentUser();
    if (!text || !user) return;

    this.busy.set(true);
    this.resultMessage.set('');

    const { error } = await supabase.from('feedback').insert({
      user_id: user.id,
      display_name: this.profileService.profile()?.displayName ?? user.email ?? 'Unbekannt',
      category: this.category(),
      message: text,
    });

    this.busy.set(false);

    if (error) {
      console.error('Konnte Feedback nicht senden:', error);
      this.resultIsError.set(true);
      this.resultMessage.set(this.i18n.t('feedback.msg.sendFailed'));
      return;
    }

    this.resultIsError.set(false);
    this.resultMessage.set(this.i18n.t('feedback.msg.sent'));
    this.message.set('');
    setTimeout(() => this.showDialog.set(false), 1500);
  }

  // --- Verwaltungsansicht (nur App-Admins) ---

  readonly entries = signal<FeedbackEntry[]>([]);
  readonly entriesLoading = signal(false);
  readonly entriesLoaded = signal(false);
  readonly showDoneEntries = signal(false);

  async loadEntries(): Promise<void> {
    this.entriesLoading.set(true);
    const { data, error } = await supabase
      .from('feedback')
      .select('id, display_name, category, message, status, created_at')
      .order('created_at', { ascending: false });

    this.entriesLoading.set(false);
    this.entriesLoaded.set(true);

    if (error || !data) {
      console.error('Konnte Feedback-Einträge nicht laden:', error);
      this.entries.set([]);
      return;
    }

    this.entries.set(
      data.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        category: row.category,
        message: row.message,
        status: row.status,
        createdAt: row.created_at,
      }))
    );
  }

  toggleShowDone(): void {
    this.showDoneEntries.update((v) => !v);
  }

  async setStatus(id: string, status: FeedbackStatus): Promise<void> {
    const { error } = await supabase.from('feedback').update({ status }).eq('id', id);
    if (error) {
      console.error('Konnte Feedback-Status nicht ändern:', error);
      return;
    }
    this.entries.update((list) => list.map((e) => (e.id === id ? { ...e, status } : e)));
  }
}
