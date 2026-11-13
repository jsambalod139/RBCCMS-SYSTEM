
import { CommonModule } from '@angular/common';

import {
  Component,
  OnDestroy,
  computed,
  signal,
} from '@angular/core';

import { FormsModule } from '@angular/forms';

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
  orderBy,
  query,
  where,
} from 'firebase/firestore';

import { firebaseApp } from '../../../core/firebase.config';

type AuditCategory = 'Auth' | 'Resident' | 'Concern';

type CategoryFilter = 'All categories' | AuditCategory;

type AuditPeriod = 'this-week' | 'last-week' | 'all-history';

interface AuditEntry {
  id: string;
  userName: string;
  userId: string;
  userRole: string;
  category: string;
  action: string;
  details: string;
  entityId: string;
  createdAt: string | null;
}

@Component({
  selector: 'app-admin-audit-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-audit-logs.html',
  styleUrl: './admin-audit-logs.scss',
})
export class AdminAuditLogs implements OnDestroy {

  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  private stopAuth?: () => void;
  private stopProfile?: () => void;
  private stopLogs?: () => void;

  private generation = 0;
  private logsGeneration = 0;

  /* =====================================
     WEEKLY AUDIT LOG SETTINGS
     ===================================== */

  private readonly weekMs =
    7 * 24 * 60 * 60 * 1000;

  private lastWeekStartMs =
    this.getPhtWeekStart().getTime();

  private weekTimer?: ReturnType<typeof setInterval>;

  readonly selectedPeriod =
    signal<AuditPeriod>('this-week');

  /* =====================================
     AUDIT LOG DATA
     ===================================== */

  private readonly entries =
    signal<AuditEntry[]>([]);

  readonly loading = signal(true);
  readonly errorMessage = signal('');

  readonly searchTerm = signal('');

  readonly selectedCategory =
    signal<CategoryFilter>('All categories');

  readonly currentPage = signal(1);
  readonly pageSize = 10;

  readonly categoryOptions: CategoryFilter[] = [
    'All categories',
    'Auth',
    'Resident',
    'Concern',
  ];

  /* =====================================
     SEARCH AND CATEGORY FILTER
     ===================================== */

  readonly filteredEntries = computed(() => {

    const search = this.searchTerm()
      .trim()
      .toLowerCase();

    const category = this.selectedCategory();

    return this.entries().filter(entry => {

      const matchesCategory =
        category === 'All categories' ||
        entry.category === category;

      const matchesSearch =
        !search ||
        [
          entry.userName,
          entry.userId,
          entry.userRole,
          entry.category,
          entry.action,
          this.displayDetails(entry),
          entry.entityId,
        ].some(value =>
          value.toLowerCase().includes(search)
        );

      return matchesCategory && matchesSearch;
    });
  });

  /* =====================================
     PAGINATION
     ===================================== */

  readonly totalRecords = computed(
    () => this.filteredEntries().length
  );

  readonly totalPages = computed(() =>
    Math.max(
      1,
      Math.ceil(this.totalRecords() / this.pageSize)
    )
  );

  readonly displayedPage = computed(() =>
    Math.min(
      this.currentPage(),
      this.totalPages()
    )
  );

  readonly pagedEntries = computed(() => {

    const start =
      (this.displayedPage() - 1) * this.pageSize;

    return this.filteredEntries().slice(
      start,
      start + this.pageSize
    );
  });

  readonly firstRecord = computed(() =>
    this.totalRecords() === 0
      ? 0
      : (this.displayedPage() - 1) * this.pageSize + 1
  );

  readonly lastRecord = computed(() =>
    Math.min(
      this.displayedPage() * this.pageSize,
      this.totalRecords()
    )
  );

  /* =====================================
     CONSTRUCTOR
     ===================================== */

  constructor() {

    // Check every minute for a new week.
    this.weekTimer = setInterval(() => {

      const start =
        this.getPhtWeekStart().getTime();

      if (start === this.lastWeekStartMs) {
        return;
      }

      this.lastWeekStartMs = start;

      // Refresh the displayed weekly records.
      // No data is deleted from Firebase.
      if (this.selectedPeriod() !== 'all-history') {
        this.currentPage.set(1);
        this.refreshPeriod();
      }

    }, 60_000);

    this.stopAuth = onAuthStateChanged(
      this.auth,
      () => this.loadLogs()
    );
  }

