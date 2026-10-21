import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';

import {
  AuthService,
  UserRole,
} from '../../../core/services/auth.service';

@Component({
  selector: 'app-login-components',
  imports: [FormsModule, CommonModule],
  templateUrl: './login-components.html',
  styleUrl: './login-components.scss',
})
export class LoginComponents {
  email = '';
  password = '';
  showPassword = false;

  readonly loading = signal(false);

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  async login(): Promise<void> {
    if (this.loading()) {
      return;
    }

    if (!this.email.trim() || !this.password) {
      await Swal.fire({
        icon: 'warning',
        title: 'Missing Fields',
        text: 'Please enter your email and password.',
      });

      return;
    }

    this.loading.set(true);

    try {
      const profile = await this.auth.login(this.email, this.password);

      const destinations: Record<UserRole, string> = {
        resident: '/res-dashboard',
        personnel: '/perso-dashboard',
        admin: '/ad-dashboard',
      };

      await this.router.navigateByUrl(destinations[profile.role]);
    } catch (error: unknown) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error
          ? String(error.code)
          : '';

      const reason = error instanceof Error ? error.message : '';

      let message = 'Unable to sign in. Please try again.';

      if (
        [
          'auth/invalid-credential',
          'auth/invalid-login-credentials',
          'auth/user-not-found',
          'auth/wrong-password',
          'auth/invalid-email',
        ].includes(code)
      ) {
        message = 'Invalid email or password.';
      } else if (code === 'auth/too-many-requests') {
        message = 'Too many attempts. Please wait before trying again.';
      } else if (code === 'auth/network-request-failed') {
        message = 'Please check your internet connection.';
      } else if (code === 'auth/user-disabled') {
        message = 'This account is unavailable. Contact the administrator.';
      } else if (reason === 'account/not-approved') {
        message =
          'Your account is not approved for access. Contact the administrator.';
      } else if (reason === 'account/profile-missing') {
        message =
          'Your user profile is missing. Contact the administrator.';
      } else if (reason === 'account/invalid-role') {
        message = 'Your account role needs administrator attention.';
      } else if (code === 'permission-denied') {
        message =
          'Your profile could not be accessed. Check the Firestore rules.';
      }

      await Swal.fire({
        icon: 'error',
        title: 'Login Failed',
        text: message,
      });
    } finally {
      this.password = '';
      this.loading.set(false);
    }
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }
}