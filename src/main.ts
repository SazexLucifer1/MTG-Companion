import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { isModuleLoadError, reloadOnce, showCrashScreen } from './app/app-recovery';

bootstrapApplication(App, appConfig).catch((err) => {
  console.error(err);
  // Scheitert schon der Start, bleibt sonst nur eine weiße Seite stehen. Nach einem Deploy ist ein
  // veralteter Code-Chunk die wahrscheinlichste Ursache - dann hilft ein einmaliges Neuladen.
  if (isModuleLoadError(err)) {
    reloadOnce('Bootstrap wegen fehlendem Code-Chunk gescheitert');
    return;
  }
  showCrashScreen();
});
