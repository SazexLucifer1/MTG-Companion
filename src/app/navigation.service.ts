import { Injectable, signal } from '@angular/core';

export type AppTab = 'match' | 'stats' | 'group' | 'profile';

/** Steuert, welcher der vier Haupt-Tabs aktiv ist - liegt in einem Service statt direkt in App,
 * damit auch andere Komponenten (z.B. "Profil ansehen" aus dem Gruppen-Tab) dorthin wechseln können. */
@Injectable({ providedIn: 'root' })
export class NavigationService {
  readonly activeTab = signal<AppTab>('match');

  goToTab(tab: AppTab): void {
    this.activeTab.set(tab);
  }
}
