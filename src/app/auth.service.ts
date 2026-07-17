import { Injectable, signal } from '@angular/core';
import { supabase } from './supabase.client';
import type { User } from '@supabase/supabase-js';

@Injectable({ providedIn: 'root' })
export class AuthService {
  currentUser = signal<User | null>(null);

  /** True, während der Nutzer über einen Passwort-zurücksetzen-Link angekommen ist und noch ein neues Passwort setzen muss. */
  readonly passwordRecovery = signal(false);

  constructor() {
    supabase.auth.getSession().then(({ data }) => {
      this.currentUser.set(data.session?.user ?? null);
    });

    supabase.auth.onAuthStateChange((event, session) => {
      this.currentUser.set(session?.user ?? null);
      if (event === 'PASSWORD_RECOVERY') {
        this.passwordRecovery.set(true);
      }
    });
  }

  /** Gibt zurück, ob die E-Mail-Adresse erst noch bestätigt werden muss, bevor ein Login möglich ist. */
  async signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  }

  async signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signOut() {
    await supabase.auth.signOut();
  }

  /** Schickt eine E-Mail mit einem Link zum Zurücksetzen des Passworts. */
  async resetPasswordForEmail(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
  }

  /** Setzt während des Passwort-Zurücksetzen-Vorgangs ein neues Passwort. */
  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    this.passwordRecovery.set(false);
  }
}
