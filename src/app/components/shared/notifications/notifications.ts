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
    if (
      !this.element.nativeElement.contains(
        event.target as Node
      )
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

    if (!profile || this.feed.saving()) return;

    const uid = profile.uid;

    await this.feed.markRead(item);

    if (this.account.profile()?.uid !== uid) return;

    const path =
      profile.role === 'resident'
        ? '/res-dashboard/resident-my-concern'
        : '/perso-dashboard/personnel-concern';

    const navigated = await this.router.navigate(
      [path],
      {
        queryParams: {
          concern: item.concernId,
        },
      }
    );

    if (navigated) {
      this.close();
    }
  }
}