
import { CommonModule } from '@angular/common';
import { AdminFirestoreRecovery } from './admin-firestore-recovery';

import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import {
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
} from 'firebase/auth';

import { firebaseApp } from '../../../core/firebase.config';

import {
  BackupOverview,
  BackupRecoveryService,
  RecoveryPreview,
} from '../../../core/services/backup-recovery.service';

type BackupHistoryRow = {
  id: string;
  date: string;
  type: 'Database' | 'Photos' | 'Full Backup';
  details: string;
  sizeBytes: number | null;
  status: string;
  completed: boolean;
  photoSnapshotId?: string;
  fullBackupId?: string;
};

@Component({
  selector: 'app-admin-backup-recovery',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AdminFirestoreRecovery
  ],
  templateUrl: './admin-backup-recovery.html',
  styleUrl: './admin-backup-recovery.scss',
})
export class AdminBackupRecovery implements OnInit {
  private readonly backups = inject(BackupRecoveryService);

  readonly loading = signal(false);
  readonly working = signal(false);
  readonly downloadingId = signal<string | null>(null);

  readonly overview = signal<BackupOverview | null>(null);
  readonly error = signal('');
  readonly feedback = signal('');

  readonly preview = signal<RecoveryPreview | null>(null);

  readonly activePanel = signal<'recovery' | null>(null);

  selectedSnapshotId = '';
  password = '';
  confirmation = '';

  readonly history = computed<BackupHistoryRow[]>(() => {
    const data = this.overview();

    if (!data) {
      return [];
    }

    const databaseRows: BackupHistoryRow[] =
      data.firestore.backups.map(item => ({
        id: `database:${item.name}`,
        date: item.snapshotTime,
        type: 'Database',
        details: 'Managed Firestore backup',
        sizeBytes: null,
        status: item.state === 'READY'
          ? 'Completed'
          : item.state,
        completed: item.state === 'READY',
      }));

    const groupedPhotoIds = new Set(
      (data.fullBackups ?? [])
        .map(run => run.photos.snapshotId)
        .filter(
          (id): id is string => !!id
        )
    );

    const fullRows: BackupHistoryRow[] =
      (data.fullBackups ?? []).map(run => ({
        id: `full:${run.id}`,
        date: run.createdAt,
        type: 'Full Backup',

        details:
          `Firestore (${run.firestore.documentCount} docs) + ` +
          `Supabase photos (${run.photos.fileCount} files)`,

        sizeBytes:
          run.firestore.totalBytes +
          run.photos.totalBytes,

        status:
          run.status === 'COMPLETED'
            ? 'Completed'
            : run.status,

        completed:
          run.status === 'COMPLETED',

        fullBackupId: run.id,
      }));

    const photoRows: BackupHistoryRow[] = data.photos
      .filter(
        item => !groupedPhotoIds.has(item.id)
      )
      .map(item => ({
        id: `photos:${item.id}`,
        date: item.createdAt,
        type: 'Photos',

        details:
          `Supabase photo backup (${item.fileCount} files)`,

        sizeBytes: item.totalBytes,
        status: 'Completed',
        completed: true,
        photoSnapshotId: item.id,
      }));

    return [
      ...fullRows,
      ...databaseRows,
      ...photoRows,
    ].sort(
      (a, b) =>
        (Date.parse(b.date) || 0) -
        (Date.parse(a.date) || 0)
    );
  });

  ngOnInit(): void {
    void this.refresh();
  }

  togglePanel(panel: 'recovery'): void {
  this.activePanel.update(current =>
    current === panel ? null : panel
  );
}

