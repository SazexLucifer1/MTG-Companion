import { Component } from '@angular/core';
import { OverflowMenu } from '../ui/overflow-menu/overflow-menu';

@Component({
  selector: 'app-preview',
  imports: [OverflowMenu],
  template: `
    <section class="glass-card">
      <h2>Menü in einer glass-card (wie im Gruppen-Tab)</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <span>Testgruppe</span>
        <app-overflow-menu heading="Testgruppe" label="Weitere Aktionen">
          <button class="glass-button">Mitglieder</button>
          <button class="glass-button">Rechte</button>
          <button class="glass-button">Sichtbarkeit</button>
          <button class="glass-button">Qualifikation</button>
          <button class="glass-button">Umbenennen</button>
          <button class="glass-button danger">Löschen</button>
        </app-overflow-menu>
      </div>
    </section>
  `,
})
export class Preview {}
