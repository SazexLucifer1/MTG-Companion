import { Component, inject } from '@angular/core';
import { MatchTab } from './match-tab/match-tab';
import { StatsTab } from './stats-tab/stats-tab';
import { ProfileTab } from './profile-tab/profile-tab';
import { GroupTab } from './group-tab/group-tab';
import { IngameTracker } from './ingame-tracker/ingame-tracker';
import { DeckDetailView } from './deck-detail-view/deck-detail-view';
import { GoldfishTracker } from './goldfish-tracker/goldfish-tracker';
import { DeckImportDialogs } from './deck-import-dialogs/deck-import-dialogs';
import { DeckPdfDialog } from './deck-pdf-dialog/deck-pdf-dialog';
import { ManualDeckLinkDialog } from './manual-deck-link-dialog/manual-deck-link-dialog';
import { TutorialOverlay } from './tutorial-overlay/tutorial-overlay';
import { FeedbackDialog } from './feedback-dialog/feedback-dialog';
import { PlacementDialog } from './placement-dialog/placement-dialog';
import { TournamentPanel } from './tournament-panel/tournament-panel';
import { Dialog } from './dialog/dialog';
import { Login } from './login/login';
import { ResetPassword } from './reset-password/reset-password';
import { GameSessionService } from './game-session.service';
import { AuthService } from './auth.service';
import { NavigationService, AppTab } from './navigation.service';
import { I18nService } from './i18n.service';
import { FeedbackService } from './feedback.service';
import { TournamentService } from './tournament.service';

@Component({
  selector: 'app-root',
  imports: [
    MatchTab,
    StatsTab,
    ProfileTab,
    GroupTab,
    IngameTracker,
    DeckDetailView,
    GoldfishTracker,
    DeckImportDialogs,
    DeckPdfDialog,
    ManualDeckLinkDialog,
    Login,
    ResetPassword,
    TutorialOverlay,
    FeedbackDialog,
    PlacementDialog,
    TournamentPanel,
    Dialog,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly auth = inject(AuthService);
  readonly session = inject(GameSessionService);
  readonly navigation = inject(NavigationService);
  readonly i18n = inject(I18nService);
  readonly feedback = inject(FeedbackService);
  readonly tournament = inject(TournamentService);

  readonly tabs: { id: AppTab; labelKey: string; icon: string }[] = [
    { id: 'match', labelKey: 'nav.match', icon: '⚔️' },
    { id: 'stats', labelKey: 'nav.stats', icon: '📊' },
    { id: 'group', labelKey: 'nav.group', icon: '🎉' },
    { id: 'profile', labelKey: 'nav.profile', icon: '👤' },
  ];
}