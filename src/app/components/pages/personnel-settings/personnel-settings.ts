import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';

import {
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
  updatePassword,
  validatePassword,
} from 'firebase/auth';

import { firebaseApp } from '../../../core/firebase.config';
import { SettingsService } from '../../../core/services/settings.service';

@Component({
  selector: 'app-personnel-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './personnel-settings.html',
  styleUrl: './personnel-settings.scss',
})
export class PersonnelSettings implements OnDestroy {
  readonly account = inject(SettingsService);
  readonly activeTab =
    signal<'account' | 'preferences'>('account');

  private readonly auth = getAuth(firebaseApp);
  private destroyed = false;

  readonly photoBusy = signal(false);
  readonly passwordBusy = signal(false);

  readonly photoFeedback = signal('');
  readonly photoError = signal('');
  readonly passwordFeedback = signal('');
  readonly passwordError = signal('');

  readonly showCurrent = signal(false);
  readonly showNew = signal(false);
  readonly showConfirm = signal(false);

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';

  async changeNotificationPreference(
    event: Event
  ): Promise<void> {
    const input = event.target as HTMLInputElement;

    await this.account.saveNotificationPreference(
      input.checked
    );

    if (!this.destroyed) {
      input.checked = this.account.notificationEnabled();
    }
  }

  async changePhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file || this.photoBusy()) return;

    this.photoBusy.set(true);
    this.photoFeedback.set('');
    this.photoError.set('');

    try {
      await this.account.uploadPhoto(file);

      if (!this.destroyed) {
        this.photoFeedback.set('Profile photo saved.');
      }
    } catch (error: unknown) {
      if (!this.destroyed) {
        this.photoError.set(
          error instanceof Error
            ? error.message
            : 'Unable to save your photo.'
        );
      }
    } finally {
      if (!this.destroyed) this.photoBusy.set(false);
    }
  }

  async removePhoto(): Promise<void> {
    if (
      this.photoBusy()
      || !this.account.profile()?.photoPath
    ) {
      return;
    }

    this.photoBusy.set(true);
    this.photoFeedback.set('');
    this.photoError.set('');

    try {
      await this.account.removePhoto();

      if (!this.destroyed) {
        this.photoFeedback.set('Profile photo removed.');
      }
    } catch (error: unknown) {
      if (!this.destroyed) {
        this.photoError.set(
          error instanceof Error
            ? error.message
            : 'Unable to remove your photo.'
        );
      }
    } finally {
      if (!this.destroyed) this.photoBusy.set(false);
    }
  }

  async changePassword(form: NgForm): Promise<void> {
    if (this.passwordBusy()) return;

    this.passwordError.set('');
    this.passwordFeedback.set('');

    if (
      form.invalid
      || !this.currentPassword
      || this.newPassword.length < 8
      || this.newPassword.length > 128
    ) {
      form.form.markAllAsTouched();
      this.passwordError.set(
        'Complete all fields. Use a new password with 8–128 characters.'
      );
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.passwordError.set('The new passwords do not match.');
      return;
    }

    if (this.newPassword === this.currentPassword) {
      this.passwordError.set(
        'Choose a password different from your current password.'
      );
      return;
    }

    const user = this.auth.currentUser;
    const profile = this.account.profile();

    if (
      !user?.email
      || profile?.uid !== user.uid
      || profile.role !== 'personnel'
      || profile.accountStatus !== 'approved'
    ) {
      this.passwordError.set(
        'Please sign in with your personnel account again.'
      );
      return;
    }

    const currentPassword = this.currentPassword;
    const newPassword = this.newPassword;

    this.passwordBusy.set(true);

    try {
      const policy = await validatePassword(
        this.auth,
        newPassword
      );

      if (!policy.isValid) {
        throw new Error('password/policy');
      }

      if (
        this.destroyed
        || this.auth.currentUser?.uid !== user.uid
      ) {
        throw new Error('account/changed');
      }

      await reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(
          user.email,
          currentPassword
        )
      );

      if (
        this.destroyed
        || this.auth.currentUser?.uid !== user.uid
      ) {
        throw new Error('account/changed');
      }

      await updatePassword(user, newPassword);

      if (!this.destroyed) {
        form.resetForm();

        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';

        this.showCurrent.set(false);
        this.showNew.set(false);
        this.showConfirm.set(false);

        this.passwordFeedback.set(
          'Password updated. Use your new password the next time you sign in.'
        );
      }
    } catch (error: unknown) {
      if (this.destroyed) return;

      const code =
        typeof error === 'object'
        && error !== null
        && 'code' in error
          ? String(error.code)
          : '';

      const reason =
        error instanceof Error ? error.message : '';

      let message =
        'Unable to change your password. Please try again.';

      if (
        [
          'auth/invalid-credential',
          'auth/wrong-password',
          'auth/invalid-login-credentials',
        ].includes(code)
      ) {
        message = 'Your current password is incorrect.';
      } else if (code === 'auth/too-many-requests') {
        message =
          'Too many attempts. Please wait before trying again.';
      } else if (code === 'auth/network-request-failed') {
        message = 'Please check your internet connection.';
      } else if (
        code === 'auth/weak-password'
        || reason === 'password/policy'
      ) {
        message =
          'Your new password does not meet the password requirements. Choose a stronger password.';
      } else if (
        reason === 'account/changed'
        || code === 'auth/requires-recent-login'
        || code === 'auth/user-token-expired'
        || code === 'auth/user-disabled'
      ) {
        message =
          'Please sign in again before changing your password.';
      }

      this.passwordError.set(message);
    } finally {
      this.currentPassword = '';

      if (!this.destroyed) {
        this.passwordBusy.set(false);
      }
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
  }
}