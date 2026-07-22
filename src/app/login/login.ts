import { Component, inject, signal } from '@angular/core';
import { AuthService } from '../auth.service';
import { I18nService } from '../i18n.service';

@Component({
  selector: 'app-login',
  imports: [],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  readonly i18n = inject(I18nService);

  readonly mode = signal<'signin' | 'signup'>('signin');
  readonly email = signal('');
  readonly password = signal('');
  readonly errorMessage = signal<string | null>(null);
  readonly infoMessage = signal<string | null>(null);
  readonly loading = signal(false);

  toggleMode() {
    this.mode.set(this.mode() === 'signin' ? 'signup' : 'signin');
    this.errorMessage.set(null);
    this.infoMessage.set(null);
  }

  async submit() {
    this.errorMessage.set(null);
    this.infoMessage.set(null);
    this.loading.set(true);
    try {
      if (this.mode() === 'signup') {
        const { needsConfirmation } = await this.auth.signUp(this.email(), this.password());
        if (needsConfirmation) {
          this.infoMessage.set(this.i18n.t('login.msg.signupConfirmation'));
          this.mode.set('signin');
          this.password.set('');
        }
      } else {
        await this.auth.signIn(this.email(), this.password());
      }
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? this.i18n.t('login.msg.genericError'));
    } finally {
      this.loading.set(false);
    }
  }

  // --- Passwort vergessen ---

  readonly showForgot = signal(false);
  readonly forgotEmail = signal('');
  readonly forgotBusy = signal(false);
  readonly forgotMessage = signal<string | null>(null);

  openForgot(): void {
    this.forgotEmail.set(this.email());
    this.forgotMessage.set(null);
    this.showForgot.set(true);
  }

  closeForgot(): void {
    this.showForgot.set(false);
  }

  async submitForgot(): Promise<void> {
    this.forgotBusy.set(true);
    this.forgotMessage.set(null);
    try {
      await this.auth.resetPasswordForEmail(this.forgotEmail());
      this.forgotMessage.set(this.i18n.t('login.msg.forgotSent'));
    } catch (err: any) {
      this.forgotMessage.set(err?.message ?? this.i18n.t('login.msg.genericError'));
    } finally {
      this.forgotBusy.set(false);
    }
  }
}