  /* =====================================
     LOAD AUDIT LOGS
     ===================================== */

  loadLogs(): void {

    const generation = ++this.generation;

    this.stopProfile?.();
    this.stopProfile = undefined;

    this.clearLogListener();

    this.loading.set(true);
    this.errorMessage.set('');
    this.currentPage.set(1);

    const user = this.auth.currentUser;

    if (!user) {

      this.loading.set(false);

      this.errorMessage.set(
        'Please sign in with an administrator account.'
      );

      return;
    }

    let listening = false;

    // Verify administrator account.
    this.stopProfile = onSnapshot(
      doc(this.db, 'users', user.uid),

      snapshot => {

        if (generation !== this.generation) {
          return;
        }

        const profile = snapshot.data();

        if (
          profile?.['role'] !== 'admin' ||
          profile?.['accountStatus'] !== 'approved'
        ) {

          listening = false;

          this.clearLogListener();
          this.loading.set(false);

          this.errorMessage.set(
            'An approved administrator account is required.'
          );

          return;
        }

        if (!listening) {

          listening = true;

          this.errorMessage.set('');
          this.loading.set(true);

          this.listenToLogs(generation);
        }
      },

      () => {

        if (generation !== this.generation) {
          return;
        }

        this.clearLogListener();
        this.loading.set(false);

        this.errorMessage.set(
          'Unable to verify your account. Check your connection and try again.'
        );
      }
    );
  }

  /* =====================================
     FIRESTORE WEEKLY QUERY
     ===================================== */

  private listenToLogs(generation: number): void {

    const logsGeneration =
      ++this.logsGeneration;

    const auditCollection =
      collection(this.db, 'audit_logs');

    const period = this.selectedPeriod();

    const thisWeekStart =
      this.getPhtWeekStart();

    // Determine selected week.
    const periodStart =
      period === 'last-week'
        ? new Date(
            thisWeekStart.getTime() - this.weekMs
          )
        : thisWeekStart;

    // End is exclusive.
    const periodEnd = new Date(
      periodStart.getTime() + this.weekMs
    );

    // This Week: fetch current week's logs.
    // Last Week: fetch previous week's logs.
    // All History: fetch all existing logs.
    const logsQuery =
      period === 'all-history'

        ? query(
            auditCollection,
            orderBy('created_at', 'desc')
          )

        : query(
            auditCollection,

            where(
              'created_at',
              '>=',
              Timestamp.fromDate(periodStart)
            ),

            where(
              'created_at',
              '<',
              Timestamp.fromDate(periodEnd)
            ),

            orderBy('created_at', 'desc')
          );

    this.stopLogs = onSnapshot(

      logsQuery,

      snapshot => {

        if (
          generation !== this.generation ||
          logsGeneration !== this.logsGeneration
        ) {
          return;
        }

        this.entries.set(
          snapshot.docs.map(record => {

            const data = record.data();

            const role =
              this.text(data['user_role']);

            return {

              id: record.id,

              userName:
                this.text(data['user_name']) ||
                this.roleLabel(role),

              userId:
                this.text(data['user_id']),

              userRole: role,

              category:
                this.text(data['category']) ||
                'Other',

              action:
                this.text(data['action']) ||
                'Not recorded',

              details:
                this.text(data['details']) ||
                'No details recorded.',

              entityId:
                this.text(data['entity_id']),

              createdAt:
                this.toDateString(
                  data['created_at']
                ),
            };
          })
        );

        this.errorMessage.set('');
        this.loading.set(false);
      },

      () => {

        if (
          generation !== this.generation ||
          logsGeneration !== this.logsGeneration
        ) {
          return;
        }

        this.entries.set([]);
        this.loading.set(false);

        this.errorMessage.set(
          'Unable to load audit logs. Check your connection and administrator read permissions, then try again.'
        );
      }
    );
  }

  /* =====================================
     DISPLAY AUDIT LOG DETAILS
     ===================================== */

