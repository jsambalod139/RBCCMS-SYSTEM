import { CommonModule } from '@angular/common';

import {
  Component,
  OnDestroy,
  inject,
  signal
} from '@angular/core';

import {
  FormsModule,
  NgForm
} from '@angular/forms';

import {
  ActivatedRoute,
  Router,
  RouterLink
} from '@angular/router';

import Swal from 'sweetalert2';

import {
  AuthService,
  UserRole
} from '../../../core/services/auth.service';

@Component({
  selector: 'app-login-components',
  standalone: true,
  imports: [FormsModule, CommonModule, RouterLink],
  templateUrl: './login-components.html',
  styleUrl: './login-components.scss'
})
export class LoginComponents implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly isResetPage =
    this.route.snapshot.data['passwordReset'] === true;

  email = '';
  password = '';
  showPassword = false;

  readonly loading = signal(false);

  resetEmail = '';

  readonly resetLoading = signal(false);
  readonly resetSuccess = signal(false);
  readonly resetError = signal('');
  readonly resetCooldown = signal(false);

  private cooldownTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  async sendResetLink(form: NgForm): Promise<void> {
    if (this.resetLoading() || this.resetCooldown()) {
      return;
    }

    this.resetError.set('');
    this.resetSuccess.set(false);

    if (form.invalid || !this.resetEmail.trim()) {
      form.form.markAllAsTouched();

      this.resetError.set(
        'Please enter a valid email address.'
      );

      return;
    }

    this.resetLoading.set(true);

    try {
      await this.auth.sendResetLink(this.resetEmail);

      if (this.destroyed) return;

      this.resetSuccess.set(true);
      this.resetCooldown.set(true);

      this.cooldownTimer = setTimeout(() => {
        this.resetCooldown.set(false);
      }, 60000);
    } catch (error: unknown) {
      if (this.destroyed) return;

      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error
          ? String(error.code)
          : '';

      let message =
        'Unable to request a reset link. Please try again.';

      if (
        code === 'auth/invalid-email' ||
        code === 'auth/missing-email'
      ) {
        message = 'Please enter a valid email address.';
      } else if (code === 'auth/too-many-requests') {
        message =
          'Too many requests. Please wait before trying again.';
      } else if (code === 'auth/network-request-failed') {
        message =
          'Please check your internet connection and try again.';
      }

      this.resetError.set(message);
    } finally {
      if (!this.destroyed) {
        this.resetLoading.set(false);
      }
    }
  }

  async login(): Promise<void> {
    if (this.loading()) return;

    if (!this.email.trim() || !this.password) {
      await Swal.fire({
        icon: 'warning',
        title: 'Missing Fields',
        text: 'Please enter your email and password.'
      });

      return;
    }

    this.loading.set(true);

    try {
      const profile = await this.auth.login(
        this.email,
        this.password
      );

      const destinations: Record<UserRole, string> = {
        resident: '/res-dashboard',
        personnel: '/perso-dashboard',
        admin: '/ad-dashboard'
      };

      await this.router.navigateByUrl(
        destinations[profile.role]
      );
    } catch (error: unknown) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error
          ? String(error.code)
          : '';

      const reason =
        error instanceof Error ? error.message : '';

      let message = 'Unable to sign in. Please try again.';

      if (
        [
          'auth/invalid-credential',
          'auth/invalid-login-credentials',
          'auth/user-not-found',
          'auth/wrong-password',
          'auth/invalid-email'
        ].includes(code)
      ) {
        message = 'Invalid email or password.';
      } else if (code === 'auth/too-many-requests') {
        message =
          'Too many attempts. Please wait before trying again.';
      } else if (code === 'auth/network-request-failed') {
        message = 'Please check your internet connection.';
      } else if (code === 'auth/user-disabled') {
        message =
          'This account is unavailable. Contact the administrator.';
      } else if (reason === 'account/not-approved') {
        message =
          'Your account is not approved for access. Contact the administrator.';
      } else if (reason === 'account/profile-missing') {
        message =
          'Your user profile is missing. Contact the administrator.';
      } else if (reason === 'account/invalid-role') {
        message =
          'Your account role needs administrator attention.';
      } else if (code === 'permission-denied') {
        message =
          'Your profile could not be accessed. Check the Firestore rules.';
      }

      await Swal.fire({
        icon: 'error',
        title: 'Login Failed',
        text: message
      });
    } finally {
      this.password = '';
      this.loading.set(false);
    }
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.cooldownTimer);
    this.password = '';
  }
}