  async refresh(): Promise<void> {
    if (this.working()) {
      return;
    }

    this.loading.set(true);
    this.error.set('');

    try {
      const overview = await this.backups.overview();

      this.overview.set(overview);

      if (
        !overview.photos.some(
          photo => photo.id === this.selectedSnapshotId
        )
      ) {
        this.selectedSnapshotId =
          overview.photos[0]?.id || '';

        this.preview.set(null);
      }
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Could not load backups.'
      );
    } finally {
      this.loading.set(false);
    }
  }

  async backupFull(): Promise<void> {
    if (this.working()) {
      return;
    }

    this.working.set(true);
    this.error.set('');
    this.feedback.set('');

    try {
      const result =
        await this.backups.createFullBackup();

      this.feedback.set(
        `Full backup completed: ` +
        `${result.backup.firestore.documentCount} Firestore records and ` +
        `${result.backup.photos.fileCount} photos. ` +
        `Download the Full ZIP from Backup History.`
      );

      try {
        await this.refreshAfterWork();
      } catch {
        this.error.set(
          'Backup saved, but Backup History could not refresh. Click Refresh.'
        );
      }
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Full backup could not be completed.'
      );

      try {
        await this.refreshAfterWork();
      } catch {
        // Preserve original error.
      }
    } finally {
      this.working.set(false);
    }
  }

  async backupPhotos(): Promise<void> {
    if (this.working()) {
      return;
    }

    this.working.set(true);
    this.error.set('');
    this.feedback.set('');

    try {
      const result =
        await this.backups.createPhotoBackup();

      this.feedback.set(
        `Photo snapshot saved: ${result.backup.fileCount} files.`
      );

      await this.refreshAfterWork();
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Photo backup failed.'
      );
    } finally {
      this.working.set(false);
    }
  }

  async downloadSnapshot(
    snapshotId: string
  ): Promise<void> {
    if (this.working() || this.downloadingId()) {
      return;
    }

    this.downloadingId.set(snapshotId);
    this.error.set('');
    this.feedback.set('');

    try {
      await this.backups.downloadPhotoBackup(snapshotId);

      this.feedback.set(
        'ZIP ready. Your browser will download ' +
        'the photo backup or ask where to save it.'
      );
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Could not download the photo backup.'
      );
    } finally {
      this.downloadingId.set(null);
    }
  }

  async downloadFullSnapshot(
    backupId: string
  ): Promise<void> {
    if (this.working() || this.downloadingId()) {
      return;
    }

    this.downloadingId.set(backupId);
    this.error.set('');
    this.feedback.set('');

    try {
      await this.backups.downloadFullBackup(backupId);

      this.feedback.set(
        'Full ZIP downloaded: Firestore JSON + saved photos.'
      );
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Full ZIP download failed.'
      );
    } finally {
      this.downloadingId.set(null);
    }
  }

  async selectSnapshot(
    value: string
  ): Promise<void> {
    this.selectedSnapshotId = value;

    this.preview.set(null);
    this.confirmation = '';
    this.password = '';
    this.feedback.set('');

    if (!value) {
      return;
    }

    this.working.set(true);
    this.error.set('');

    try {
      this.preview.set(
        await this.backups.preview(value)
      );
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Could not inspect snapshot.'
      );
    } finally {
      this.working.set(false);
    }
  }

  async restoreMissing(): Promise<void> {
    const details = this.preview();

    if (
      this.working() ||
      !details ||
      details.missing === 0 ||
      details.snapshotId !== this.selectedSnapshotId ||
      this.confirmation !== 'RECOVER MISSING PHOTOS' ||
      !this.password
    ) {
      return;
    }

    this.working.set(true);
    this.error.set('');
    this.feedback.set('');

    try {
      const user = getAuth(firebaseApp).currentUser;

      if (!user?.email) {
        throw new Error(
          'Sign in again with an email and password before recovery.'
        );
      }

      await reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(
          user.email,
          this.password
        )
      );

      const restored =
        await this.backups.recoverMissingPhotos(
          details.snapshotId
        );

      this.feedback.set(
        `Recovery finished: ${restored.restored} ` +
        `missing photo(s) restored; ` +
        `${restored.skippedCount} skipped. ` +
        `Existing photos were not overwritten.`
      );

      this.preview.set(
        await this.backups.preview(
          details.snapshotId
        )
      );
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Recovery was not completed.'
      );
    } finally {
      this.password = '';
      this.confirmation = '';
      this.working.set(false);
    }
  }

  private async refreshAfterWork(): Promise<void> {
    const updated =
      await this.backups.overview();

    this.overview.set(updated);

    this.selectedSnapshotId =
      updated.photos[0]?.id || '';

    this.preview.set(null);
  }
}
