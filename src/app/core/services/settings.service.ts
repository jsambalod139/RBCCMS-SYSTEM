import {
  Injectable,
  OnDestroy,
  computed,
  effect,
  signal,
  untracked,
} from '@angular/core';

import { getAuth, onAuthStateChanged } from 'firebase/auth';

import {
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { firebaseApp } from '../firebase.config';
import { compressProfilePhoto } from '../utils/compress-profile-photo';

export type SettingsRole = 'resident' | 'personnel' | 'admin';

export interface SettingsAccount {
  uid: string;
  name: string;
  email: string;
  role: SettingsRole;
  accountStatus: string;
  photoPath: string;
}

@Injectable({ providedIn: 'root' })
export class SettingsService implements OnDestroy {
  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  private readonly endpoint =
    'https://nlwjwvhjojnjrmlaykym.supabase.co/functions/v1/profile-photos';

  readonly profile = signal<SettingsAccount | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  readonly photoUrl = signal('');
  readonly photoError = signal('');
  readonly photoLoading = signal(false);

  readonly notificationEnabled = signal(true);
  readonly preferencesLoading = signal(false);
  readonly preferencesError = signal('');
  readonly preferencesSaving = signal(false);
  readonly preferencesSaveError = signal('');
  readonly preferencesFeedback = signal('');

  private readonly preferenceUid = signal('');
  private stopPreferences?: () => void;
  private preferenceGeneration = 0;

  private stopAuth: () => void;
  private stopProfile?: () => void;

  private generation = 0;
  private photoGeneration = 0;
  private loadedPath = '';
  private photoRequest?: AbortController;

  readonly notificationsEnabled = computed(() => {
    const profile = this.profile();

    return !!profile
      && profile.uid === this.preferenceUid()
      && !this.preferencesLoading()
      && !this.preferencesError()
      && this.notificationEnabled();
  });

  readonly notificationsDisabled = computed(() => {
    const profile = this.profile();

    return !!profile
      && profile.uid === this.preferenceUid()
      && !this.preferencesLoading()
      && !this.preferencesError()
      && !this.notificationEnabled();
  });

  private readonly watchPreferences = effect(() => {
    const uid = this.profile()?.uid || '';

    untracked(() => {
      if (
        uid !== this.preferenceUid()
        || (uid && !this.stopPreferences)
      ) {
        this.listenPreferences(uid);
      }
    });
  });

  constructor() {
    this.stopAuth = onAuthStateChanged(
      this.auth,
      () => this.reload()
    );
  }

  reload(): void {
    const generation = ++this.generation;

    this.stopProfile?.();
    this.stopProfile = undefined;

    this.clearPhoto();
    this.profile.set(null);
    this.error.set('');
    this.loading.set(true);

    const user = this.auth.currentUser;

    if (!user) {
      this.loading.set(false);
      return;
    }

    this.stopProfile = onSnapshot(
      doc(this.db, 'users', user.uid),
      snapshot => {
        if (generation !== this.generation) return;

        const data = snapshot.data();
        const role = data?.['role'];

        if (
          !data
          || !this.isSupportedRole(role)
          || data['accountStatus'] !== 'approved'
        ) {
          this.profile.set(null);
          this.clearPhoto();
          this.error.set('An approved account is required.');
          this.loading.set(false);
          return;
        }

        const text = (key: string): string =>
          typeof data[key] === 'string'
            ? data[key].trim()
            : '';

        const path = text('profilePhotoPath');

        this.profile.set({
          uid: user.uid,
          name: text('name'),
          email: user.email || text('email'),
          role,
          accountStatus: 'approved',
          photoPath: path,
        });

        this.loading.set(false);
        this.error.set('');

        if (path !== this.loadedPath) {
          this.clearPhoto();
          this.loadedPath = path;

          if (path) {
            void this.loadPhoto(user.uid, path);
          }
        }
      },
      () => {
        if (generation !== this.generation) return;

        this.profile.set(null);
        this.clearPhoto();
        this.loading.set(false);
        this.error.set(
          'Unable to load your account. Check your connection and try again.'
        );
      }
    );
  }

  initials(): string {
    const profile = this.profile();

    const initials = profile?.name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('');

    if (initials) return initials;

    switch (profile?.role) {
      case 'resident':
        return 'R';
      case 'personnel':
        return 'P';
      case 'admin':
        return 'A';
      default:
        return 'U';
    }
  }

  async uploadPhoto(file: File): Promise<void> {
    const uid = this.requireUid();
    const compressed = await compressProfilePhoto(file);

    if (uid !== this.requireUid()) {
      throw new Error('Your login changed. Sign in again.');
    }

    const form = new FormData();
    form.set('action', 'upload');
    form.set('file', compressed);

    await this.request(uid, form);
  }

  async removePhoto(): Promise<void> {
    const uid = this.requireUid();
    await this.request(uid, { action: 'remove' });
  }

  retryPhoto(): void {
    const profile = this.profile();

    if (profile?.photoPath) {
      void this.loadPhoto(profile.uid, profile.photoPath);
    }
  }

  imageFailed(): void {
    this.releaseUrl();
    this.photoError.set(
      'Your profile photo could not be displayed. Try reloading it.'
    );
  }

  private listenPreferences(uid: string): void {
    const generation = ++this.preferenceGeneration;

    this.stopPreferences?.();
    this.stopPreferences = undefined;

    this.preferenceUid.set(uid);
    this.notificationEnabled.set(true);
    this.preferencesLoading.set(!!uid);
    this.preferencesError.set('');
    this.preferencesSaveError.set('');
    this.preferencesFeedback.set('');
    this.preferencesSaving.set(false);

    if (!uid) return;

    this.stopPreferences = onSnapshot(
      doc(
        this.db,
        'users',
        uid,
        'preferences',
        'notifications'
      ),
      { includeMetadataChanges: true },
      snapshot => {
        if (
          generation !== this.preferenceGeneration
          || snapshot.metadata.hasPendingWrites
        ) {
          return;
        }

        const data = snapshot.data();

        if (
          snapshot.exists()
          && typeof data?.['enabled'] !== 'boolean'
        ) {
          this.preferencesLoading.set(false);
          this.preferencesError.set(
            'Your notification preference could not be read. Contact the administrator.'
          );
          return;
        }

        this.notificationEnabled.set(
          snapshot.exists() ? data!['enabled'] : true
        );

        this.preferencesLoading.set(false);
        this.preferencesError.set('');
      },
      () => {
        if (generation !== this.preferenceGeneration) return;

        this.preferencesLoading.set(false);
        this.preferencesError.set(
          'Unable to load your notification preference. Check your connection and Firestore rules.'
        );
      }
    );
  }

  retryNotificationPreferences(): void {
    if (this.preferencesSaving()) return;

    this.listenPreferences(this.profile()?.uid || '');
  }

  async saveNotificationPreference(
    enabled: boolean
  ): Promise<void> {
    if (this.preferencesSaving()) return;

    this.preferencesSaveError.set('');
    this.preferencesFeedback.set('');

    let uid: string;

    try {
      uid = this.requireUid();
    } catch {
      this.preferencesSaveError.set('Please sign in again.');
      return;
    }

    if (
      typeof enabled !== 'boolean'
      || uid !== this.preferenceUid()
      || this.preferencesLoading()
      || this.preferencesError()
    ) {
      this.preferencesSaveError.set(
        'Load your preferences before changing this setting.'
      );
      return;
    }

    const generation = this.preferenceGeneration;
    this.preferencesSaving.set(true);

    try {
      await setDoc(
        doc(
          this.db,
          'users',
          uid,
          'preferences',
          'notifications'
        ),
        {
          enabled,
          updatedAt: serverTimestamp(),
        }
      );

      if (
        generation !== this.preferenceGeneration
        || this.auth.currentUser?.uid !== uid
      ) {
        return;
      }

      this.notificationEnabled.set(enabled);
      this.preferencesFeedback.set(
        'Notification preference saved.'
      );
    } catch {
      if (generation === this.preferenceGeneration) {
        this.preferencesSaveError.set(
          'Your preference was not saved. Check your connection and try again.'
        );
      }
    } finally {
      if (generation === this.preferenceGeneration) {
        this.preferencesSaving.set(false);
      }
    }
  }

  private isSupportedRole(
    value: unknown
  ): value is SettingsRole {
    return value === 'resident'
      || value === 'personnel'
      || value === 'admin';
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    const profile = this.profile();

    if (
      !uid
      || !profile
      || profile.uid !== uid
      || profile.accountStatus !== 'approved'
      || !this.isSupportedRole(profile.role)
    ) {
      throw new Error(
        'Please sign in with an approved account.'
      );
    }

    return uid;
  }

  private async request(
    uid: string,
    body: FormData | object,
    abortSignal?: AbortSignal
  ): Promise<Response> {
    const user = this.auth.currentUser;

    if (!user || user.uid !== uid) {
      throw new Error('Please sign in again.');
    }

    const token = await user.getIdToken();

    if (this.auth.currentUser?.uid !== uid) {
      throw new Error('Your login changed. Sign in again.');
    }

    const multipart = body instanceof FormData;
    let response: Response;

    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(multipart
            ? {}
            : { 'Content-Type': 'application/json' }),
        },
        body: multipart ? body : JSON.stringify(body),
        signal: abortSignal
          ? AbortSignal.any([
              abortSignal,
              AbortSignal.timeout(60000),
            ])
          : AbortSignal.timeout(60000),
      });
    } catch {
      throw new Error(
        'The photo request could not be confirmed. Check your connection and reload your account before retrying.'
      );
    }

    if (this.auth.currentUser?.uid !== uid) {
      throw new Error('Your login changed. Sign in again.');
    }

    if (!response.ok) {
      const result = await response.json().catch(() => null);

      throw new Error(
        result?.error || 'Unable to complete the photo request.'
      );
    }

    return response;
  }

  private async loadPhoto(
    uid: string,
    path: string
  ): Promise<void> {
    const generation = ++this.photoGeneration;

    this.photoRequest?.abort();
    this.photoRequest = new AbortController();

    this.photoLoading.set(true);
    this.photoError.set('');

    try {
      const response = await this.request(
        uid,
        { action: 'download', path },
        this.photoRequest.signal
      );

      const blob = await response.blob();

      if (
        generation !== this.photoGeneration
        || this.profile()?.uid !== uid
        || this.profile()?.photoPath !== path
      ) {
        return;
      }

      if (
        blob.type !== 'image/jpeg'
        || !blob.size
        || blob.size > 250 * 1024
      ) {
        throw new Error('Invalid profile photo response.');
      }

      this.releaseUrl();
      this.photoUrl.set(URL.createObjectURL(blob));
    } catch (error: unknown) {
      if (generation === this.photoGeneration) {
        this.photoError.set(
          error instanceof Error
            ? error.message
            : 'Unable to load your profile photo.'
        );
      }
    } finally {
      if (generation === this.photoGeneration) {
        this.photoLoading.set(false);
      }
    }
  }

  private releaseUrl(): void {
    const url = this.photoUrl();

    if (url) URL.revokeObjectURL(url);

    this.photoUrl.set('');
  }

  private clearPhoto(): void {
    ++this.photoGeneration;
    this.photoRequest?.abort();
    this.loadedPath = '';

    this.releaseUrl();
    this.photoError.set('');
    this.photoLoading.set(false);
  }

  ngOnDestroy(): void {
    ++this.preferenceGeneration;
    this.stopPreferences?.();
    this.watchPreferences.destroy();

    ++this.generation;
    this.stopAuth();
    this.stopProfile?.();
    this.clearPhoto();
  }
}