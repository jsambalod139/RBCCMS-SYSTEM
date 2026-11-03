import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import {
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
  signOut,
  updatePassword,
  validatePassword,
} from 'firebase/auth';
import Swal from 'sweetalert2';

import { firebaseApp } from '../../../core/firebase.config';
import { SettingsService } from '../../../core/services/settings.service';

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-settings.html',
  styleUrl: './admin-settings.scss',
})
export class AdminSettings implements OnDestroy {
  readonly account = inject(SettingsService);
  readonly activeTab =
    signal<'account' | 'preferences'>('account');

  private readonly auth = getAuth(firebaseApp);
  private readonly router = inject(Router);
  private destroyed = false;

  readonly photoBusy = signal(false);
  readonly photoAction =
    signal<'upload' | 'remove' | null>(null);
  readonly passwordBusy = signal(false);
  readonly accountBusy = signal(false);

  readonly photoFeedback = signal('');
  readonly photoError = signal('');
  readonly passwordFeedback = signal('');
  readonly passwordError = signal('');
  readonly accountFeedback = signal('');
  readonly accountError = signal('');

  readonly showCurrent = signal(false);
  readonly showNew = signal(false);
  readonly showConfirm = signal(false);
  readonly editing = signal(false);

  readonly busy = computed(
    () =>
      this.photoBusy()
      || this.passwordBusy()
      || this.accountBusy()
  );

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  accountPassword = '';

  draft = {
    name: '',
    firstName: '',
    middleName: '',
    lastName: '',
    email: '',
  };

  private editingUid = '';
  private requestId = '';
  private lastPayload = '';

  editAccount(): void {
    const profile = this.account.profile();

    if (!profile || this.busy()) return;

    this.editingUid = profile.uid;

    this.draft = {
      name: profile.name,
      email: profile.email,
      firstName: profile.firstName,
      middleName: profile.middleName,
      lastName: profile.lastName,
    };

    this.accountPassword = '';
    this.accountError.set('');
    this.accountFeedback.set('');
    this.requestId = '';
    this.lastPayload = '';
    this.editing.set(true);
  }

  cancelAccount(): void {
    if (this.accountBusy()) return;

    this.editing.set(false);
    this.accountPassword = '';
    this.accountError.set('');
  }

  async saveAccount(form: NgForm): Promise<void> {
    if (this.busy()) return;

    if (form.invalid || !this.accountPassword) {
      form.form.markAllAsTouched();

      this.accountError.set(
        'Complete the required fields and enter your current password.'
      );
      return;
    }

    if (
      this.auth.currentUser?.uid !== this.editingUid
      || this.account.profile()?.uid !== this.editingUid
    ) {
      this.accountError.set(
        'Your account changed. Sign in again.'
      );
      return;
    }

    const uid = this.editingUid;
    const draft = { ...this.draft };
    const payload = JSON.stringify(draft);

    if (payload !== this.lastPayload) {
      this.requestId = crypto.randomUUID();
      this.lastPayload = payload;
    }

    this.accountBusy.set(true);
    this.accountError.set('');
    this.accountFeedback.set('');

    try {
      const result = await this.account.saveAccount(
        draft,
        draft.email,
        this.accountPassword,
        this.requestId
      );

      if (
        this.destroyed
        || this.auth.currentUser?.uid !== uid
      ) return;

      this.editing.set(false);

      if (result.emailChanged) {
        await signOut(this.auth);

        await this.router.navigate(
          ['/login-components'],
          { replaceUrl: true }
        );

        await Swal.fire({
          icon: 'success',
          title: 'Email updated',
          text:
            'Sign in using '
            + draft.email.trim().toLowerCase()
            + ' and your current password.',
        });
      } else {
        this.accountFeedback.set(
          result.saved
            ? 'Account information updated.'
            : 'No changes to save.'
        );
      }
    } catch (error: unknown) {
      if (this.sameAccount(uid)) {
        const code =
          (error as { code?: string })?.code;

        this.accountError.set(
          [
            'auth/wrong-password',
            'auth/invalid-credential',
          ].includes(code || '')
            ? 'Your current password is incorrect.'
            : error instanceof Error
              ? error.message
              : 'Unable to update your account.'
        );
      }
    } finally {
      this.accountPassword = '';

      if (!this.destroyed) {
        this.accountBusy.set(false);
      }
    }
  }

