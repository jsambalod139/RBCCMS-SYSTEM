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

@Component({
  selector: 'app-admin-topbar',
  standalone: true,
  imports: [RouterLink],
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
      target instanceof Node
      && !this.element.nativeElement.contains(target)
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
        title: 'Are you sure?',
        text: 'Do you want to log out?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, log out',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#087b49',
        cancelButtonColor: '#6b7280',
      });

      if (!result.isConfirmed) return;

      await this.auth.logout();
      this.closeMenu();

      await this.router.navigate(['/login-components'], {
        replaceUrl: true,
      });

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