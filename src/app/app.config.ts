import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { GlobalErrorHandler } from './global-error-handler';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Ersetzt den Standard-Handler (der nur in die Konsole schreibt) - siehe GlobalErrorHandler:
    // ein Fehler soll keine wortlose weiße Seite hinterlassen.
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ],
};