  private sameAccount(uid: string): boolean {
    return !this.destroyed
      && this.auth.currentUser?.uid === uid
      && this.account.profile()?.uid === uid;
  }

  async changeNotificationPreference(
    event: Event
  ): Promise<void> {
    const input =
      event.target as HTMLInputElement;

    await this.account.saveNotificationPreference(
      input.checked
    );

    if (!this.destroyed) {
      input.checked =
        this.account.notificationEnabled();
    }
  }

  async changePhoto(event: Event): Promise<void> {
    const input =
      event.target as HTMLInputElement;

    const file = input.files?.[0];
    input.value = '';

    if (!file || this.busy()) return;

    await this.savePhoto('upload', file);
  }

  async removePhoto(): Promise<void> {
    if (
      this.busy()
      || !this.account.profile()?.photoPath
    ) return;

    await this.savePhoto('remove');
  }

  private async savePhoto(
    action: 'upload' | 'remove',
    file?: File
  ): Promise<void> {
    const uid = this.account.profile()?.uid;

    if (!uid || !this.sameAccount(uid)) return;

    this.photoBusy.set(true);
    this.photoAction.set(action);
    this.photoError.set('');
    this.photoFeedback.set('');

    try {
      if (file) {
        await this.account.uploadPhoto(file);
      } else {
        await this.account.removePhoto();
      }

      if (this.sameAccount(uid)) {
        this.photoFeedback.set(
          action === 'upload'
            ? 'Profile photo saved.'
            : 'Profile photo removed.'
        );
      }
    } catch (error: unknown) {
      if (this.sameAccount(uid)) {
        this.photoError.set(
          error instanceof Error
            ? error.message
            : 'Unable to save your photo.'
        );
      }
    } finally {
      if (!this.destroyed) {
        this.photoBusy.set(false);
        this.photoAction.set(null);
      }
    }
  }

  async changePassword(form: NgForm): Promise<void> {
    if (this.busy()) return;

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
        'Complete all fields. Use 8-128 characters for the new password.'
      );
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.passwordError.set(
        'The new passwords do not match.'
      );
      return;
    }

    if (this.newPassword === this.currentPassword) {
      this.passwordError.set(
        'Choose a different new password.'
      );
      return;
    }

    const user = this.auth.currentUser;
    const profile = this.account.profile();

    if (
      !user?.email
      || profile?.uid !== user.uid
      || profile.role !== 'admin'
    ) {
      this.passwordError.set(
        'Please sign in again.'
      );
      return;
    }

    const password = this.newPassword;
    const current = this.currentPassword;

    this.passwordBusy.set(true);

    try {
      const policy =
        await validatePassword(this.auth, password);

      if (!policy.isValid) {
        throw new Error('password/policy');
      }

      if (!this.sameAccount(user.uid)) {
        throw new Error('account/changed');
      }

      await reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(
          user.email,
          current
        )
      );

      if (!this.sameAccount(user.uid)) {
        throw new Error('account/changed');
      }

      await updatePassword(user, password);

      if (this.sameAccount(user.uid)) {
        form.resetForm();
        this.newPassword = '';
        this.confirmPassword = '';

        this.showCurrent.set(false);
        this.showNew.set(false);
        this.showConfirm.set(false);

        this.passwordFeedback.set(
          'Password updated. Use your new password next time you sign in.'
        );
      }
    } catch (error: unknown) {
      if (!this.sameAccount(user.uid)) return;

      const code =
        (error as { code?: string })?.code || '';

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
          'Too many attempts. Please wait before retrying.';
      } else if (code === 'auth/network-request-failed') {
        message = 'Check your internet connection.';
      } else if (
        [
          'auth/weak-password',
          'auth/password-does-not-meet-requirements',
        ].includes(code)
        || (
          error instanceof Error
          && error.message === 'password/policy'
        )
      ) {
        message =
          'Your new password does not meet the password requirements.';
      } else if (
        [
          'auth/requires-recent-login',
          'auth/user-token-expired',
          'auth/user-disabled',
        ].includes(code)
      ) {
        message = 'Please sign in again.';
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

    this.accountPassword = '';
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';

    this.draft = {
      name: '',
      email: '',
      firstName: '',
      middleName: '',
      lastName: '',
    };
  }
}