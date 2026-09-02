import { ErrorHandler, Injectable } from '@angular/core';
import { isAppBlank, isModuleLoadError, reloadOnce, showCrashScreen } from './app-recovery';

/**
 * Fängt alle Fehler ab, die Angular selbst nicht behandelt (inklusive der über
 * provideBrowserGlobalErrorListeners() weitergereichten window-Fehler und abgelehnten Promises).
 *
 * Ohne diesen Handler landete ein Fehler nur in der Konsole - und wenn er beim Rendern auftrat,
 * blieb für den Nutzer eine weiße Seite ohne jeden Hinweis zurück. Hier wird stattdessen
 * unterschieden: veralteter Code-Chunk nach einem Deploy -> einmalig neu laden; sonst -> nur dann
 * einen Hinweis mit Neu-laden-Knopf zeigen, wenn tatsächlich nichts mehr dasteht. Fehler, nach
 * denen die App normal weiterläuft (fehlgeschlagene Netzwerkanfrage o.ä.), bleiben unsichtbar.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    console.error(error);

    if (isModuleLoadError(error)) {
      reloadOnce('Code-Chunk konnte nicht geladen werden (vermutlich neuer Stand deployed)');
      return;
    }

    // Ein Frame warten: mitten in der Change Detection ist das DOM nur halb aktualisiert, ein
    // "leer"-Befund wäre dort ein Fehlalarm.
    requestAnimationFrame(() => {
      if (isAppBlank()) showCrashScreen();
    });
  }
}
