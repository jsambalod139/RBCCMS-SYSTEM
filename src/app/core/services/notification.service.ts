import {
  Injectable,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

import { firebaseApp } from '../firebase.config';
import { ConcernService } from './concern.service';
import { SettingsService } from './settings.service';

export interface ConcernNotification {
  id: string;
  concernId: string;
  title: string;
  message: string;
  remarks: string;
  createdAt: string;
  kind:
    | 'submitted'
    | 'progress'
    | 'resolved'
    | 'rejected'
    | 'updated';
  read: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {
  private readonly account = inject(SettingsService);
  private readonly concerns = inject(ConcernService);
  private readonly db = getFirestore(firebaseApp);

  private readonly readIds =
    signal<ReadonlySet<string>>(new Set());

  private readonly receiptUid = signal('');
  private readonly receiptLoading = signal(false);
  private readonly receiptError = signal('');

  private stopReads?: () => void;
  private generation = 0;

  readonly saving = signal(false);
  readonly actionError = signal('');

  readonly loading = computed(
    () =>
      this.account.loading()
      || this.account.preferencesLoading()
      || this.receiptLoading()
      || this.concerns.loading()
  );

  readonly error = computed(
    () =>
      this.account.error()
      || this.account.preferencesError()
      || this.receiptError()
      || this.concerns.error()
  );

  readonly notificationsDisabled =
    this.account.notificationsDisabled;

  readonly notifications = computed<
    ConcernNotification[]
  >(() => {
    const profile = this.account.profile();

    if (
      !profile
      || !this.account.notificationsEnabled()
      || profile.uid !== this.receiptUid()
      || this.loading()
      || this.error()
    ) {
      return [];
    }

    if (
      profile.role !== 'resident'
      && profile.role !== 'personnel'
    ) {
      return [];
    }

    const read = this.readIds();
    const items: ConcernNotification[] = [];

    for (const concern of this.concerns.concerns()) {
      const category =
        concern.category?.category_name || 'Community';

      if (profile.role === 'personnel') {
        const id = `submitted_${concern.concern_id}`;

        items.push({
          id,
          concernId: concern.concern_id,
          title: 'New concern submitted',
          message:
            `${category} concern ` +
            `#${concern.concern_number ?? '—'} was submitted.`,
          remarks: '',
          createdAt: concern.reported_at,
          kind: 'submitted',
          read: read.has(id),
        });
      } else if (concern.resident_id === profile.uid) {
        for (const update of concern.updates) {
          const id =
            `update_${concern.concern_id}_` +
            update.update_id;

          const status = update.new_status;

          items.push({
            id,
            concernId: concern.concern_id,
            title:
              status === 'Resolved'
                ? 'Concern resolved'
                : status === 'Rejected'
                  ? 'Concern rejected'
                  : 'Concern status updated',
            message:
              `Your ${category} concern ` +
              `#${concern.resident_concern_number ?? '—'} ` +
              `is now ${status}.`,
            remarks: update.remarks || '',
            createdAt: update.created_at,
            kind:
              status === 'Resolved'
                ? 'resolved'
                : status === 'In Progress'
                  ? 'progress'
                  : status === 'Rejected'
                    ? 'rejected'
                    : 'updated',
            read: read.has(id),
          });
        }
      }
    }

    return items.sort(
      (a, b) =>
        (Date.parse(b.createdAt) || 0)
          - (Date.parse(a.createdAt) || 0)
        || a.id.localeCompare(b.id)
    );
  });

  readonly visibleNotifications = computed(
    () => this.notifications().slice(0, 30)
  );

  readonly unreadCount = computed(
    () =>
      this.notifications().filter(item => !item.read).length
  );

  private readonly watchAccount = effect(() => {
    const profile = this.account.profile();

    const supported =
      profile
      && (
        profile.role === 'resident'
        || profile.role === 'personnel'
      );

    const uid = supported ? profile.uid : '';

    untracked(() => {
      if (
        uid !== this.receiptUid()
        || (uid && !this.stopReads)
      ) {
        this.listen(uid);
      }
    });
  });

  private listen(uid: string): void {
    const generation = ++this.generation;

    this.stopReads?.();
    this.stopReads = undefined;

    this.receiptUid.set(uid);
    this.readIds.set(new Set());
    this.receiptError.set('');
    this.actionError.set('');
    this.saving.set(false);
    this.receiptLoading.set(!!uid);

    if (!uid) return;

    this.stopReads = onSnapshot(
      collection(
        this.db,
        'users',
        uid,
        'notification_reads'
      ),
      snapshot => {
        if (generation !== this.generation) return;

        this.readIds.set(
          new Set(snapshot.docs.map(item => item.id))
        );

        this.receiptLoading.set(false);
        this.receiptError.set('');
      },
      () => {
        if (generation !== this.generation) return;

        this.readIds.set(new Set());
        this.receiptLoading.set(false);
        this.receiptError.set(
          'Unable to load notifications. Check your connection and notification rules.'
        );
      }
    );
  }

  retry(): void {
    this.account.retryNotificationPreferences();
    this.concerns.reload();
    this.listen(this.account.profile()?.uid || '');
  }

  async markRead(item: ConcernNotification): Promise<void> {
    const current = this.notifications().find(
      value => value.id === item.id
    );

    if (current && !current.read) {
      await this.saveReads([current]);
    }
  }

  async markAllRead(): Promise<void> {
    await this.saveReads(
      this.notifications().filter(item => !item.read)
    );
  }

  private async saveReads(
    items: ConcernNotification[]
  ): Promise<void> {
    if (this.saving() || !items.length) return;

    const uid = this.account.profile()?.uid;

    if (!uid || uid !== this.receiptUid()) return;

    const generation = this.generation;

    this.saving.set(true);
    this.actionError.set('');

    try {
      for (
        let offset = 0;
        offset < items.length;
        offset += 400
      ) {
        if (
          generation !== this.generation
          || this.account.profile()?.uid !== uid
        ) {
          return;
        }

        const chunk = items.slice(offset, offset + 400);
        const batch = writeBatch(this.db);

        for (const item of chunk) {
          batch.set(
            doc(
              this.db,
              'users',
              uid,
              'notification_reads',
              item.id
            ),
            { readAt: serverTimestamp() }
          );
        }

        await batch.commit();

        if (
          generation !== this.generation
          || this.account.profile()?.uid !== uid
        ) {
          return;
        }

        this.readIds.update(
          current =>
            new Set([
              ...current,
              ...chunk.map(item => item.id),
            ])
        );
      }
    } catch {
      if (generation === this.generation) {
        this.actionError.set(
          'Unable to mark notifications as read. Please try again.'
        );
      }
    } finally {
      if (generation === this.generation) {
        this.saving.set(false);
      }
    }
  }

  ngOnDestroy(): void {
    ++this.generation;
    this.stopReads?.();
    this.watchAccount.destroy();
  }
}