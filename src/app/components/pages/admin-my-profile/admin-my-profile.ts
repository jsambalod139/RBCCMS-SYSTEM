import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  inject,
} from '@angular/core';

import {
  SettingsService,
} from '../../../core/services/settings.service';

@Component({
  selector: 'app-admin-my-profile',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-my-profile.html',
  styleUrl: './admin-my-profile.scss',
})
export class AdminMyProfile {
  readonly account = inject(SettingsService);

  readonly adminProfile = computed(() => {
    const profile = this.account.profile();

    return profile?.role === 'admin' &&
      profile.accountStatus === 'approved'
      ? profile
      : null;
  });

  retryLoad(): void {
    this.account.reload();
  }
}