  displayDetails(entry: AuditEntry): string {

    let details = entry.details;

    if (entry.category === 'Concern') {

      details = details
        .replace(/^Concern\s+#\d+\s*:\s*/, '')
        .replace(
          /^Concern\s+#\d+\s+/,
          'Concern '
        );
    }

    if (
      entry.category === 'Auth' &&
      [
        'Account suspended',
        'Account restored'
      ].includes(entry.action)
    ) {

      details = details.replace(
        /\s+Reason:[\s\S]*$/,
        ''
      );
    }

    return details;
  }

  /* =====================================
     CHANGE SELECTED WEEK
     ===================================== */

  changePeriod(period: AuditPeriod): void {

    if (period === this.selectedPeriod()) {
      return;
    }

    this.selectedPeriod.set(period);
    this.currentPage.set(1);

    this.refreshPeriod();
  }

  /* =====================================
     REFRESH WEEKLY RECORDS
     ===================================== */

  private refreshPeriod(): void {

    // Only refresh an active administrator
    // audit log listener.
    if (!this.stopLogs) {
      return;
    }

    this.clearLogListener();

    this.loading.set(true);
    this.errorMessage.set('');

    this.listenToLogs(this.generation);
  }

  /* =====================================
     PHILIPPINE WEEK CALCULATION
     ===================================== */

  private getPhtWeekStart(
    now = new Date()
  ): Date {

    // Philippine time is UTC+08:00.
    const offsetMs =
      8 * 60 * 60 * 1000;

    const pht = new Date(
      now.getTime() + offsetMs
    );

    // Monday is the first day of the week.
    const daysAfterMonday =
      (pht.getUTCDay() + 6) % 7;

    return new Date(
      Date.UTC(
        pht.getUTCFullYear(),
        pht.getUTCMonth(),
        pht.getUTCDate() - daysAfterMonday
      ) - offsetMs
    );
  }

  /* =====================================
     SEARCH
     ===================================== */

  changeSearch(value: string): void {
    this.searchTerm.set(value);
    this.currentPage.set(1);
  }

  /* =====================================
     CATEGORY FILTER
     ===================================== */

  changeCategory(value: CategoryFilter): void {
    this.selectedCategory.set(value);
    this.currentPage.set(1);
  }

  /* =====================================
     RESET SEARCH AND CATEGORY
     ===================================== */

  resetFilters(): void {
    this.searchTerm.set('');
    this.selectedCategory.set('All categories');
    this.currentPage.set(1);
  }

  /* =====================================
     PREVIOUS PAGE
     ===================================== */

  previousPage(): void {
    this.currentPage.set(
      Math.max(
        1,
        this.displayedPage() - 1
      )
    );
  }

  /* =====================================
     NEXT PAGE
     ===================================== */

  nextPage(): void {
    this.currentPage.set(
      Math.min(
        this.totalPages(),
        this.displayedPage() + 1
      )
    );
  }

  /* =====================================
     CATEGORY BADGE COLORS
     ===================================== */

  categoryClass(category: string): string {

    switch (category) {

      case 'Auth':
        return 'category-auth';

      case 'Resident':
        return 'category-resident';

      case 'Concern':
        return 'category-concern';

      default:
        return 'category-other';
    }
  }

  /* =====================================
     ROLE LABEL
     ===================================== */

  private roleLabel(role: string): string {

    switch (role) {

      case 'admin':
        return 'Administrator';

      case 'personnel':
        return 'Personnel';

      case 'resident':
        return 'Resident';

      default:
        return 'User not recorded';
    }
  }

  /* =====================================
     CONVERT DATA TO TEXT
     ===================================== */

  private text(value: unknown): string {
    return typeof value === 'string'
      ? value.trim()
      : '';
  }

  /* =====================================
     FORMAT FIRESTORE TIMESTAMP
     ===================================== */

  private toDateString(
    value: unknown
  ): string | null {

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

  /* =====================================
     REMOVE PREVIOUS FIRESTORE LISTENER
     ===================================== */

  private clearLogListener(): void {

    ++this.logsGeneration;

    this.stopLogs?.();
    this.stopLogs = undefined;

    this.entries.set([]);
  }

  /* =====================================
     CLEANUP
     ===================================== */

  ngOnDestroy(): void {

    if (this.weekTimer) {
      clearInterval(this.weekTimer);
    }

    ++this.generation;

    this.stopAuth?.();
    this.stopProfile?.();

    this.clearLogListener();
  }
}
