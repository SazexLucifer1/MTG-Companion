import { Component, inject, signal } from '@angular/core';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  imports: [],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);

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
          this.infoMessage.set(
            'Fast geschafft! Wir haben dir eine Bestätigungs-E-Mail geschickt. Bitte bestätige deine Adresse über den Link darin, bevor du dich anmeldest.'
          );
          this.mode.set('signin');
          this.password.set('');
        }
      } else {
        await this.auth.signIn(this.email(), this.password());
      }
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Etwas ist schiefgelaufen.');
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
      this.forgotMessage.set(
        'Falls ein Account mit dieser E-Mail existiert, haben wir dir einen Link zum Zurücksetzen des Passworts geschickt.'
      );
    } catch (err: any) {
      this.forgotMessage.set(err?.message ?? 'Etwas ist schiefgelaufen.');
    } finally {
      this.forgotBusy.set(false);
    }
  }
}