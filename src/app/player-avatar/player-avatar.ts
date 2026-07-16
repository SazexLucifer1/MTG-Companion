import { Component, input } from '@angular/core';

@Component({
  selector: 'app-player-avatar',
  templateUrl: './player-avatar.html',
  styleUrl: './player-avatar.scss',
})
export class PlayerAvatar {
  readonly url = input<string | null>(null);
  readonly large = input(false);
}
