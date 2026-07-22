import { Injectable, effect, inject, signal } from '@angular/core';
import { supabase } from './supabase.client';
import { AuthService } from './auth.service';

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  favoriteCommanders: string[];
  language: 'de' | 'en';
  /** IDs der schon gesehenen/übersprungenen Einführungs-Touren (z.B. "intro", "match", "deckDetail", ...) - siehe tutorial.service.ts. */
  tutorialsSeen: string[];
  /** Darf eingereichte Bugreports/Feedback aller Nutzer einsehen (siehe feedback.service.ts) - manuell in Supabase gesetzt, kein Selbstbedienungs-Feature. */
  isAppAdmin: boolean;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly auth = inject(AuthService);

  readonly profile = signal<Profile | null>(null);
  readonly loading = signal<boolean>(true);

  /** Ist gesetzt, während im Profil-Tab statt des eigenen Profils das eines anderen Users
   * (nur lesend) angezeigt wird - z.B. nach "Profil ansehen" aus dem Gruppen-Tab. */
  readonly viewingUserId = signal<string | null>(null);
  readonly viewingProfile = signal<{
    displayName: string;
    avatarUrl: string | null;
    favoriteCommanders: string[];
  } | null>(null);
  readonly viewingBusy = signal(false);

  async viewProfile(userId: string): Promise<void> {
    this.viewingUserId.set(userId);
    this.viewingBusy.set(true);
    this.viewingProfile.set(await this.loadPublicProfile(userId));
    this.viewingBusy.set(false);
  }

  stopViewingProfile(): void {
    this.viewingUserId.set(null);
    this.viewingProfile.set(null);
  }

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      if (user) {
        this.loadProfile(user.id);
      } else {
        this.profile.set(null);
        this.loading.set(false);
      }
    });
  }

  private async loadProfile(userId: string): Promise<void> {
    this.loading.set(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, favorite_commanders, language, tutorials_seen, is_app_admin')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Konnte Profil nicht laden:', error);
      this.profile.set(null);
    } else {
      this.profile.set({
        id: data.id,
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
        favoriteCommanders: data.favorite_commanders ?? [],
        language: data.language === 'en' ? 'en' : 'de',
        tutorialsSeen: data.tutorials_seen ?? [],
        isAppAdmin: data.is_app_admin ?? false,
      });
    }
    this.loading.set(false);
  }

  /** Speichert die bevorzugte Sprache am Account, damit sie geräteübergreifend gilt. */
  async updateLanguage(language: 'de' | 'en'): Promise<boolean> {
    const current = this.profile();
    if (!current) return false;

    const { error } = await supabase
      .from('profiles')
      .update({ language })
      .eq('id', current.id);

    if (error) {
      console.error('Konnte Sprache nicht speichern:', error);
      return false;
    }

    this.profile.update((p) => (p ? { ...p, language } : p));
    return true;
  }

  /** Merkt sich, dass der Nutzer eine bestimmte Einführungs-Tour gesehen (oder übersprungen) hat - danach startet genau diese Tour nicht mehr automatisch, ist aber jederzeit über den ❓-Button im Profil erneut wählbar. */
  async markTutorialSeen(tutorialId: string): Promise<boolean> {
    const current = this.profile();
    if (!current) return false;
    if (current.tutorialsSeen.includes(tutorialId)) return true;

    const next = [...current.tutorialsSeen, tutorialId];
    const { error } = await supabase
      .from('profiles')
      .update({ tutorials_seen: next })
      .eq('id', current.id);

    if (error) {
      console.error('Konnte Tutorial-Status nicht speichern:', error);
      return false;
    }

    this.profile.update((p) => (p ? { ...p, tutorialsSeen: next } : p));
    return true;
  }

  /** Maximal 3 Lieblings-Commander. */
  async updateFavoriteCommanders(commanders: string[]): Promise<boolean> {
    const current = this.profile();
    if (!current) return false;

    const trimmed = commanders.slice(0, 3);

    const { error } = await supabase
      .from('profiles')
      .update({ favorite_commanders: trimmed })
      .eq('id', current.id);

    if (error) {
      console.error('Konnte Lieblings-Commander nicht speichern:', error);
      return false;
    }

    this.profile.update((p) => (p ? { ...p, favoriteCommanders: trimmed } : p));
    return true;
  }

  async updateDisplayName(newName: string): Promise<boolean> {
    const trimmed = newName.trim();
    if (!trimmed) return false;

    const current = this.profile();
    if (!current) return false;

    const { error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', current.id);

    if (error) {
      console.error('Konnte Namen nicht ändern:', error);
      return false;
    }

    this.profile.update((p) => (p ? { ...p, displayName: trimmed } : p));
    return true;
  }

  /** Lädt ein neues Profilbild in den "avatars"-Storage-Bucket hoch und verknüpft es mit dem Profil. */
  async uploadAvatar(file: File): Promise<boolean> {
    const current = this.profile();
    if (!current) return false;

    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${current.id}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      console.error('Konnte Profilbild nicht hochladen:', uploadError);
      return false;
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    // Cache-Busting, sonst zeigt der Browser nach einem erneuten Upload das alte Bild aus dem Cache.
    const avatarUrl = `${data.publicUrl}?t=${Date.now()}`;

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl })
      .eq('id', current.id);

    if (updateError) {
      console.error('Konnte Profilbild-URL nicht speichern:', updateError);
      return false;
    }

    this.profile.update((p) => (p ? { ...p, avatarUrl } : p));
    return true;
  }

  /** Lädt die öffentlich sichtbaren Profildaten eines beliebigen Users (nur lesend, keine Bearbeitung). */
  async loadPublicProfile(
    userId: string
  ): Promise<{ displayName: string; avatarUrl: string | null; favoriteCommanders: string[] } | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('display_name, avatar_url, favorite_commanders')
      .eq('id', userId)
      .single();

    if (error || !data) {
      console.error('Konnte Profil nicht laden:', error);
      return null;
    }

    return {
      displayName: data.display_name,
      avatarUrl: data.avatar_url,
      favoriteCommanders: data.favorite_commanders ?? [],
    };
  }
}