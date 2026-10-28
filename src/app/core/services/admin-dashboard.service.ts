import {
  Injectable,
  OnDestroy,
  computed,
  signal,
} from '@angular/core';

import {
  getAuth,
  onAuthStateChanged,
} from 'firebase/auth';

import {
  Timestamp,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';

import { firebaseApp } from '../firebase.config';

interface DashboardUser {
  uid: string;
  name: string;
  role: string;
}

interface DashboardConcern {
  id: string;
  residentId: string;
  categoryId: number;
  status: string;
  submittedAt: string | null;
}

export interface AdminRecentConcern {
  id: string;
  category: string;
  submittedBy: string;
  status: string;
  submittedAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminDashboardService implements OnDestroy {
  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  private stopAuth?: () => void;
  private stopProfile?: () => void;
  private dataListeners: Array<() => void> = [];

  private generation = 0;
  private dataGeneration = 0;

  private readonly users = signal<DashboardUser[]>([]);
  private readonly concerns = signal<DashboardConcern[]>([]);
  private readonly categories =
    signal<Record<string, string>>({});

  private readonly usersReady = signal(false);
  private readonly concernsReady = signal(false);
  private readonly categoriesReady = signal(false);
  private readonly authorized = signal(false);

  readonly error = signal('');

  readonly loading = computed(
    () =>
      !this.error() &&
      (
        !this.authorized() ||
        !this.usersReady() ||
        !this.concernsReady() ||
        !this.categoriesReady()
      )
  );

  readonly totalResidents = computed(
    () => this.users().filter(user => user.role === 'resident').length
  );

  readonly personnelAccounts = computed(
    () => this.users().filter(user => user.role === 'personnel').length
  );

  readonly totalConcerns = computed(
    () => this.concerns().length
  );

  readonly pendingConcerns = computed(
    () =>
      this.concerns().filter(
        concern => concern.status === 'Pending'
      ).length
  );

  readonly recentConcerns = computed<AdminRecentConcern[]>(() => {
    const names = new Map(
      this.users().map(user => [user.uid, user.name])
    );

    const categories = this.categories();

    return [...this.concerns()]
      .sort((a, b) => {
        const difference =
          this.dateValue(b.submittedAt) -
          this.dateValue(a.submittedAt);

        return difference || a.id.localeCompare(b.id);
      })
      .slice(0, 5)
      .map(concern => ({
        id: concern.id,
        category:
          categories[String(concern.categoryId)] ||
          `Category ${concern.categoryId}`,
        submittedBy:
          names.get(concern.residentId) ||
          'Resident record unavailable',
        status: concern.status || 'Not recorded',
        submittedAt: concern.submittedAt,
      }));
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
    this.clearData();
    this.error.set('');

    const user = this.auth.currentUser;

    if (!user) {
      this.error.set('Please sign in to view the dashboard.');
      return;
    }

    let listening = false;

    this.stopProfile = onSnapshot(
      doc(this.db, 'users', user.uid),
      snapshot => {
        if (generation !== this.generation) return;

        const profile = snapshot.data();

        if (
          profile?.['role'] !== 'admin' ||
          profile?.['accountStatus'] !== 'approved'
        ) {
          listening = false;
          this.clearData();
          this.error.set(
            'An approved administrator account is required.'
          );
          return;
        }

        if (!listening) {
          listening = true;
          this.error.set('');
          this.authorized.set(true);
          this.listenToData(generation);
        }
      },
      () => {
        if (generation !== this.generation) return;

        this.clearData();
        this.error.set(
          'Unable to verify your administrator account. Try again.'
        );
      }
    );
  }

  private listenToData(generation: number): void {
    const dataGeneration = this.dataGeneration;

    const active = () =>
      generation === this.generation &&
      dataGeneration === this.dataGeneration;

    const fail = () => {
      if (!active()) return;

      this.clearData();
      this.error.set(
        'Unable to load dashboard data. Check your connection and administrator read permissions, then try again.'
      );
    };

    const usersQuery = query(
      collection(this.db, 'users'),
      where('role', 'in', ['resident', 'personnel'])
    );

    this.dataListeners.push(
      onSnapshot(
        usersQuery,
        snapshot => {
          if (!active()) return;

          this.users.set(
            snapshot.docs.map(record => {
              const data = record.data();

              return {
                uid: record.id,
                name: this.text(data['name']) || 'Name not recorded',
                role: this.text(data['role']),
              };
            })
          );

          this.usersReady.set(true);
        },
        fail
      )
    );

    this.dataListeners.push(
      onSnapshot(
        collection(this.db, 'categories'),
        snapshot => {
          if (!active()) return;

          const categories: Record<string, string> = {};

          for (const record of snapshot.docs) {
            categories[record.id] =
              this.text(record.data()['category_name']);
          }

          this.categories.set(categories);
          this.categoriesReady.set(true);
        },
        fail
      )
    );

    this.dataListeners.push(
      onSnapshot(
        collection(this.db, 'concerns'),
        snapshot => {
          if (!active()) return;

          this.concerns.set(
            snapshot.docs.map(record => {
              const data = record.data();

              return {
                id: record.id,
                residentId: this.text(data['resident_id']),
                categoryId:
                  typeof data['category_id'] === 'number'
                    ? data['category_id']
                    : 0,
                status: this.text(data['current_status']),
                submittedAt: this.toDateString(data['reported_at']),
              };
            })
          );

          this.concernsReady.set(true);
        },
        fail
      )
    );
  }

  private clearData(): void {
    ++this.dataGeneration;

    for (const stop of this.dataListeners) {
      stop();
    }

    this.dataListeners = [];
    this.authorized.set(false);

    this.users.set([]);
    this.concerns.set([]);
    this.categories.set({});

    this.usersReady.set(false);
    this.concernsReady.set(false);
    this.categoriesReady.set(false);
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private toDateString(value: unknown): string | null {
    if (value instanceof Timestamp) {
      return value.toDate().toISOString();
    }

    if (typeof value === 'string') {
      const timestamp = Date.parse(value);

      return Number.isNaN(timestamp)
        ? null
        : new Date(timestamp).toISOString();
    }

    return null;
  }

  private dateValue(value: string | null): number {
    return value ? Date.parse(value) : 0;
  }

  ngOnDestroy(): void {
    ++this.generation;
    this.stopAuth?.();
    this.stopProfile?.();
    this.clearData();
  }
}