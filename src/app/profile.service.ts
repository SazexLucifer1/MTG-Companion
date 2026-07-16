import { Injectable, effect, inject, signal } from '@angular/core';
import { supabase } from './supabase.client';
import { AuthService } from './auth.service';

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly auth = inject(AuthService);

  readonly profile = signal<Profile | null>(null);
  readonly loading = signal<boolean>(true);

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
      .select('id, display_name, avatar_url')
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
      });
    }
    this.loading.set(false);
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
  ): Promise<{ displayName: string; avatarUrl: string | null } | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', userId)
      .single();

    if (error || !data) {
      console.error('Konnte Profil nicht laden:', error);
      return null;
    }

    return { displayName: data.display_name, avatarUrl: data.avatar_url };
  }
}