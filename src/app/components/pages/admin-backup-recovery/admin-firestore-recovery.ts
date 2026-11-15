
import { CommonModule } from '@angular/common';

import {
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';

import {
  FormsModule,
} from '@angular/forms';

import {
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
} from 'firebase/auth';

import {
  firebaseApp,
} from '../../../core/firebase.config';

import {
  BackupRecoveryService,
} from '../../../core/services/backup-recovery.service';

import {
  ConcernRestorePreview,
  FirestoreConcernRecoveryService,
} from '../../../core/services/firestore-concern-recovery.service';

@Component({
  selector: 'app-admin-firestore-recovery',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
  ],

  template: `
    <div class="concern-recovery">
      <h4>
        Recover Missing Concern Records
      </h4>

      <p>
        Choose a completed Full Backup.
        The system will restore
        <strong>missing concern records only</strong>.
        Existing records are never replaced.
      </p>

      <label for="concern-full-backup">
        Select Full Backup
      </label>

      <select
        id="concern-full-backup"
        [(ngModel)]="selectedBackupId"
        (ngModelChange)="clearPreview()"
        [disabled]="busy()"
      >
        <option value="">
          Choose a completed Full Backup
        </option>

        @for (
          run of fullBackups();
          track run.id
        ) {
          <option [value]="run.id">
            {{
              run.createdAt |
              date:'MMM d, y, h:mm a':'GMT+08:00'
            }}
            — Manual Full Backup
          </option>
        }
      </select>

      @if (
        !fullBackups().length &&
        !busy()
      ) {
        <p>
          No completed Full Backup available yet.
          Create one using Backup Now.
        </p>
      }

      <button
        type="button"
        class="outline"
        (click)="check()"
        [disabled]="busy() || !selectedBackupId"
      >
        {{
          busy()
            ? 'Checking...'
            : 'Preview Missing Concerns'
        }}
      </button>

      @if (result(); as p) {
        <div class="stats">
          <div>
            Backed-up concerns:
            <strong>{{ p.total }}</strong>
          </div>

          <div>
            Still present:
            <strong>{{ p.existing }}</strong>
          </div>

          <div>
            Missing:
            <strong>{{ p.missing }}</strong>
          </div>
        </div>

        @if (p.missing > 0) {
          <p class="warning">
            Restore will create up to
            {{ p.limit }} missing concern records.

            It will not overwrite or delete
            existing concerns.

            Only top-level concern records
            are covered.
          </p>

          <label for="concern-confirmation">
            Type
            <strong>
              RESTORE MISSING CONCERNS
            </strong>
          </label>

          <input
            id="concern-confirmation"
            [(ngModel)]="confirmation"
            placeholder="RESTORE MISSING CONCERNS"
            autocomplete="off"
          />

          <label for="concern-password">
            Current Admin password
          </label>

          <input
            id="concern-password"
            type="password"
            [(ngModel)]="password"
            autocomplete="current-password"
          />

          <button
            type="button"
            class="restore"
            (click)="restore()"
            [disabled]="
              busy() ||
              p.missing > p.limit ||
              confirmation !== 'RESTORE MISSING CONCERNS' ||
              !password
            "
          >
            {{
              busy()
                ? 'Restoring...'
                : 'Restore Missing Concerns'
            }}
          </button>
        } @else {
          <p class="success">
            All backed-up concern records
            still exist. No recovery needed.
          </p>
        }
      }

      @if (error()) {
        <p class="error" role="alert">
          {{ error() }}
        </p>
      }

      @if (message()) {
        <p class="success" role="status">
          {{ message() }}
        </p>
      }
    </div>
  `,

  styles: [`
    .concern-recovery {
      padding: 16px;
      margin-top: 20px;
      background: #f5faf6;
      border: 1px solid #cbded2;
      border-radius: 10px;
    }

    h4 {
      margin: 0 0 8px;
      color: #154c31;
      font-size: 16px;
    }

    p {
      color: #46594d;
      font-size: 12px;
      line-height: 1.6;
    }

    label {
      display: block;
      margin: 12px 0 5px;
      font-weight: 700;
      font-size: 12px;
    }

    input,
    select {
      display: block;
      width: 100%;
      max-width: 620px;
      padding: 10px;
      border: 1px solid #bdd3c4;
      border-radius: 7px;
      background: white;
      font: inherit;
    }

    button {
      margin-top: 12px;
      border-radius: 7px;
      padding: 10px 14px;
      border: 1px solid #13643a;
      cursor: pointer;
      font-weight: 700;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .outline {
      color: #145c36;
      background: white;
    }

    .restore {
      display: block;
      background: #176b40;
      color: white;
    }

    .stats {
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
      margin-top: 14px;
      font-size: 12px;
    }

    .stats div {
      background: white;
      border: 1px solid #cbded2;
      border-radius: 7px;
      padding: 10px;
    }

    .warning {
      background: #fff3d8;
      padding: 10px;
      border-radius: 6px;
    }

    .error {
      background: #fff1f1;
      color: #a12a2a;
      padding: 10px;
    }

    .success {
      background: #e7f6eb;
      color: #145c36;
      padding: 10px;
    }
  `],
})
export class AdminFirestoreRecovery implements OnInit {
  private readonly backups =
    inject(BackupRecoveryService);

  private readonly concerns =
    inject(FirestoreConcernRecoveryService);

  readonly fullBackups = signal<{
    id: string;
    createdAt: string;
  }[]>([]);

  readonly result =
    signal<ConcernRestorePreview | null>(null);

  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');

  selectedBackupId = '';
  confirmation = '';
  password = '';

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.busy.set(true);

    try {
      const overview =
        await this.backups.overview();

      this.fullBackups.set(
        (overview.fullBackups ?? [])
          .filter(
            run => Number(run.version) === 2
          )
          .map(run => ({
            id: run.id,
            createdAt: run.createdAt,
          }))
      );
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Unable to load backups.'
      );
    } finally {
      this.busy.set(false);
    }
  }

  clearPreview(): void {
    this.result.set(null);
    this.confirmation = '';
    this.password = '';
    this.error.set('');
    this.message.set('');
  }

  async check(): Promise<void> {
    if (
      !this.selectedBackupId ||
      this.busy()
    ) {
      return;
    }

    this.clearPreview();
    this.busy.set(true);

    try {
      this.result.set(
        await this.concerns.preview(
          this.selectedBackupId
        )
      );
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Preview failed.'
      );
    } finally {
      this.busy.set(false);
    }
  }

  async restore(): Promise<void> {
    const preview = this.result();

    if (
      !preview ||
      preview.backupId !== this.selectedBackupId ||
      this.busy() ||
      preview.missing === 0 ||
      preview.missing > preview.limit ||
      this.confirmation !==
        'RESTORE MISSING CONCERNS' ||
      !this.password
    ) {
      return;
    }

    this.error.set('');
    this.message.set('');
    this.busy.set(true);

    try {
      const user = getAuth(
        firebaseApp
      ).currentUser;

      if (!user?.email) {
        throw new Error(
          'Email/password Admin login is required.'
        );
      }

      await reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(
          user.email,
          this.password
        )
      );

      const outcome =
        await this.concerns.restore(
          preview.backupId
        );

      this.message.set(
        `${outcome.restored} concern records restored; ` +
        `${outcome.skipped} skipped. ` +
        `Existing records were not changed.`
      );

      this.result.set(
        await this.concerns.preview(
          preview.backupId
        )
      );
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Recovery failed.'
      );
    } finally {
      this.password = '';
      this.confirmation = '';
      this.busy.set(false);
    }
  }
}
