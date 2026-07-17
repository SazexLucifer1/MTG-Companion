import { Component, inject, signal } from '@angular/core';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-reset-password',
  imports: [],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.scss',
})
export class ResetPassword {
  private readonly auth = inject(AuthService);

  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly errorMessage = signal<string | null>(null);
  readonly busy = signal(false);

  async submit(): Promise<void> {
    this.errorMessage.set(null);

    if (this.password().length < 6) {
      this.errorMessage.set('Das Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }
    if (this.password() !== this.confirmPassword()) {
      this.errorMessage.set('Die Passwörter stimmen nicht überein.');
      return;
    }

    this.busy.set(true);
    try {
      await this.auth.updatePassword(this.password());
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Etwas ist schiefgelaufen.');
    } finally {
      this.busy.set(false);
    }
  }
}
