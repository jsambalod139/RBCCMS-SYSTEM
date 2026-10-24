import { Injectable } from '@angular/core';
import { getAuth } from 'firebase/auth';
import { firebaseApp } from '../firebase.config';

const ENDPOINT =
  'https://nlwjwvhjojnjrmlaykym.supabase.co/functions/v1/concern-photos';

const MAX_BYTES = 5 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class ConcernPhotoService {
  private readonly auth = getAuth(firebaseApp);

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

  async cleanup(
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