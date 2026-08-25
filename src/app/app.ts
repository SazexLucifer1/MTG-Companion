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
import { CardPreviewDialog } from './card-preview-dialog/card-preview-dialog';
import { TutorialOverlay } from './tutorial-overlay/tutorial-overlay';
import { FeedbackDialog } from './feedback-dialog/feedback-dialog';
import { PlacementDialog } from './placement-dialog/placement-dialog';
import { TournamentPanel } from './tournament-panel/tournament-panel';
import { Dialog } from './dialog/dialog';
import { LegalFooter } from './legal-footer/legal-footer';
import { LegalPageView } from './legal-page-view/legal-page-view';
import { Login } from './login/login';
import { ResetPassword } from './reset-password/reset-password';
import { GameSessionService } from './game-session.service';
import { AuthService } from './auth.service';
import { NavigationService, AppTab } from './navigation.service';
import { I18nService } from './i18n.service';
import { FeedbackService } from './feedback.service';
import { TournamentService } from './tournament.service';
import { APP_VERSION, APP_COMMIT } from './version';

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
    CardPreviewDialog,
    Login,
    ResetPassword,
    TutorialOverlay,
    FeedbackDialog,
    PlacementDialog,
    TournamentPanel,
    Dialog,
    LegalFooter,
    LegalPageView,
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

  /** Bei jedem Build automatisch erzeugt (siehe scripts/generate-version.js) - Anzahl Commits als Versionsnummer + kurzer Commit-Hash, damit im Browser sofort sichtbar ist, ob ein Merge/Deploy schon angekommen ist. */
  readonly appVersion = APP_VERSION;
  readonly appCommit = APP_COMMIT;

  readonly tabs: { id: AppTab; labelKey: string; icon: string }[] = [
    { id: 'match', labelKey: 'nav.match', icon: '⚔️' },
    { id: 'stats', labelKey: 'nav.stats', icon: '📊' },
    { id: 'group', labelKey: 'nav.group', icon: '🎉' },
    { id: 'profile', labelKey: 'nav.profile', icon: '👤' },
  ];
}