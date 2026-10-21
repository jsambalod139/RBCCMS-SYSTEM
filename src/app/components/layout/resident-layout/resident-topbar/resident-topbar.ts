import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';

import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-resident-topbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './resident-topbar.html',
  styleUrl: './resident-topbar.scss',
})
export class ResidentTopbar {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  isMenuOpen = false;
  readonly loggingOut = signal(false);

  toggleMenu(): void {
    if (!this.loggingOut()) {
      this.isMenuOpen = !this.isMenuOpen;
    }
  }

  async logout(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    if (this.loggingOut()) {
      return;
    }

    this.loggingOut.set(true);

    try {
      const result = await Swal.fire({
        title: 'Are you sure?',
        text: 'Do you want to log out?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, log out',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
      });

      if (!result.isConfirmed) {
        return;
      }

      await this.auth.logout();

      this.isMenuOpen = false;

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