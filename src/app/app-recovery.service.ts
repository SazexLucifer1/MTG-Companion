import { ApplicationRef, Injectable, afterNextRender, inject } from '@angular/core';
import { isAppBlank, nudgeRepaint, reloadOnce } from './app-recovery';

/**
 * Wacht darüber, dass nach einem Tab-Wechsel wieder etwas auf dem Bildschirm steht.
 *
 * Gemeldetes Problem: nach dem Wechsel zwischen Browser-Tabs ist die Seite gelegentlich komplett
 * weiß, und nur ein manuelles Neuladen hilft. Dahinter stecken zwei verschiedene Zustände, die für
 * den Nutzer gleich aussehen:
 *
 *  1. Das DOM ist noch da, es wird nur nicht mehr gezeichnet (verworfene GPU-Ebenen der vielen
 *     backdrop-filter-Flächen). -> nudgeRepaint() erzwingt ein Neuzeichnen.
 *  2. Unter <app-root> steht wirklich nichts mehr (die App hat sich beim Rendern verabschiedet).
 *     -> es wird einmalig neu geladen, ersatzweise ein Hinweis mit Neu-laden-Knopf gezeigt.
 *
 * Bewusst mit klassischen Event-Listenern statt mit einem effect() auf ein Signal: ein effect läuft
 * selbst nur, WENN die Change Detection noch arbeitet - als Wachhund für genau deren Ausfall wäre
 * er damit nutzlos. Aus demselben Grund wird der Renderdurchlauf hier direkt angestoßen (aus einem
 * Event-Listener heraus, nicht aus laufender Change Detection - das wäre NG0101).
 */
@Injectable({ providedIn: 'root' })
export class AppRecoveryService {
  private readonly appRef = inject(ApplicationRef);

  /**
   * Erst wenn die App einmal gerendert hat, ist ein leeres <app-root> ein Fehler - während des
   * Starts ist es der Normalzustand und dürfte auf keinen Fall einen Reload auslösen.
   */
  private hasRenderedOnce = false;

  constructor() {
    afterNextRender(() => (this.hasRenderedOnce = true));

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.recoverAfterReturn();
    });

    // pageshow feuert zusätzlich beim Zurückkommen aus dem Vor-/Zurück-Cache (bfcache) - dabei gibt
    // es nicht zwangsläufig ein visibilitychange-Event.
    window.addEventListener('pageshow', () => this.recoverAfterReturn());
  }

  private recoverAfterReturn(): void {
    if (!this.hasRenderedOnce) return;

    // Zoneless: ohne Zone.js löst nicht jedes Ereignis automatisch einen Renderdurchlauf aus. Nach
    // einer Pause im Hintergrund stellt ein erzwungener Durchlauf sicher, dass ausstehende
    // Signal-Änderungen tatsächlich im DOM landen.
    try {
      this.appRef.tick();
    } catch (err) {
      console.error('Renderdurchlauf nach Tab-Wechsel fehlgeschlagen:', err);
    }

    // Ein Frame Abstand: erst danach steht fest, ob wirklich nichts gerendert wurde.
    requestAnimationFrame(() => {
      if (!isAppBlank()) {
        nudgeRepaint();
        return;
      }
      console.error(
        'Nach dem Tab-Wechsel ist <app-root> leer - versuche die App wiederherzustellen.'
      );
      // Zeigt selbst den Crash-Screen, falls das Reload-Kontingent schon verbraucht ist.
      reloadOnce('leeres <app-root> nach Tab-Wechsel');
    });
  }
}
