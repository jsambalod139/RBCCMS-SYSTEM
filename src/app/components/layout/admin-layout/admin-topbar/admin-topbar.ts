import {
  Component,
  ElementRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';

import { Router, RouterLink } from '@angular/router';
import Swal from 'sweetalert2';

import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { Notifications } from '../../../shared/notifications/notifications';

@Component({
  selector: 'app-admin-topbar',
  standalone: true,
  imports: [RouterLink, Notifications],
  templateUrl: './admin-topbar.html',
  styleUrl: './admin-topbar.scss',
})
export class AdminTopbar {
  readonly account = inject(SettingsService);

  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly element = inject(ElementRef<HTMLElement>);

  readonly isMenuOpen = signal(false);
  readonly loggingOut = signal(false);

  toggleMenu(): void {
    if (!this.loggingOut()) {
      this.isMenuOpen.update(open => !open);
    }
  }

  closeMenu(): void {
    this.isMenuOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target;

    if (
      target instanceof Node &&
      !this.element.nativeElement.contains(target)
    ) {
      this.closeMenu();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMenu();
  }

  async logout(): Promise<void> {
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