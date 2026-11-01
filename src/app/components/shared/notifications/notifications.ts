import { CommonModule } from '@angular/common';

import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
  output,
  signal,
} from '@angular/core';

import { Router } from '@angular/router';

import {
  ConcernNotification,
  NotificationService,
} from '../../../core/services/notification.service';

import {
  SettingsService,
} from '../../../core/services/settings.service';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notifications.html',
  styleUrl: './notifications.scss',
})
export class Notifications {
  readonly feed = inject(NotificationService);

  private readonly account = inject(SettingsService);
  private readonly router = inject(Router);

  private readonly element =
    inject(ElementRef<HTMLElement>);

  @ViewChild('bell')
  private bell?: ElementRef<HTMLButtonElement>;

  readonly opened = output<void>();
  readonly isOpen = signal(false);
  readonly navigating = signal(false);

  toggle(): void {
    this.isOpen.update(value => !value);

    if (this.isOpen()) {
      this.opened.emit();
    }
  }

  close(): void {
    this.isOpen.set(false);
  }

  closeAndFocus(): void {
    this.close();
    this.bell?.nativeElement.focus();
  }

  @HostListener('document:click', ['$event'])
  outside(event: MouseEvent): void {
    const target = event.target;

    if (
      target instanceof Node &&
      !this.element.nativeElement.contains(target)
    ) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  escape(): void {
    if (this.isOpen()) {
      this.closeAndFocus();
    }
  }

  async openConcern(
    item: ConcernNotification
  ): Promise<void> {
    const profile = this.account.profile();

    const current = this.feed.notifications().find(
      notification => notification.id === item.id
    );

    if (
      !profile ||
      profile.accountStatus !== 'approved' ||
      !current ||
      this.feed.saving() ||
      this.navigating()
    ) {
      return;
    }

    const uid = profile.uid;
    const role = profile.role;

    this.navigating.set(true);

    try {
      await this.feed.markRead(current);

      const latest = this.account.profile();

      if (
        latest?.uid !== uid ||
        latest.role !== role ||
        latest.accountStatus !== 'approved'
      ) {
        return;
      }

      let path: string;

      if (role === 'admin') {
        path =
          current.target === 'audit'
            ? '/ad-dashboard/admin-audit-logs'
            : '/ad-dashboard/admin-concern';
      } else if (role === 'resident') {
        path = '/res-dashboard/resident-my-concern';
      } else {
        path = '/perso-dashboard/personnel-concern';
      }

      const navigated = await this.router.navigate(
        [path],
        {
          queryParams:
            current.target === 'audit'
              ? {}
              : {
                  concern: current.concernId,
                },
        }
      );

      if (navigated) {
        this.close();
      }
    } catch {
      this.feed.actionError.set(
        'Unable to open this notification. Please try again.'
      );
    } finally {
      this.navigating.set(false);
    }
  }
}