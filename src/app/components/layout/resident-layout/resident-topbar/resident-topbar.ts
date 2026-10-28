import { CommonModule } from '@angular/common';

import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
  signal,
} from '@angular/core';

import { Router, RouterLink } from '@angular/router';
import Swal from 'sweetalert2';

import {
  AuthService,
} from '../../../../core/services/auth.service';

import {
  SettingsService,
} from '../../../../core/services/settings.service';

import {
  Notifications,
} from '../../../shared/notifications/notifications';

@Component({
  selector: 'app-resident-topbar',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    Notifications,
  ],
  templateUrl: './resident-topbar.html',
  styleUrl: './resident-topbar.scss',
})
export class ResidentTopbar {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly element =
    inject(ElementRef<HTMLElement>);

  @ViewChild(Notifications)
  private notifications?: Notifications;

  readonly account = inject(SettingsService);
  readonly isMenuOpen = signal(false);
  readonly loggingOut = signal(false);

  toggleMenu(): void {
    if (!this.loggingOut()) {
      this.notifications?.close();
      this.isMenuOpen.set(!this.isMenuOpen());
    }
  }

  closeMenu(): void {
    this.isMenuOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  outsideClick(event: MouseEvent): void {
    if (
      !this.element.nativeElement.contains(
        event.target as Node
      )
    ) {
      this.closeMenu();
    }
  }

  @HostListener('document:keydown.escape')
  escape(): void {
    this.closeMenu();
  }

  async logout(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    if (this.loggingOut()) return;

    this.loggingOut.set(true);

    try {
      const result = await Swal.fire({
        title: 'Are you sure?',
        text: 'Do you want to log out?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, log out',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#21372a',
        cancelButtonColor: '#777',
      });

      if (!result.isConfirmed) return;

      await this.auth.logout();
      this.closeMenu();

      await this.router.navigate(
        ['/login-components'],
        { replaceUrl: true }
      );

      await Swal.fire({
        icon: 'success',
        title: 'Logged out!',
        timer: 1200,
        showConfirmButton: false,
      });
    } catch {
      await Swal.fire({
        icon: 'error',
        title: 'Logout Failed',
        text: 'Unable to complete logout. Please try again.',
      });
    } finally {
      this.loggingOut.set(false);
    }
  }
}