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

export interface DashboardConcern {
  id: string;
  residentId: string;
  categoryId: number;
  officeId: string;
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

export interface AnalyticsBar {
  id: string;
  label: string;
  count: number;
  percent: number;
}

export interface StatusSlice extends AnalyticsBar {
  color: string;
}

export interface AnalyticsPeriod {
  from: string;
  to: string;
}

export function localDay(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function defaultAnalyticsPeriod(
  now = new Date()
): AnalyticsPeriod {
  return {
    from: localDay(
      new Date(
        now.getFullYear(),
        now.getMonth() - 5,
        1
      )
    ),
    to: localDay(now),
  };
}

export function parseAnalyticsDay(
  value: string
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] =
    value.split('-').map(Number);

  const date = new Date(year, month - 1, day);

  return year >= 1900 && localDay(date) === value
    ? date
    : null;
}

export function validateAnalyticsPeriod(
  period: AnalyticsPeriod,
  now = new Date()
): string {
  const from = parseAnalyticsDay(period.from);
  const to = parseAnalyticsDay(period.to);

  if (!from || !to) {
    return 'Enter valid From and To dates.';
  }

  if (from > to) {
    return 'Date From must be on or before Date To.';
  }

  if (period.to > localDay(now)) {
    return 'Date To cannot be in the future.';
  }

  return '';
}

export function concernsInPeriod(
  records: DashboardConcern[],
  period: AnalyticsPeriod
): DashboardConcern[] {
  const from = parseAnalyticsDay(period.from);
  const end = parseAnalyticsDay(period.to);

  if (!from || !end) return [];

  // Include the entire selected final day.
  const until = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate() + 1
  ).getTime();

  return records.filter(record => {
    const time = record.submittedAt
      ? Date.parse(record.submittedAt)
      : NaN;

    return time >= from.getTime() && time < until;
  });
}

export function submissionSeries(
  records: DashboardConcern[],
  period: AnalyticsPeriod
): {
  yearly: boolean;
  rows: AnalyticsBar[];
} {
  const from = parseAnalyticsDay(period.from)!;
  const to = parseAnalyticsDay(period.to)!;

  const monthCount =
    (to.getFullYear() - from.getFullYear()) * 12 +
    to.getMonth() -
    from.getMonth() +
    1;

  const yearly = monthCount > 24;

  const counts = new Map<string, number>();
  const labels = new Map<string, string>();

  const keyFor = (date: Date): string =>
    yearly
      ? String(date.getFullYear())
      : localDay(date).slice(0, 7);

  const cursor = new Date(
    from.getFullYear(),
    yearly ? 0 : from.getMonth(),
    1
  );

  const last = new Date(
    to.getFullYear(),
    yearly ? 0 : to.getMonth(),
    1
  );

  while (cursor <= last) {
    const key = keyFor(cursor);

    counts.set(key, 0);

    labels.set(
      key,
      yearly
        ? key
        : cursor.toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
          })
    );

    if (yearly) {
      cursor.setFullYear(cursor.getFullYear() + 1);
    } else {
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  for (const record of records) {
    if (!record.submittedAt) continue;

    const key = keyFor(
      new Date(record.submittedAt)
    );

    if (counts.has(key)) {
      counts.set(key, counts.get(key)! + 1);
    }
  }

  const max = Math.max(1, ...counts.values());

  return {
    yearly,
    rows: [...counts].map(([id, count]) => ({
      id,
      label: labels.get(id)!,
      count,
      percent: (count / max) * 100,
    })),
  };
}

