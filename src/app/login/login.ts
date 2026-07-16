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
  readonly loading = signal(false);

  toggleMode() {
    this.mode.set(this.mode() === 'signin' ? 'signup' : 'signin');
    this.errorMessage.set(null);
  }

  async submit() {
    this.errorMessage.set(null);
    this.loading.set(true);
    try {
      if (this.mode() === 'signup') {
        await this.auth.signUp(this.email(), this.password());
      } else {
        await this.auth.signIn(this.email(), this.password());
      }
    } catch (err: any) {
      this.errorMessage.set(err?.message ?? 'Etwas ist schiefgelaufen.');
    } finally {
      this.loading.set(false);
    }
  }
}