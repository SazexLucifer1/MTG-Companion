import {
  ApplicationRef,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { CdkPortal, DomPortalOutlet } from '@angular/cdk/portal';
import { I18nService } from '../../i18n.service';

/**
 * "⋮"-Knopf, der seine Aktionen in einem Sheet öffnet.
 *
 * Das Muster gab es bereits handgebaut im Ingame-Tracker, und das zugehörige CSS
 * (.options-menu-overlay/.options-menu-sheet) liegt seit Längerem global in styles.scss - aber
 * ohne Komponente drumherum, weshalb es an 41 Stellen mit eigenem signal(false) und eigenem @if
 * nachgebaut wurde.
 *
 * Gegenüber dem Handbau kommen zwei Dinge dazu, die dort überall fehlten: Escape schließt, und der
 * Fokus bleibt im Sheet gefangen (cdkTrapFocus), statt hinter dem Overlay weiterzuwandern.
 *
 * Die Aktionen kommen per Content-Projection vom Aufrufer. Ein Klick im Sheet schließt es nach dem
 * Ausführen automatisch - der Klick des projizierten Buttons läuft zuerst, danach erst dieser hier.
 *
 * ## Warum das Sheet per Portal in den <body> wandert
 *
 * Ein Element mit `backdrop-filter` wird zum Bezugsrahmen für `position: fixed`-Nachfahren. Da
 * .glass-card genau das hat (styles.scss), war ein direkt im Markup stehendes Sheet nicht am
 * Viewport ausgerichtet, sondern in der Karte gefangen - abgeschnitten und hinter benachbarter
 * Oberfläche. Nachgemessen: dasselbe `position: fixed; inset: 0` ergibt in einer Karte mit
 * backdrop-filter 720x160px statt der 800x600px des Viewports.
 *
 * Die handgebauten Sheets fielen nicht auf, weil sie durchweg auf oberster Ebene ihrer Datei
 * stehen, außerhalb jeder Karte. Diese Komponente wird dagegen mitten in Karten eingesetzt, also
 * hängt sie ihren Inhalt über einen DomPortalOutlet in einen eigenen Container am <body> - dort
 * greift kein fremder Bezugsrahmen mehr. Der Container ist bewusst nicht der <body> selbst,
 * siehe ngOnDestroy.
 *
 * Bewusst DomPortalOutlet statt der CDK-Overlay: das gesamte Aussehen kommt weiterhin aus den
 * vorhandenen globalen Klassen, es braucht also weder eine Positionsstrategie noch das
 * CDK-Overlay-Stylesheet - nur einen anderen Ort im DOM.
 */
@Component({
  selector: 'app-overflow-menu',
  imports: [A11yModule, CdkPortal],
  templateUrl: './overflow-menu.html',
  styleUrl: './overflow-menu.scss',
})
export class OverflowMenu implements OnDestroy {
  readonly i18n = inject(I18nService);
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(Injector);

  /** Vorgelesener Name des Knopfs, z.B. "Weitere Aktionen für Gruppe X". */
  readonly label = input<string>('');
  /** Überschrift im Sheet. Ohne Angabe bleibt das Sheet überschriftenlos. */
  readonly heading = input<string>('');

  readonly open = signal(false);

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly portal = viewChild.required(CdkPortal);

  /** Erst beim ersten Öffnen angelegt - ein nie geöffnetes Menü hängt nichts in den <body>. */
  private outlet: DomPortalOutlet | null = null;
  /** Eigener Container im <body>, siehe ngOnDestroy. */
  private host: HTMLElement | null = null;

  toggle(): void {
    if (this.open()) this.close();
    else this.openMenu();
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.outlet?.detach();
    // Fokus zurück auf den auslösenden Knopf, sonst landet er nach dem Schließen am Seitenanfang.
    this.trigger()?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    // Ohne dispose() bliebe das Sheet im <body> zurück, wenn die Komponente geschlossen wird,
    // während das Menü offen ist (z.B. eine Deckzeile verschwindet nach dem Löschen).
    //
    // dispose() räumt aber nicht nur den Inhalt weg, sondern entfernt auch das Outlet-Element
    // selbst (CDK: `super.dispose(); this.outletElement.remove();`). Solange das Outlet direkt
    // auf document.body saß, hat jedes zerstörte Menü damit den <body> aus dem Dokument
    // genommen - die Seite wurde weiß, ohne jede Fehlermeldung. Deshalb bekommt das Portal
    // einen eigenen Container, den dispose() gefahrlos entsorgen darf.
    this.outlet?.dispose();
    this.outlet = null;
    this.host = null; // von dispose() bereits aus dem DOM entfernt
  }

  private openMenu(): void {
    if (!this.outlet) {
      this.host = document.createElement('div');
      this.host.classList.add('overflow-menu-portal');
      document.body.appendChild(this.host);
      this.outlet = new DomPortalOutlet(this.host, this.appRef, this.injector);
    }
    if (!this.outlet.hasAttached()) this.outlet.attach(this.portal());
    this.open.set(true);
  }
}
