import { Component, inject } from '@angular/core';
import { MatchTab } from './match-tab/match-tab';
import { StatsTab } from './stats-tab/stats-tab';
import { ProfileTab } from './profile-tab/profile-tab';
import { GroupTab } from './group-tab/group-tab';
import { IngameTracker } from './ingame-tracker/ingame-tracker';
import { DeckDetailView } from './deck-detail-view/deck-detail-view';
import { DeckImportDialogs } from './deck-import-dialogs/deck-import-dialogs';
import { DeckPdfDialog } from './deck-pdf-dialog/deck-pdf-dialog';
import { Login } from './login/login';
import { ResetPassword } from './reset-password/reset-password';
import { GameSessionService } from './game-session.service';
import { AuthService } from './auth.service';
import { NavigationService, AppTab } from './navigation.service';

@Component({
  selector: 'app-root',
  imports: [
    MatchTab,
    StatsTab,
    ProfileTab,
    GroupTab,
    IngameTracker,
    DeckDetailView,
    DeckImportDialogs,
    DeckPdfDialog,
    Login,
    ResetPassword,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly auth = inject(AuthService);
  readonly session = inject(GameSessionService);
  readonly navigation = inject(NavigationService);

  readonly tabs: { id: AppTab; label: string; icon: string }[] = [
    { id: 'match', label: 'Match', icon: '⚔️' },
    { id: 'stats', label: 'Statistik', icon: '📊' },
    { id: 'group', label: 'Gruppe', icon: '🎉' },
    { id: 'profile', label: 'Profil', icon: '👤' },
  ];
}