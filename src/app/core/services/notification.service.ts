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
  Timestamp,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';

import { firebaseApp } from '../firebase.config';
import { ConcernService } from './concern.service';

import {
  AdminNotificationPreferences,
  SettingsService,
} from './settings.service';

export type AdminNotificationGroup =
  Exclude<keyof AdminNotificationPreferences, 'enabled'>;

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
    | 'updated'
    | 'resident';

  read: boolean;
  target?: 'concern' | 'audit';
  adminGroup?: AdminNotificationGroup;
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

  private readonly adminItems =
    signal<ConcernNotification[]>([]);

  private readonly adminLoading = signal(false);
  private readonly adminError = signal('');

  private stopReads?: () => void;
  private stopAdmin?: () => void;

  private sessionKey = '';
  private generation = 0;

  readonly saving = signal(false);
  readonly actionError = signal('');

  readonly notificationsDisabled =
    this.account.notificationsDisabled;

  readonly loading = computed(() =>
    this.account.loading()
    || this.account.preferencesLoading()
    || this.receiptLoading()
    || (
      this.account.profile()?.role === 'admin'
        ? this.adminLoading()
        : this.concerns.loading()
    )
  );

  readonly error = computed(() =>
    this.account.error()
    || this.account.preferencesError()
    || this.receiptError()
    || (
      this.account.profile()?.role === 'admin'
        ? this.adminError()
        : this.concerns.error()
    )
  );

  readonly notifications =
    computed<ConcernNotification[]>(() => {
      const profile = this.account.profile();

      if (
        !profile
        || profile.accountStatus !== 'approved'
        || !this.account.notificationsEnabled()
        || profile.uid !== this.receiptUid()
        || this.loading()
        || this.error()
      ) return [];

      if (
        profile.role !== 'admin'
        && profile.uid !== this.concerns.accessUid()
      ) return [];

      const read = this.readIds();
      const items: ConcernNotification[] = [];

      if (profile.role === 'admin') {
        const preferences =
          this.account.adminNotificationPreferences();

        items.push(
          ...this.adminItems()
            .filter(item =>
              !!item.adminGroup
              && preferences[item.adminGroup]
            )
            .map(item => ({
              ...item,
              read: read.has(item.id),
            }))
        );
      } else {
        for (const concern of this.concerns.concerns()) {
          const category =
            concern.category?.category_name || 'Community';

          if (
            profile.role === 'personnel'
            && (
              !this.concerns.officeId()
              || concern.office_id !== this.concerns.officeId()
            )
          ) continue;

          const personnel = profile.role === 'personnel';

          const preferences = personnel
            ? this.account.personnelNotificationPreferences()
            : this.account.residentNotificationPreferences();

          if (
            personnel
            && this.account.personnelNotificationPreferences()
              .newConcerns
          ) {
            const id = `submitted_${concern.concern_id}`;

            items.push({
              id,
              concernId: concern.concern_id,
              title: 'New concern submitted',
              message:
                `${category} concern ` +
                `#${concern.concern_number ?? '—'} ` +
                'was submitted to your office.',
              remarks: '',
              createdAt: concern.reported_at,
              kind: 'submitted',
              read: read.has(id),
              target: 'concern',
            });
          }

          if (
            personnel
            || (
              profile.role === 'resident'
              && concern.resident_id === profile.uid
            )
          ) {
            for (const update of concern.updates) {
              const id =
                `update_${concern.concern_id}_${update.update_id}`;

              const status = update.new_status;
              const progressOnly =
                update.previous_status === status;

              const allowed = progressOnly
                ? preferences.progressRemarks
                : status === 'Resolved'
                  ? preferences.resolved
                  : status === 'Rejected'
                    ? preferences.rejected
                    : preferences.statusChanges;

              if (!allowed) continue;

              const number = personnel
                ? concern.concern_number
                : concern.resident_concern_number;

              items.push({
                id,
                concernId: concern.concern_id,
                title: progressOnly
                  ? 'New progress update'
                  : status === 'Resolved'
                    ? 'Concern resolved'
                    : status === 'Rejected'
                      ? 'Concern rejected'
                      : 'Concern status updated',
                message:
                  `${personnel ? 'Your office’s' : 'Your'} ` +
                  `${category} concern #${number ?? '—'} ` +
                  (
                    progressOnly
                      ? `has a new progress note. Status remains ${status}.`
                      : `is now ${status}.`
                  ),
                remarks: update.remarks || '',
                createdAt: update.created_at,
                kind: progressOnly
                  ? 'updated'
                  : status === 'Resolved'
                    ? 'resolved'
                    : status === 'In Progress'
                      ? 'progress'
                      : status === 'Rejected'
                        ? 'rejected'
                        : 'updated',
                read: read.has(id),
                target: 'concern',
              });
            }
          }
        }
      }

      return items.sort((a, b) =>
        (Date.parse(b.createdAt) || 0)
          - (Date.parse(a.createdAt) || 0)
        || a.id.localeCompare(b.id)
      );
    });

  readonly visibleNotifications = computed(() =>
    this.notifications().slice(0, 30)
  );

  readonly unreadCount = computed(() =>
    this.notifications().filter(item => !item.read).length
  );

  private readonly watchAccount = effect(() => {
    const profile = this.account.profile();

    const supported =
      profile?.accountStatus === 'approved'
      && ['resident', 'personnel', 'admin']
        .includes(profile.role);

    const uid = supported ? profile.uid : '';
    const role = supported ? profile.role : '';

    untracked(() => {
      if (
        `${uid}:${role}` !== this.sessionKey
        || (uid && !this.stopReads)
      ) {
        this.listen(uid, role);
      }
    });
  });

  private listen(uid: string, role: string): void {
    const generation = ++this.generation;

    this.stopReads?.();
    this.stopAdmin?.();

    this.stopReads = undefined;
    this.stopAdmin = undefined;

    this.sessionKey = `${uid}:${role}`;
    this.receiptUid.set(uid);

    this.readIds.set(new Set());
    this.adminItems.set([]);

    this.receiptError.set('');
    this.adminError.set('');
    this.actionError.set('');

    this.saving.set(false);
    this.receiptLoading.set(!!uid);
    this.adminLoading.set(!!uid && role === 'admin');

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

    if (role !== 'admin') return;

    this.stopAdmin = onSnapshot(
      query(
        collection(this.db, 'audit_logs'),
        where(
          'category',
          'in',
          ['Concern', 'Resident', 'Office', 'Auth']
        )
      ),
      snapshot => {
        if (generation !== this.generation) return;

        const items: ConcernNotification[] = [];

        for (const document of snapshot.docs) {
          const data = document.data();
          const action = data['action'];
          const group = this.adminEventGroup(data);

          const concernEvent =
            data['entity_type'] === 'concern';

          const residentEvent =
            group === 'residentRecords';

          const entityId =
            typeof data['entity_id'] === 'string'
              ? data['entity_id']
              : '';

          if (
            !group
            || !entityId
            || !(data['created_at'] instanceof Timestamp)
          ) continue;

          const id = `audit_${document.id}`;
          if (id.length > 180) continue;

          const actor =
            typeof data['user_name'] === 'string'
              ? data['user_name'].trim() || 'A user'
              : 'A user';

          const details =
            typeof data['details'] === 'string'
              ? data['details']
                  .replace(
                    /Concern\s*#\d+\s*:?\s*/gi,
                    'Concern '
                  )
                  .trim()
              : '';

          items.push({
            id,
            concernId: concernEvent ? entityId : '',
            adminGroup: group,
            title: action === 'Progress update added'
              ? 'New progress update'
              : action === 'Concern submitted'
                ? 'New concern submitted'
                : action === 'Status changed'
                  ? 'Concern status updated'
                  : action === 'Resident registered'
                    ? 'New resident registered'
                    : action,
            message: `${actor}: ${details || action}.`,
            remarks: '',
            createdAt:
              data['created_at'].toDate().toISOString(),
            kind: residentEvent
              ? 'resident'
              : action === 'Concern submitted'
                ? 'submitted'
                : 'updated',
            read: false,
            target: concernEvent ? 'concern' : 'audit',
          });
        }

        this.adminItems.set(items);
        this.adminLoading.set(false);
        this.adminError.set('');
      },
      () => {
        if (generation !== this.generation) return;

        this.adminItems.set([]);
        this.adminLoading.set(false);
        this.adminError.set(
          'Unable to load admin activity notifications. Try again.'
        );
      }
    );
  }

  private adminEventGroup(
    data: Record<string, unknown>
  ): AdminNotificationGroup | undefined {
    const category = data['category'];
    const entity = data['entity_type'];
    const action = data['action'];

    if (
      category === 'Concern'
      && entity === 'concern'
    ) {
      if (action === 'Concern submitted') {
        return 'newConcerns';
      }

      if (action === 'Status changed') {
        return 'statusChanges';
      }

      if (action === 'Progress update added') {
        return 'progressRemarks';
      }
    }

    if (
      category === 'Resident'
      && entity === 'resident'
      && [
        'Resident registered',
        'Resident profile updated',
      ].includes(String(action))
    ) {
      return 'residentRecords';
    }

    if (
      category === 'Office'
      && entity === 'user'
      && action === 'Personnel registered'
    ) {
      return 'accountManagement';
    }

    if (
      category === 'Auth'
      && entity === 'user'
      && [
        'Account suspended',
        'Account restored',
        'Account profile updated',
      ].includes(String(action))
    ) {
      return 'accountManagement';
    }

    if (
      category === 'Office'
      && entity === 'office'
      && [
        'Office created',
        'Office information updated',
        'Office deleted',
      ].includes(String(action))
    ) {
      return 'officeManagement';
    }

    return undefined;
  }

  retry(): void {
    this.account.retryNotificationPreferences();

    const profile = this.account.profile();

    if (profile?.role !== 'admin') {
      this.concerns.reload();
    }

    this.listen(
      profile?.accountStatus === 'approved'
        ? profile.uid
        : '',
      profile?.role || ''
    );
  }

  async markRead(
    item: ConcernNotification
  ): Promise<void> {
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
        ) return;

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
        ) return;

        this.readIds.update(current =>
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
    this.stopAdmin?.();
    this.watchAccount.destroy();
  }
}