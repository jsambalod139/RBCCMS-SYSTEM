
import { Injectable } from '@angular/core';
import { getAuth } from 'firebase/auth';
import { firebaseApp } from '../firebase.config';

export interface PhotoSnapshot {
  id: string;
  createdAt: string;
  fileCount: number;
  totalBytes: number;
}

export interface FirestoreBackup {
  name: string;
  snapshotTime: string;
  expireTime: string;
  state: string;
}

export interface FirestoreSchedule {
  name: string;
  recurrence: string;
  retention: string;
}

export interface CombinedBackupRun {
  version: 2;
  id: string;
  createdAt: string;
  status: 'COMPLETED';

  firestore: {
    state: 'COMPLETED';
    documentCount: number;
    collectionCount: number;
    totalBytes: number;
    sha256: string;
    backupPath: string;
  };

  photos: {
    state: 'COMPLETED';
    snapshotId: string;
    fileCount: number;
    totalBytes: number;
  };
}

export interface BackupOverview {
  fullBackups?: CombinedBackupRun[];
  fullBackupConfigured?: boolean;

  firestore: {
    schedules: FirestoreSchedule[];
    backups: FirestoreBackup[];
    error: string;
  };

  photos: PhotoSnapshot[];
}

export interface RecoveryPreview {
  snapshotId: string;
  total: number;
  missing: number;
  existing: number;
}

@Injectable({
  providedIn: 'root'
})
export class BackupRecoveryService {
  private readonly endpoint =
    'https://nlwjwvhjojnjrmlaykym.supabase.co/functions/v1/backup-recovery';

  private async request<T>(
    payload: object,
    freshToken = false
  ): Promise<T> {
    const user = getAuth(firebaseApp).currentUser;

    if (!user) {
      throw new Error(
        'Please sign in as an approved administrator.'
      );
    }

    const token = await user.getIdToken(freshToken);

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      cache: 'no-store'
    });

    let result: any;

    try {
      result = await response.json();
    } catch {
      throw new Error(
        'Backup service returned an unexpected response.'
      );
    }

    if (!response.ok) {
      throw new Error(
        result?.error || 'Backup service failed.'
      );
    }

    return result as T;
  }

  overview(): Promise<BackupOverview> {
    return this.request<BackupOverview>({
      action: 'overview'
    });
  }

  createFullBackup(): Promise<{
    backup: CombinedBackupRun;
  }> {
    return this.request<{
      backup: CombinedBackupRun;
    }>({
      action: 'full-backup'
    });
  }

  createPhotoBackup(): Promise<{
    backup: PhotoSnapshot;
  }> {
    return this.request<{
      backup: PhotoSnapshot;
    }>({
      action: 'photo-backup'
    });
  }

  async downloadFullBackup(
    backupId: string
  ): Promise<void> {
    return this.downloadArchive(
      {
        action: 'full-download',
        backupId
      },
      `RBCCMS_Full_Backup_${backupId}.zip`
    );
  }

  async downloadPhotoBackup(
    snapshotId: string
  ): Promise<void> {
    return this.downloadArchive(
      {
        action: 'photo-download',
        snapshotId
      },
      `RBCCMS_Photos_${snapshotId}.zip`
    );
  }

  private async downloadArchive(
    payload: object,
    filename: string
  ): Promise<void> {
    const user = getAuth(firebaseApp).currentUser;

    if (!user) {
      throw new Error(
        'Please sign in as an approved administrator.'
      );
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      cache: 'no-store'
    });

    if (!response.ok) {
      const details = await response.json()
        .catch(() => ({})) as {
          error?: string;
        };

      throw new Error(
        details.error || 'Backup download failed.'
      );
    }

    if (
      !response.headers
        .get('content-type')
        ?.includes('application/zip')
    ) {
      throw new Error(
        'Server did not return a ZIP file.'
      );
    }

    const blob = await response.blob();

    if (!blob.size) {
      throw new Error(
        'Downloaded archive is empty.'
      );
    }

    const fileUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => {
      URL.revokeObjectURL(fileUrl);
    }, 60000);
  }

  preview(
    snapshotId: string
  ): Promise<RecoveryPreview> {
    return this.request<RecoveryPreview>({
      action: 'photo-preview',
      snapshotId
    });
  }

  recoverMissingPhotos(
    snapshotId: string
  ): Promise<{
    restored: number;
    skippedCount: number;
  }> {
    return this.request<{
      restored: number;
      skippedCount: number;
    }>({
      action: 'photo-recover-missing',
      snapshotId,
      confirmation: 'RECOVER MISSING PHOTOS'
    }, true);
  }
}
