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
} from 'firebase/firestore';

import { firebaseApp } from '../../../core/firebase.config';

type AuditCategory = 'Auth' | 'Resident' | 'Concern';
type CategoryFilter = 'All categories' | AuditCategory;

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

  private readonly entries = signal<AuditEntry[]>([]);

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

  readonly filteredEntries = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
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

  constructor() {
    this.stopAuth = onAuthStateChanged(
      this.auth,
      () => this.loadLogs()
    );
  }

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
        if (generation !== this.generation) return;

        this.clearLogListener();
        this.loading.set(false);
        this.errorMessage.set(
          'Unable to verify your account. Check your connection and try again.'
        );
      }
    );
  }

  private listenToLogs(generation: number): void {
    const logsGeneration = ++this.logsGeneration;

    const logsQuery = query(
      collection(this.db, 'audit_logs'),
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
            const role = this.text(data['user_role']);

            return {
              id: record.id,

              userName:
                this.text(data['user_name']) ||
                this.roleLabel(role),

              userId: this.text(data['user_id']),
              userRole: role,

              category:
                this.text(data['category']) || 'Other',

              action:
                this.text(data['action']) || 'Not recorded',

              details:
                this.text(data['details']) ||
                'No details recorded.',

              entityId: this.text(data['entity_id']),

              createdAt: this.toDateString(
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

  displayDetails(entry: AuditEntry): string {
    if (entry.category !== 'Concern') {
      return entry.details;
    }

    return entry.details
      .replace(/^Concern\s+#\d+\s*:\s*/, '')
      .replace(/^Concern\s+#\d+\s+/, 'Concern ');
  }

  changeSearch(value: string): void {
    this.searchTerm.set(value);
    this.currentPage.set(1);
  }

  changeCategory(value: CategoryFilter): void {
    this.selectedCategory.set(value);
    this.currentPage.set(1);
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.selectedCategory.set('All categories');
    this.currentPage.set(1);
  }

  previousPage(): void {
    this.currentPage.set(
      Math.max(
        1,
        this.displayedPage() - 1
      )
    );
  }

  nextPage(): void {
    this.currentPage.set(
      Math.min(
        this.totalPages(),
        this.displayedPage() + 1
      )
    );
  }

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

  private text(value: unknown): string {
    return typeof value === 'string'
      ? value.trim()
      : '';
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

  private clearLogListener(): void {
    ++this.logsGeneration;

    this.stopLogs?.();
    this.stopLogs = undefined;

    this.entries.set([]);
  }

  ngOnDestroy(): void {
    ++this.generation;

    this.stopAuth?.();
    this.stopProfile?.();

    this.clearLogListener();
  }
}