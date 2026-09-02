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
      this.applyUser(data.session?.user ?? null);
    });

    supabase.auth.onAuthStateChange((event, session) => {
      this.applyUser(session?.user ?? null);
      if (event === 'PASSWORD_RECOVERY') {
        this.passwordRecovery.set(true);
      }
    });
  }

  /**
   * Setzt currentUser nur dann neu, wenn sich am Account wirklich etwas geändert hat.
   *
   * Supabase erneuert den Token unter anderem genau dann, wenn der Tab aus dem Hintergrund
   * zurückkommt, und feuert dabei TOKEN_REFRESHED/SIGNED_IN mit einem NEUEN User-Objekt für
   * denselben Account. Signale vergleichen per Referenz - ohne diese Prüfung würde also jeder
   * Tab-Wechsel sämtliche Effects auf currentUser() erneut auslösen (Gruppen, Hintergründe,
   * Turnierdaten, Profil ...) und eine Welle paralleler Abfragen samt Neuaufbau ganzer Listen
   * starten. Genau in diesem Moment ist die Seite am anfälligsten dafür, vom Browser wegen
   * Speicherdrucks abgeräumt zu werden - und das endet als weißer Bildschirm.
   *
   * Verglichen wird nicht nur die id: bei einer echten Änderung am Account (E-Mail bestätigt,
   * Passwort geändert -> USER_UPDATED) wandert updated_at mit, das Signal wird dann also sehr wohl
   * aktualisiert.
   */
  private applyUser(user: User | null): void {
    const current = this.currentUser();
    if (
      current &&
      user &&
      current.id === user.id &&
      current.email === user.email &&
      current.updated_at === user.updated_at
    ) {
      return;
    }
    this.currentUser.set(user);
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

  /** Löscht unwiderruflich den eigenen Account (ruft die "delete-account"-Edge-Function auf). */
  async deleteAccount(): Promise<{ success: boolean }> {
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error) {
      console.error('Konnte Account nicht löschen:', error);
      return { success: false };
    }
    await supabase.auth.signOut();
    return { success: true };
  }
}
