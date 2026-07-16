import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class BackgroundService {
  readonly list = signal<string[]>([]);
  private loaded = false;

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
}