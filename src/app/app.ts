import { Component, inject, signal } from '@angular/core';
import { MatchTab } from './match-tab/match-tab';
import { StatsTab } from './stats-tab/stats-tab';
import { ProfileTab } from './profile-tab/profile-tab';
import { GroupTab } from './group-tab/group-tab';
import { IngameTracker } from './ingame-tracker/ingame-tracker';
import { DeckDetailView } from './deck-detail-view/deck-detail-view';
import { Login } from './login/login';
import { GameSessionService } from './game-session.service';
import { AuthService } from './auth.service';

type Tab = 'match' | 'stats' | 'group' | 'profile';

@Component({
  selector: 'app-root',
  imports: [MatchTab, StatsTab, ProfileTab, GroupTab, IngameTracker, DeckDetailView, Login],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly auth = inject(AuthService);
  readonly session = inject(GameSessionService);
  readonly activeTab = signal<Tab>('match');

  readonly tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'match', label: 'Match', icon: '⚔️' },
    { id: 'stats', label: 'Statistik', icon: '📊' },
    { id: 'group', label: 'Gruppe', icon: '🎉' },
    { id: 'profile', label: 'Profil', icon: '👤' },
  ];
}