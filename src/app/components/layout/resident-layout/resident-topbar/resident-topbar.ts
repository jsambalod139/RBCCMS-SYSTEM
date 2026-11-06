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

import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { Notifications } from '../../../shared/notifications/notifications';

@Component({
  selector: 'app-resident-topbar',
  standalone: true,
  imports: [CommonModule, RouterLink, Notifications],
  templateUrl: './resident-topbar.html',
  styleUrl: './resident-topbar.scss',
})
export class ResidentTopbar {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly element = inject(ElementRef<HTMLElement>);

  @ViewChild(Notifications)
  private notifications?: Notifications;

  readonly account = inject(SettingsService);
  readonly isMenuOpen = signal(false);
  readonly loggingOut = signal(false);

  toggleMenu(): void {
    if (!this.loggingOut()) {
      this.notifications?.close();
      this.isMenuOpen.update(open => !open);
    }
  }

  closeMenu(): void {
    this.isMenuOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  outsideClick(event: MouseEvent): void {
    const target = event.target;

    if (
      target instanceof Node &&
      !this.element.nativeElement.contains(target)
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
        title: 'Confirm Logout',
        text: 'Please confirm that you wish to sign out of RBCCMS.',
        icon: 'warning',
        iconColor: '#b7791f',
        showCancelButton: true,
        reverseButtons: true,
        confirmButtonText: 'Yes, log out',
        cancelButtonText: 'Cancel',
        buttonsStyling: false,
        focusCancel: true,
        width: 440,
        padding: '28px 24px 24px',
        background: '#ffffff',
        color: '#21372a',
        backdrop: 'rgba(16, 34, 24, 0.45)',
        customClass: {
          popup: 'rbccms-confirm-popup',
          icon: 'rbccms-confirm-icon',
          title: 'rbccms-confirm-title',
          htmlContainer: 'rbccms-confirm-message',
          actions: 'rbccms-confirm-actions',
          confirmButton: 'rbccms-confirm-primary',
          cancelButton: 'rbccms-confirm-cancel',
        },
      });

      if (!result.isConfirmed) return;

      await this.auth.logout();
      this.closeMenu();

      await this.router.navigate(
        ['/login-components'],
        { replaceUrl: true }
      );

      void Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Signed Out Successfully',
        text: 'You have successfully signed out of RBCCMS.',
        showConfirmButton: false,
        showCloseButton: true,
        timer: 3000,
        timerProgressBar: true,
        returnFocus: false,
        customClass: {
          popup: 'rbccms-login-toast',
        },
      });
    } catch {
      await Swal.fire({
        icon: 'error',
        title: 'Logout Unsuccessful',
        text: 'Your logout request could not be completed. Please try again.',
        confirmButtonText: 'OK',
        buttonsStyling: false,
        width: 440,
        padding: '28px 24px 24px',
        background: '#ffffff',
        color: '#21372a',
        customClass: {
          popup: 'rbccms-confirm-popup',
          title: 'rbccms-confirm-title',
          htmlContainer: 'rbccms-confirm-message',
          actions: 'rbccms-confirm-actions',
          confirmButton: 'rbccms-confirm-primary',
        },
      });
    } finally {
      this.loggingOut.set(false);
    }
  }
}