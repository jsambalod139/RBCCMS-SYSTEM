
import { Injectable } from '@angular/core';

import {
  getAuth,
} from 'firebase/auth';

import {
  firebaseApp,
} from '../firebase.config';

export interface ConcernRestorePreview {
  backupId: string;
  total: number;
  existing: number;
  missing: number;
  missingIds: string[];
  limit: number;
}

@Injectable({
  providedIn: 'root',
})
export class FirestoreConcernRecoveryService {
  private readonly url =
    'https://nlwjwvhjojnjrmlaykym.supabase.co/functions/v1/restore-concerns';

  private async request<T>(
    body: object
  ): Promise<T> {
    const user = getAuth(
      firebaseApp
    ).currentUser;

    if (!user) {
      throw new Error(
        'Sign in as an approved Admin.'
      );
    }

    const token =
      await user.getIdToken(true);

    const response = await fetch(
      this.url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      }
    );

    const result = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.error ||
        'Concern recovery failed.'
      );
    }

    return result as T;
  }

  preview(
    backupId: string
  ): Promise<ConcernRestorePreview> {
    return this.request({
      action: 'preview',
      backupId,
    });
  }

  restore(
    backupId: string
  ): Promise<{
    restored: number;
    skipped: number;
  }> {
    return this.request({
      action: 'restore',
      backupId,
      confirmation: 'RESTORE MISSING CONCERNS',
    });
  }
}