export function groupedConcerns(
  records: DashboardConcern[],
  keyFor: (record: DashboardConcern) => string,
  labelFor: (id: string) => string
): AnalyticsBar[] {
  const counts = new Map<string, number>();

  for (const record of records) {
    const key = keyFor(record);

    counts.set(
      key,
      (counts.get(key) || 0) + 1
    );
  }

  const max = Math.max(1, ...counts.values());

  return [...counts]
    .map(([id, count]) => ({
      id,
      label: labelFor(id),
      count,
      percent: (count / max) * 100,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.label.localeCompare(b.label)
    );
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
  private scopeUid = '';

  private readonly users =
    signal<DashboardUser[]>([]);

  private readonly concerns =
    signal<DashboardConcern[]>([]);

  private readonly categories =
    signal<Record<string, string>>({});

  private readonly offices =
    signal<Record<string, string>>({});

  private readonly ready = signal(0);
  private readonly authorized = signal(false);

  readonly error = signal('');

  readonly lastUpdated =
    signal<string | null>(null);

  readonly period = signal<AnalyticsPeriod>(
    defaultAnalyticsPeriod()
  );

  readonly loading = computed(
    () =>
      !this.error() &&
      (
        !this.authorized() ||
        this.ready() < 4
      )
  );

  readonly totalResidents = computed(
    () =>
      this.users().filter(
        user => user.role === 'resident'
      ).length
  );

  readonly personnelAccounts = computed(
    () =>
      this.users().filter(
        user => user.role === 'personnel'
      ).length
  );

  readonly totalConcerns = computed(
    () => this.concerns().length
  );

  readonly pendingConcerns = computed(
    () =>
      this.concerns().filter(
        record => record.status === 'Pending'
      ).length
  );

  readonly undatedConcerns = computed(
    () =>
      this.concerns().filter(
        record => !record.submittedAt
      ).length
  );

  readonly filteredConcerns = computed(
    () =>
      concernsInPeriod(
        this.concerns(),
        this.period()
      )
  );

  readonly filteredTotal = computed(
    () => this.filteredConcerns().length
  );

  readonly resolvedCount = computed(
    () =>
      this.filteredConcerns().filter(
        record => record.status === 'Resolved'
      ).length
  );

  readonly resolvedPercent = computed(
    () =>
      this.filteredTotal()
        ? (
            this.resolvedCount() /
            this.filteredTotal()
          ) * 100
        : 0
  );

  readonly series = computed(
    () =>
      submissionSeries(
        this.filteredConcerns(),
        this.period()
      )
  );

  readonly categoryBars = computed(() => {
    const names = this.categories();

    return groupedConcerns(
      this.filteredConcerns(),
      record => String(record.categoryId),
      id => names[id] || `Category ${id}`
    );
  });

  readonly officeBars = computed(() => {
    const names = this.offices();

    return groupedConcerns(
      this.filteredConcerns(),
      record => record.officeId,
      id =>
        id
          ? names[id] || `Office ${id}`
          : 'Unassigned office'
    );
  });

  readonly statusSlices = computed<StatusSlice[]>(
    () => {
      const records = this.filteredConcerns();

      const definitions = [
        ['Pending', '#d99513'],
        ['In Progress', '#327acc'],
        ['Resolved', '#087b49'],
        ['Rejected', '#cc4b5c'],
      ];

      const rows: StatusSlice[] =
        definitions.map(([label, color]) => ({
          id: label,
          label,
          color,
          count: records.filter(
            record => record.status === label
          ).length,
          percent: 0,
        }));

      const unknown =
        records.length -
        rows.reduce(
          (sum, row) => sum + row.count,
          0
        );

      if (unknown) {
        rows.push({
          id: 'unknown',
          label: 'Not recorded',
          color: '#7b8980',
          count: unknown,
          percent: 0,
        });
      }

      return rows.map(row => ({
        ...row,
        percent: records.length
          ? (row.count / records.length) * 100
          : 0,
      }));
    }
  );

  readonly donutBackground = computed(() => {
    if (!this.filteredTotal()) {
      return '#e7eee9';
    }

    let offset = 0;

    const stops = this.statusSlices()
      .filter(row => row.count)
      .map(row => {
        const start = offset;
        offset += row.percent;

        return `${row.color} ${start}% ${offset}%`;
      });

    return `conic-gradient(${stops.join(', ')})`;
  });

  readonly recentConcerns =
    computed<AdminRecentConcern[]>(() => {
      const names = new Map(
        this.users().map(
          user => [user.uid, user.name]
        )
      );

      const categories = this.categories();

      return [...this.concerns()]
        .sort(
          (a, b) =>
            this.dateValue(b.submittedAt) -
              this.dateValue(a.submittedAt) ||
            a.id.localeCompare(b.id)
        )
        .slice(0, 5)
        .map(record => ({
          id: record.id,
          category:
            categories[String(record.categoryId)] ||
            `Category ${record.categoryId}`,
          submittedBy:
            names.get(record.residentId) ||
            'Resident record unavailable',
          status:
            record.status || 'Not recorded',
          submittedAt: record.submittedAt,
        }));
    });

  constructor() {
    this.stopAuth = onAuthStateChanged(
      this.auth,
      () => this.reload()
    );
  }

  applyPeriod(
    from: string,
    to: string
  ): string {
    const period = { from, to };

    const error =
      validateAnalyticsPeriod(period);

    if (!error) {
      this.period.set(period);
    }

    return error;
  }

  resetPeriod(): void {
    this.period.set(
      defaultAnalyticsPeriod()
    );
  }

  reload(): void {
    const generation = ++this.generation;

    this.stopProfile?.();
    this.stopProfile = undefined;

    this.clearData();
    this.error.set('');

    const user = this.auth.currentUser;
    const uid = user?.uid || '';

    if (uid !== this.scopeUid) {
      this.scopeUid = uid;
      this.resetPeriod();
    }

    if (!user) {
      this.error.set(
        'Please sign in to view the dashboard.'
      );
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

  private listenToData(
    generation: number
  ): void {
    const dataGeneration = this.dataGeneration;

    const active = (): boolean =>
      generation === this.generation &&
      dataGeneration === this.dataGeneration;

    const loaded = new Set<string>();

    const finish = (key: string): void => {
      loaded.add(key);
      this.ready.set(loaded.size);
      this.lastUpdated.set(
        new Date().toISOString()
      );
    };

    const fail = (): void => {
      if (!active()) return;

      this.clearData();

      this.error.set(
        'Unable to load dashboard data. Check your connection and administrator read permissions, then try again.'
      );
    };

    this.dataListeners.push(
      onSnapshot(
        query(
          collection(this.db, 'users'),
          where(
            'role',
            'in',
            ['resident', 'personnel']
          )
        ),
        snapshot => {
          if (!active()) return;

          this.users.set(
            snapshot.docs.map(record => {
              const data = record.data();

              return {
                uid: record.id,
                name:
                  this.text(data['name']) ||
                  'Name not recorded',
                role: this.text(data['role']),
              };
            })
          );

          finish('users');
        },
        fail
      )
    );

    this.dataListeners.push(
      onSnapshot(
        collection(this.db, 'categories'),
        snapshot => {
          if (!active()) return;

          const names: Record<string, string> = {};

          for (const record of snapshot.docs) {
            names[record.id] = this.text(
              record.data()['category_name']
            );
          }

          this.categories.set(names);
          finish('categories');
        },
        fail
      )
    );

    this.dataListeners.push(
      onSnapshot(
        collection(this.db, 'offices'),
        snapshot => {
          if (!active()) return;

          const names: Record<string, string> = {};

          for (const record of snapshot.docs) {
            names[record.id] = this.text(
              record.data()['office_name']
            );
          }

          this.offices.set(names);
          finish('offices');
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
                residentId:
                  this.text(data['resident_id']),
                categoryId:
                  typeof data['category_id'] === 'number'
                    ? data['category_id']
                    : 0,
                officeId:
                  this.text(data['office_id']),
                status:
                  this.text(data['current_status']),
                submittedAt:
                  this.toDateString(
                    data['reported_at']
                  ),
              };
            })
          );

          finish('concerns');
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
    this.offices.set({});

    this.ready.set(0);
    this.lastUpdated.set(null);
  }

  private text(value: unknown): string {
    return typeof value === 'string'
      ? value.trim()
      : '';
  }

  private toDateString(
    value: unknown
  ): string | null {
    const date =
      value instanceof Timestamp
        ? value.toDate()
        : value instanceof Date
          ? value
          : typeof value === 'string'
            ? new Date(value)
            : null;

    return date && Number.isFinite(date.getTime())
      ? date.toISOString()
      : null;
  }

  private dateValue(
    value: string | null
  ): number {
    return value ? Date.parse(value) : 0;
  }

  ngOnDestroy(): void {
    ++this.generation;

    this.stopAuth?.();
    this.stopProfile?.();
    this.clearData();
  }
}