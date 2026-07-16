import { Injectable, effect, inject, signal } from '@angular/core';
import { supabase } from './supabase.client';
import { GroupService } from './group.service';
import { AuthService } from './auth.service';

export interface CustomBackground {
  id: string;
  url: string;
  uploadedBy: string;
}

@Injectable({ providedIn: 'root' })
export class BackgroundService {
  private readonly groupService = inject(GroupService);
  private readonly auth = inject(AuthService);

  /** Statische, mit der App ausgelieferte Hintergründe (public/backgrounds/). */
  readonly list = signal<string[]>([]);
  private loaded = false;

  /** Von Gruppenmitgliedern hochgeladene Hintergründe - geteilt mit der ganzen aktiven Gruppe. */
  readonly customBackgrounds = signal<CustomBackground[]>([]);
  readonly uploading = signal(false);
  readonly uploadError = signal('');

  constructor() {
    effect(() => {
      const groupId = this.groupService.groupId();
      if (groupId) {
        this.loadCustomBackgrounds(groupId);
      } else {
        this.customBackgrounds.set([]);
      }
    });
  }

  /** Lädt das Manifest einmalig (lazy) und baut die vollen Pfade zu den Bildern. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const res = await fetch('/backgrounds/manifest.json');
      if (!res.ok) return;
      const data = await res.json();
      const files: string[] = Array.isArray(data.backgrounds) ? data.backgrounds : [];
      this.list.set(files.map((f) => `/backgrounds/${f}`));
    } catch {
      // Kein Manifest gefunden -> App bleibt ohne Hintergrund-Auswahl nutzbar.
    }
  }

  private async loadCustomBackgrounds(groupId: string): Promise<void> {
    const { data, error } = await supabase
      .from('group_backgrounds')
      .select('id, image_url, uploaded_by')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Konnte hochgeladene Hintergründe nicht laden:', error);
      return;
    }

    this.customBackgrounds.set(
      (data ?? []).map((row) => ({ id: row.id, url: row.image_url, uploadedBy: row.uploaded_by }))
    );
  }

  async uploadBackground(file: File): Promise<boolean> {
    const groupId = this.groupService.groupId();
    const userId = this.auth.currentUser()?.id;
    if (!groupId || !userId) return false;

    if (!file.type.startsWith('image/')) {
      this.uploadError.set('Bitte ein Bild auswählen.');
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.uploadError.set('Bild ist zu groß (max. 10 MB).');
      return false;
    }

    this.uploading.set(true);
    this.uploadError.set('');

    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${groupId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('group-backgrounds')
      .upload(path, file, { contentType: file.type });

    if (uploadError) {
      console.error('Konnte Hintergrund nicht hochladen:', uploadError);
      this.uploadError.set('Hochladen fehlgeschlagen.');
      this.uploading.set(false);
      return false;
    }

    const { data: publicUrlData } = supabase.storage.from('group-backgrounds').getPublicUrl(path);

    const { error: insertError } = await supabase
      .from('group_backgrounds')
      .insert({ group_id: groupId, uploaded_by: userId, image_url: publicUrlData.publicUrl });

    this.uploading.set(false);

    if (insertError) {
      console.error('Konnte Hintergrund nicht speichern:', insertError);
      this.uploadError.set('Speichern fehlgeschlagen.');
      return false;
    }

    await this.loadCustomBackgrounds(groupId);
    return true;
  }

  async deleteCustomBackground(id: string): Promise<void> {
    const { error } = await supabase.from('group_backgrounds').delete().eq('id', id);
    if (error) {
      console.error('Konnte Hintergrund nicht löschen:', error);
      return;
    }
    this.customBackgrounds.update((list) => list.filter((b) => b.id !== id));
  }
}
