import { Component, inject, signal } from '@angular/core';
import { AuthService } from '../auth.service';
import { I18nService } from '../i18n.service';

@Component({
  selector: 'app-reset-password',
  imports: [],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.scss',
})
export class ResetPassword {
  private readonly auth = inject(AuthService);
  readonly i18n = inject(I18nService);

  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly errorMessage = signal<string | null>(null);
  readonly busy = signal(false);

  async submit(): Promise<void> {
    this.errorMessage.set(null);

    if (this.password().length < 6) {
      this.errorMessage.set(this.i18n.t('resetPassword.msg.tooShort'));
      return;
    }
    if (this.password() !== this.confirmPassword()) {
      this.errorMessage.set(this.i18n.t('resetPassword.msg.mismatch'));
      return;
    }

    this.busy.set(true);
    try {
      await this.auth.updatePassword(this.password());
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? this.i18n.t('login.msg.genericError'));
    } finally {
      this.busy.set(false);
    }
  }
}
