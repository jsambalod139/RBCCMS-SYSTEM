import { Injectable, OnDestroy } from '@angular/core';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { firebaseApp } from '../firebase.config';

const ENDPOINT =
  'https://nlwjwvhjojnjrmlaykym.supabase.co/functions/v1/concern-photos';

const MAX_BYTES = 5 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class ConcernPhotoService implements OnDestroy {
  private readonly auth = getAuth(firebaseApp);
  private readonly cleanupPrefix = 'rbccms:concern-photo-cleanup:';
  private readonly pending = new Set<string>();
  private readonly running = new Set<string>();

  private readonly retryCleanup = (): void => {
    const uid = this.auth.currentUser?.uid;
    if (!uid || !navigator.onLine) return;

    const prefix = this.cleanupPrefix + uid + ':';

    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(prefix)) this.pending.add(key);
      }
    } catch {
      // Use the in-memory queue if browser storage is unavailable.
    }

    for (const key of this.pending) {
      if (!key.startsWith(prefix) || this.running.has(key)) continue;

      const concernId = key.slice(prefix.length);
      if (!/^[A-Za-z0-9]{20}$/.test(concernId)) continue;

      this.running.add(key);
      void this.finishCleanup(key, concernId, uid);
    }
  };

  private readonly stopAuth = onAuthStateChanged(this.auth, this.retryCleanup);

  constructor() {
    window.addEventListener('online', this.retryCleanup);
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.retryCleanup);
    this.stopAuth();
  }

  queueCleanup(concernId: string, uid: string): void {
    const key = this.cleanupPrefix + uid + ':' + concernId;
    this.pending.add(key);

    try {
      localStorage.setItem(key, '1');
    } catch {
      // Keep this request in memory until it can be retried.
    }

    this.retryCleanup();
  }

  private async finishCleanup(
    key: string,
    concernId: string,
    uid: string
  ): Promise<void> {
    try {
      await this.cleanup(concernId, uid);
    } catch (error) {
      // The cleanup endpoint returns this error when a saved concern uses the photo.
      if (!(error instanceof Error) ||
          error.message !== 'A saved concern uses this photo. It cannot be removed.') {
        return;
      }
    } finally {
      this.running.delete(key);
    }

    this.pending.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      // A later retry still goes through the server's saved-concern check.
    }
  }

  async upload(
    concernId: string,
    file: File,
    uid: string
  ): Promise<string> {
    const body = new FormData();

    body.set('action', 'upload');
    body.set('concern_id', concernId);
    body.set('file', file);

    const response = await this.request(body, uid);
    const result = await response.json();

    const expected =
      `concern-photos/${uid}/${concernId}/photo`;

    if (result.photo_path !== expected) {
      throw new Error('Unexpected photo upload response.');
    }

    return expected;
  }

  async download(path: string): Promise<Blob> {
    const match =
      /^concern-photos\/([^/]+)\/([A-Za-z0-9]{20})\/photo$/.exec(path);

    if (!match) {
      throw new Error('Invalid concern photo path.');
    }

    const response = await this.request(
      JSON.stringify({
        action: 'download',
        concern_id: match[2]
      })
    );

    const blob = await response.blob();

    if (
      !blob.size ||
      blob.size > MAX_BYTES ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)
    ) {
      throw new Error('The downloaded photo is invalid.');
    }

    return blob;
  }

  private async cleanup(
    concernId: string,
    uid: string
  ): Promise<void> {
    await this.request(
      JSON.stringify({
        action: 'cleanup',
        concern_id: concernId
      }),
      uid
    );
  }

  private async request(
    body: FormData | string,
    expectedUid?: string
  ): Promise<Response> {
    await this.auth.authStateReady();

    const user = this.auth.currentUser;

    if (
      !user ||
      (expectedUid && user.uid !== expectedUid)
    ) {
      throw new Error(
        'Your login changed. Please sign in again.'
      );
    }

    const token = await user.getIdToken();

    if (this.auth.currentUser?.uid !== user.uid) {
      throw new Error(
        'Your login changed. Please sign in again.'
      );
    }

    let response: Response;

    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',

        headers: {
          Authorization: `Bearer ${token}`,

          ...(typeof body === 'string'
            ? { 'Content-Type': 'application/json' }
            : {})
        },

        body,
        signal: AbortSignal.timeout(60000)
      });
    } catch {
      throw new Error(
        'Cannot reach photo storage. Check your connection and retry.'
      );
    }

    if (!response.ok) {
      const result = await response
        .json()
        .catch(() => null);

      throw new Error(
        typeof result?.error === 'string'
          ? result.error
          : 'Photo request failed. Check the Supabase function settings.'
      );
    }

    if (this.auth.currentUser?.uid !== user.uid) {
      throw new Error(
        'Your login changed. Please sign in again.'
      );
    }

    return response;
  }
}