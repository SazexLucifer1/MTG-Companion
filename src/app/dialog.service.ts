import { Injectable, signal } from '@angular/core';

interface DialogRequest {
  message: string;
  mode: 'confirm' | 'alert';
  resolve: (value: boolean) => void;
}

/**
 * Ersatz für die nativen Browser-Dialoge confirm()/alert() - die sehen je nach Gerät/Browser
 * komplett anders aus als der Rest der App (Windows-/Handy-Systemdialog statt Glass-Look). Läuft
 * über eine globale Overlay-Komponente (Dialog, in app.html gemountet), die dieses Signal
 * beobachtet - gleiches Muster wie PlacementDialog/TournamentPanel.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly request = signal<DialogRequest | null>(null);

  /** Ersatz für confirm() - löst mit true/false auf, je nachdem welcher Button gedrückt wurde. */
  confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.request.set({ message, mode: 'confirm', resolve });
    });
  }

  /** Ersatz für alert() - löst auf, sobald bestätigt wurde. */
  alert(message: string): Promise<void> {
    return new Promise((resolve) => {
      this.request.set({ message, mode: 'alert', resolve: () => resolve() });
    });
  }

  respond(value: boolean): void {
    const req = this.request();
    if (!req) return;
    this.request.set(null);
    req.resolve(value);
  }
}
