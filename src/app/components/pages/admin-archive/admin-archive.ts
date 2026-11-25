import { CommonModule } from '@angular/common';
import Swal from 'sweetalert2';

import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import {
  ActivatedRoute,
  Router,
} from '@angular/router';

import {
  toSignal,
} from '@angular/core/rxjs-interop';

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
  type Unsubscribe,
} from 'firebase/firestore';

import { firebaseApp } from '../../../core/firebase.config';

import {
  Concern,
  ConcernStatus,
} from '../../../core/models/concern.model';

import {
  ConcernService,
} from '../../../core/services/concern.service';

import {
  ParticipatingOffice,
  ParticipatingOfficeService,
} from '../../../core/services/participating-office.service';

type StatusFilter = 'All Status' | ConcernStatus;
type ArchiveTab = 'concerns' | 'offices' | 'users';
type OfficeAvailabilityFilter =
  | 'All Availability'
  | 'Active'
  | 'Inactive';
type AccountRoleFilter =
  | 'All Roles'
  | 'Resident'
  | 'Personnel';
type AccountStatusFilter =
  | 'All Statuses'
  | 'Approved'
  | 'Suspended';

interface ArchivedAccount {
  uid: string;
  name: string;
  email: string;
  role: string;
  status: string;
  archiveChangedAt: string | null;
}

@Component({
  selector: 'app-admin-archive',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-archive.html',
  styleUrl: './admin-archive.scss',
})
export class AdminArchive implements OnDestroy {

  private readonly service = inject(ConcernService);
  readonly officeService =
    inject(ParticipatingOfficeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  private destroyed = false;
  private archiveGeneration = 0;
  private stopArchiveAuth?: Unsubscribe;
  private stopArchiveProfile?: Unsubscribe;
  private stopArchivedUsers?: Unsubscribe;

  private readonly params = toSignal(
    this.route.queryParamMap,
    {
      initialValue: this.route.snapshot.queryParamMap,
    }
  );

  // ARCHIVE MODE

  readonly archiveMode = computed(() => true);
  readonly archiveTab = signal<ArchiveTab>('concerns');
  readonly archiveDirectoryLoading = signal(true);
  readonly archiveDirectoryError = signal('');
  readonly archivedAccounts = signal<ArchivedAccount[]>([]);
  readonly officeSearchTerm = signal('');
  readonly accountSearchTerm = signal('');
  readonly officeAvailability =
    signal<OfficeAvailabilityFilter>('All Availability');
  readonly accountRole =
    signal<AccountRoleFilter>('All Roles');
  readonly accountStatus =
    signal<AccountStatusFilter>('All Statuses');
  readonly restoring = signal('');

  readonly officeAvailabilityOptions: OfficeAvailabilityFilter[] = [
    'All Availability',
    'Active',
    'Inactive',
  ];

  readonly accountRoleOptions: AccountRoleFilter[] = [
    'All Roles',
    'Resident',
    'Personnel',
  ];

  readonly accountStatusOptions: AccountStatusFilter[] = [
    'All Statuses',
    'Approved',
    'Suspended',
  ];

  readonly selectedOfficeIds = signal<Set<string>>(new Set());
  readonly selectedAccountIds = signal<Set<string>>(new Set());

  readonly archivedOffices =
    this.officeService.archivedRecords;

  readonly filteredArchivedOffices = computed(() => {
    const search =
      this.officeSearchTerm().trim().toLowerCase();

    return this.archivedOffices().filter(office => {
      const matchesAvailability =
        this.officeAvailability() === 'All Availability' ||
        (this.officeAvailability() === 'Active' &&
          office.archived_was_active) ||
        (this.officeAvailability() === 'Inactive' &&
          !office.archived_was_active);

      return matchesAvailability &&
        [office.office_name, office.description]
          .some(value =>
            value.toLowerCase().includes(search)
          );
    });
  });

  readonly filteredArchivedAccounts = computed(() => {
    const search =
      this.accountSearchTerm().trim().toLowerCase();

    return this.archivedAccounts().filter(account => {
      const matchesRole =
        this.accountRole() === 'All Roles' ||
        account.role.toLowerCase() ===
          this.accountRole().toLowerCase();

      const matchesStatus =
        this.accountStatus() === 'All Statuses' ||
        account.status.toLowerCase() ===
          this.accountStatus().toLowerCase();

      return matchesRole && matchesStatus &&
        [account.name, account.email, account.role]
          .some(value =>
            value.toLowerCase().includes(search)
          );
    });
  });

  readonly selectedArchivedOffices = computed(() =>
    this.filteredArchivedOffices().filter(office =>
      this.selectedOfficeIds().has(office.office_id)
    )
  );

  readonly selectedArchivedOfficeCount = computed(() =>
    this.selectedArchivedOffices().length
  );

  readonly allArchivedOfficesSelected = computed(() =>
    this.filteredArchivedOffices().length > 0 &&
    this.selectedArchivedOfficeCount() ===
      this.filteredArchivedOffices().length
  );

  readonly partiallyArchivedOfficesSelected = computed(() =>
    this.selectedArchivedOfficeCount() > 0 &&
    !this.allArchivedOfficesSelected()
  );

  readonly selectedArchivedAccounts = computed(() =>
    this.filteredArchivedAccounts().filter(account =>
      this.selectedAccountIds().has(account.uid)
    )
  );

  readonly selectedArchivedAccountCount = computed(() =>
    this.selectedArchivedAccounts().length
  );

  readonly allArchivedAccountsSelected = computed(() =>
    this.filteredArchivedAccounts().length > 0 &&
    this.selectedArchivedAccountCount() ===
      this.filteredArchivedAccounts().length
  );

  readonly partiallyArchivedAccountsSelected = computed(() =>
    this.selectedArchivedAccountCount() > 0 &&
    !this.allArchivedAccountsSelected()
  );

  readonly archiving = signal('');
  readonly archiveFeedback = signal('');
  readonly archiveError = signal('');

  readonly concerns = this.service.concerns;

  // LOADING AND ERRORS

  readonly loading = computed(
    () =>
      this.service.loading() ||
      this.service.adminResidentLoading()
  );

  readonly loadError = computed(
    () =>
      this.service.error() ||
      this.service.adminResidentError()
  );

  // PHOTO

  readonly photoUrl = this.service.photoUrl;
  readonly photoLoading = this.service.photoLoading;
  readonly photoError = this.service.photoError;

  // SEARCH AND STATUS FILTER

  readonly searchTerm = signal('');

  readonly selectedStatus =
    signal<StatusFilter>('All Status');

  readonly statusOptions: StatusFilter[] = [
    'All Status',
    'Pending',
    'In Progress',
    'Resolved',
    'Rejected',
  ];

  // SELECTED CONCERN DETAILS

  readonly requestedId = computed(
    () => this.params().get('concern') || ''
  );

  readonly selectedConcern = computed(
    () =>
      this.concerns().find(
        item =>
          item.concern_id === this.requestedId() &&
          item.is_archived === true
      ) ?? null
  );

  // ========================================
  // FILTER ARCHIVED CONCERNS
  // ========================================

  readonly filteredConcerns = computed(() => {

    const search =
      this.searchTerm().trim().toLowerCase();

    return this.concerns()
      .filter(concern => {

        const matchesStatus =
          this.selectedStatus() === 'All Status' ||
          concern.current_status === this.selectedStatus();

        const matchesSearch = [
          String(concern.concern_number ?? ''),
          this.categoryName(concern),
          this.submittedBy(concern),
          concern.location_description,
          concern.description,
          concern.office?.office_name || '',
        ].some(value =>
          (value ?? '').toLowerCase().includes(search)
        );

        return (
          concern.is_archived === true &&
          matchesStatus &&
          matchesSearch
        );

      })

      // Most recently archived concerns first.

      .sort((a, b) =>
        (b.archive_changed_at ?? '').localeCompare(
          a.archive_changed_at ?? ''
        ) ||

        b.reported_at.localeCompare(
          a.reported_at
        ) ||

        (b.concern_number ?? 0) -
        (a.concern_number ?? 0) ||

        a.concern_id.localeCompare(
          b.concern_id
        )
      );
  });

  // ========================================
  // BULK SELECTION
  // ========================================

  private readonly selectionOwner = signal('');

  readonly selectedConcernIds =
    signal<Set<string>>(new Set());

  // Concerns available for restoration.

  readonly selectableConcerns = computed(() =>
    this.filteredConcerns().filter(
      concern => this.canArchive(concern)
    )
  );

  // Selected concerns.

  readonly selectedConcerns = computed(() => {

    if (
      !this.selectionOwner() ||
      this.selectionOwner() !==
        this.service.accessUid()
    ) {
      return [];
    }

    return this.selectableConcerns().filter(
      concern =>
        this.selectedConcernIds().has(
          concern.concern_id
        )
    );

  });

  // Number of selected concerns.

  readonly selectedCount = computed(
    () => this.selectedConcerns().length
  );

  // Check if all concerns are selected.

  readonly allSelected = computed(() =>
    this.selectableConcerns().length > 0 &&
    this.selectedCount() ===
      this.selectableConcerns().length
  );

  // Check if some concerns are selected.

  readonly partiallySelected = computed(() =>
    this.selectedCount() > 0 &&
    !this.allSelected()
  );

  // ========================================
  // CONSTRUCTOR
  // ========================================

  constructor() {

    this.stopArchiveAuth = onAuthStateChanged(
      this.auth,
      () => this.loadArchivedAccounts()
    );

    effect(() => {

      void this.service.selectPhoto(
        this.selectedConcern()
      );

    });

    // Clear selection when account access changes.

    effect(() => {

      this.service.accessUid();

      this.selectedConcernIds.set(
        new Set<string>()
      );

      this.selectionOwner.set('');

    });

  }

  setArchiveTab(tab: ArchiveTab): void {
    if (this.restoring()) return;

    this.archiveTab.set(tab);
    this.clearSelection();
    this.clearOfficeSelection();
    this.clearAccountSelection();

    if (this.requestedId()) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { concern: null },
        queryParamsHandling: 'merge',
      });
    }
  }

  isRestoring(key: string): boolean {
    return this.restoring() === key;
  }

  isArchivedOfficeSelected(officeId: string): boolean {
    return this.selectedOfficeIds().has(officeId);
  }

  toggleArchivedOfficeSelection(
    office: ParticipatingOffice,
    event: Event
  ): void {
    if (this.restoring()) return;

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectedOfficeIds.update(ids => {
      const next = new Set(ids);

      if (checked) {
        next.add(office.office_id);
      } else {
        next.delete(office.office_id);
      }

      return next;
    });
  }

  toggleAllArchivedOffices(event: Event): void {
    if (this.restoring()) return;

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectedOfficeIds.set(
      checked
        ? new Set(
            this.filteredArchivedOffices().map(
              office => office.office_id
            )
          )
        : new Set()
    );
  }

  clearOfficeSelection(): void {
    if (!this.restoring()) {
      this.selectedOfficeIds.set(new Set());
    }
  }

  isArchivedAccountSelected(uid: string): boolean {
    return this.selectedAccountIds().has(uid);
  }

  toggleArchivedAccountSelection(
    account: ArchivedAccount,
    event: Event
  ): void {
    if (this.restoring()) return;

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectedAccountIds.update(ids => {
      const next = new Set(ids);

      if (checked) {
        next.add(account.uid);
      } else {
        next.delete(account.uid);
      }

      return next;
    });
  }

  toggleAllArchivedAccounts(event: Event): void {
    if (this.restoring()) return;

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectedAccountIds.set(
      checked
        ? new Set(
            this.filteredArchivedAccounts().map(
              account => account.uid
            )
          )
        : new Set()
    );
  }

  clearAccountSelection(): void {
    if (!this.restoring()) {
      this.selectedAccountIds.set(new Set());
    }
  }

  setOfficeSearch(value: string): void {
    if (!this.restoring()) {
      this.clearOfficeSelection();
      this.officeSearchTerm.set(value);
    }
  }

  setOfficeAvailability(
    value: OfficeAvailabilityFilter
  ): void {
    if (!this.restoring()) {
      this.clearOfficeSelection();
      this.officeAvailability.set(value);
    }
  }

  setAccountSearch(value: string): void {
    if (!this.restoring()) {
      this.clearAccountSelection();
      this.accountSearchTerm.set(value);
    }
  }

  setAccountRole(value: AccountRoleFilter): void {
    if (!this.restoring()) {
      this.clearAccountSelection();
      this.accountRole.set(value);
    }
  }

  setAccountStatus(value: AccountStatusFilter): void {
    if (!this.restoring()) {
      this.clearAccountSelection();
      this.accountStatus.set(value);
    }
  }

  async restoreArchivedOffice(
    office: ParticipatingOffice
  ): Promise<void> {
    if (this.restoring() || !office.is_archived) return;

    const decision = await Swal.fire({
      title: 'Restore Participating Office',
      text: `Restore ${office.office_name}? Its previous availability setting will be applied.`,
      icon: 'warning',
      iconColor: '#16814c',
      showCancelButton: true,
      reverseButtons: true,
      confirmButtonText: 'Yes, restore',
      cancelButtonText: 'Cancel',
      buttonsStyling: false,
      focusCancel: true,
      width: 460,
      padding: '28px 24px 24px',
      background: '#ffffff',
      color: '#21372a',
      backdrop: 'rgba(16, 34, 24, 0.45)',
      customClass: {
        popup: 'rbccms-confirm-popup',
        icon: 'rbccms-confirm-icon',
        title: 'rbccms-confirm-title',
        htmlContainer: 'rbccms-confirm-message',
        actions: 'rbccms-confirm-actions',
        confirmButton: 'rbccms-confirm-primary',
        cancelButton: 'rbccms-confirm-cancel',
      },
    });

    if (!decision.isConfirmed || this.destroyed) return;

    const key = `office:${office.office_id}`;
    this.restoring.set(key);
    this.archiveFeedback.set('');
    this.archiveError.set('');

    try {
      await this.officeService.restoreOffice(
        office.office_id,
        crypto.randomUUID()
      );

      if (!this.destroyed) {
        this.archiveFeedback.set(
          'The office has been restored successfully and recorded in Audit Logs.'
        );
      }
    } catch (error: unknown) {
      if (!this.destroyed) {
        this.archiveError.set(this.errorMessage(error));
      }
    } finally {
      if (!this.destroyed) {
        this.restoring.set('');
      }
    }
  }

  async restoreSelectedOffices(): Promise<void> {
    if (this.restoring()) return;

    const selected = this.selectedArchivedOffices();
    if (!selected.length) return;

    const decision = await Swal.fire({
      title:
        selected.length === 1
          ? 'Restore Participating Office'
          : 'Restore Selected Offices',
      text:
        selected.length === 1
          ? `Restore ${selected[0].office_name}? Its previous availability setting will be applied.`
          : `Restore ${selected.length} selected offices? Their previous availability settings will be applied.`,
      icon: 'warning',
      iconColor: '#16814c',
      showCancelButton: true,
      reverseButtons: true,
      confirmButtonText: 'Yes, restore',
      cancelButtonText: 'Cancel',
      buttonsStyling: false,
      focusCancel: true,
      width: 460,
      padding: '28px 24px 24px',
      background: '#ffffff',
      color: '#21372a',
      backdrop: 'rgba(16, 34, 24, 0.45)',
      customClass: {
        popup: 'rbccms-confirm-popup',
        icon: 'rbccms-confirm-icon',
        title: 'rbccms-confirm-title',
        htmlContainer: 'rbccms-confirm-message',
        actions: 'rbccms-confirm-actions',
        confirmButton: 'rbccms-confirm-primary',
        cancelButton: 'rbccms-confirm-cancel',
      },
    });

    if (!decision.isConfirmed || this.destroyed) return;

    this.restoring.set('bulk-offices');
    this.archiveFeedback.set('');
    this.archiveError.set('');

    const restored = new Set<string>();
    let firstError = '';

    try {
      for (const office of selected) {
        try {
          await this.officeService.restoreOffice(
            office.office_id,
            crypto.randomUUID()
          );
          restored.add(office.office_id);
        } catch (error: unknown) {
          firstError ||= this.errorMessage(error);
        }
      }

      if (restored.size) {
        this.archiveFeedback.set(
          restored.size === 1
            ? 'The office has been restored successfully and recorded in Audit Logs.'
            : `${restored.size} offices have been restored successfully and recorded in Audit Logs.`
        );
      }

      if (restored.size !== selected.length) {
        this.archiveError.set(
          `${selected.length - restored.size} office(s) were not restored. ${firstError}`
        );
      }
    } finally {
      this.selectedOfficeIds.update(ids =>
        new Set([...ids].filter(id => !restored.has(id)))
      );

      if (!this.destroyed) {
        this.restoring.set('');
      }
    }
  }

  async restoreArchivedAccount(
    account: ArchivedAccount
  ): Promise<void> {
    if (this.restoring()) return;

    const decision = await Swal.fire({
      title: 'Restore Archived Account',
      text: `Restore ${account.name}'s account? Its status before archiving will be restored.`,
      icon: 'warning',
      iconColor: '#16814c',
      input: 'textarea',
      inputLabel: 'Reason for restoration',
      inputPlaceholder: 'Enter a reason (3–500 characters)',
      inputAttributes: { maxlength: '500' },
      inputValidator: value => {
        const length = (value || '').trim().length;

        return length < 3 || length > 500
          ? 'Please enter a reason containing 3–500 characters.'
          : undefined;
      },
      showCancelButton: true,
      reverseButtons: true,
      confirmButtonText: 'Yes, restore',
      cancelButtonText: 'Cancel',
      buttonsStyling: false,
      focusCancel: true,
      width: 460,
      padding: '28px 24px 24px',
      background: '#ffffff',
      color: '#21372a',
      backdrop: 'rgba(16, 34, 24, 0.45)',
      customClass: {
        popup: 'rbccms-confirm-popup',
        icon: 'rbccms-confirm-icon',
        title: 'rbccms-confirm-title',
        htmlContainer: 'rbccms-confirm-message',
        actions: 'rbccms-confirm-actions',
        confirmButton: 'rbccms-confirm-primary',
        cancelButton: 'rbccms-confirm-cancel',
        input: 'rbccms-confirm-input',
        inputLabel: 'rbccms-confirm-input-label',
        validationMessage: 'rbccms-confirm-validation',
      },
    });

    if (!decision.isConfirmed || this.destroyed) return;

    const key = `user:${account.uid}`;
    this.restoring.set(key);
    this.archiveFeedback.set('');
    this.archiveError.set('');

    try {
      await this.requestAccountRestore(
        account.uid,
        String(decision.value).trim()
      );

      if (!this.destroyed) {
        this.archiveFeedback.set(
          'The account has been restored successfully and recorded in Audit Logs.'
        );
      }
    } catch (error: unknown) {
      if (!this.destroyed) {
        this.archiveError.set(this.errorMessage(error));
      }
    } finally {
      if (!this.destroyed) {
        this.restoring.set('');
      }
    }
  }

  async restoreSelectedAccounts(): Promise<void> {
    if (this.restoring()) return;

    const selected = this.selectedArchivedAccounts();
    if (!selected.length) return;

    const decision = await Swal.fire({
      title:
        selected.length === 1
          ? 'Restore Archived Account'
          : 'Restore Selected Accounts',
      text:
        selected.length === 1
          ? `Restore ${selected[0].name}'s account? Its status before archiving will be restored.`
          : `Restore ${selected.length} selected accounts? Their statuses before archiving will be restored.`,
      icon: 'warning',
      iconColor: '#16814c',
      input: 'textarea',
      inputLabel: 'Reason for restoration',
      inputPlaceholder: 'Enter one reason for all selected accounts (3–500 characters)',
      inputAttributes: { maxlength: '500' },
      inputValidator: value => {
        const length = (value || '').trim().length;
        return length < 3 || length > 500
          ? 'Please enter a reason containing 3–500 characters.'
          : undefined;
      },
      showCancelButton: true,
      reverseButtons: true,
      confirmButtonText: 'Yes, restore',
      cancelButtonText: 'Cancel',
      buttonsStyling: false,
      focusCancel: true,
      width: 460,
      padding: '28px 24px 24px',
      background: '#ffffff',
      color: '#21372a',
      backdrop: 'rgba(16, 34, 24, 0.45)',
      customClass: {
        popup: 'rbccms-confirm-popup',
        icon: 'rbccms-confirm-icon',
        title: 'rbccms-confirm-title',
        htmlContainer: 'rbccms-confirm-message',
        actions: 'rbccms-confirm-actions',
        confirmButton: 'rbccms-confirm-primary',
        cancelButton: 'rbccms-confirm-cancel',
        input: 'rbccms-confirm-input',
        inputLabel: 'rbccms-confirm-input-label',
        validationMessage: 'rbccms-confirm-validation',
      },
    });

    if (!decision.isConfirmed || this.destroyed) return;

    this.restoring.set('bulk-accounts');
    this.archiveFeedback.set('');
    this.archiveError.set('');

    const restored = new Set<string>();
    let firstError = '';

    try {
      for (const account of selected) {
        try {
          await this.requestAccountRestore(
            account.uid,
            String(decision.value).trim()
          );
          restored.add(account.uid);
        } catch (error: unknown) {
          firstError ||= this.errorMessage(error);
        }
      }

      if (restored.size) {
        this.archiveFeedback.set(
          restored.size === 1
            ? 'The account has been restored successfully and recorded in Audit Logs.'
            : `${restored.size} accounts have been restored successfully and recorded in Audit Logs.`
        );
      }

      if (restored.size !== selected.length) {
        this.archiveError.set(
          `${selected.length - restored.size} account(s) were not restored. ${firstError}`
        );
      }
    } finally {
      this.selectedAccountIds.update(ids =>
        new Set([...ids].filter(id => !restored.has(id)))
      );

      if (!this.destroyed) {
        this.restoring.set('');
      }
    }
  }

  private loadArchivedAccounts(): void {
    const generation = ++this.archiveGeneration;

    this.stopArchiveProfile?.();
    this.stopArchiveProfile = undefined;
    this.stopArchivedUsers?.();
    this.stopArchivedUsers = undefined;

    this.archivedAccounts.set([]);
    this.archiveDirectoryError.set('');
    this.archiveDirectoryLoading.set(true);

    const user = this.auth.currentUser;

    if (!user) {
      this.archiveDirectoryLoading.set(false);
      this.archiveDirectoryError.set(
        'Please sign in with an administrator account.'
      );
      return;
    }

    this.stopArchiveProfile = onSnapshot(
      doc(this.db, 'users', user.uid),
      profile => {
        if (generation !== this.archiveGeneration) return;

        const data = profile.data();

        if (
          data?.['role'] !== 'admin' ||
          data['accountStatus'] !== 'approved'
        ) {
          this.archivedAccounts.set([]);
          this.archiveDirectoryLoading.set(false);
          this.archiveDirectoryError.set(
            'An approved administrator account is required.'
          );
          return;
        }

        if (this.stopArchivedUsers) return;

        this.stopArchivedUsers = onSnapshot(
          query(
            collection(this.db, 'users'),
            where('role', 'in', [
              'resident',
              'personnel',
              'admin',
            ])
          ),
          records => {
            if (generation !== this.archiveGeneration) return;

            this.archivedAccounts.set(
              records.docs
                .map(record => {
                  const entry = record.data();
                  const text = (key: string): string =>
                    typeof entry[key] === 'string'
                      ? entry[key].trim()
                      : '';

                  return {
                    uid: record.id,
                    name: text('name') || 'Name not recorded',
                    email: text('email'),
                    role: text('role'),
                    status:
                      text('status_before_archive') ||
                      text('accountStatus'),
                    archiveChangedAt:
                      entry['archive_changed_at'] instanceof Timestamp
                        ? entry['archive_changed_at']
                            .toDate()
                            .toISOString()
                        : null,
                    archived:
                      entry['is_archived'] === true,
                  };
                })
                .filter(account => account.archived)
                .map(({ archived: _archived, ...account }) => account)
                .sort((a, b) =>
                  a.name.localeCompare(b.name) ||
                  a.uid.localeCompare(b.uid)
                )
            );

            this.archiveDirectoryLoading.set(false);
            this.archiveDirectoryError.set('');
          },
          () => {
            if (generation !== this.archiveGeneration) return;

            this.archivedAccounts.set([]);
            this.archiveDirectoryLoading.set(false);
            this.archiveDirectoryError.set(
              'Unable to load archived accounts. Check your connection and Firestore rules.'
            );
          }
        );
      },
      () => {
        if (generation !== this.archiveGeneration) return;

        this.archivedAccounts.set([]);
        this.archiveDirectoryLoading.set(false);
        this.archiveDirectoryError.set(
          'Unable to verify administrator access.'
        );
      }
    );
  }

  private async requestAccountRestore(
    uid: string,
    reason: string
  ): Promise<void> {
    const user = this.auth.currentUser;

    if (!user) {
      throw new Error('Please sign in again.');
    }

    const token = await user.getIdToken();

    const response = await fetch(
      'https://nlwjwvhjojnjrmlaykym.supabase.co/functions/v1/manage-users',
      {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uid,
          action: 'restore-archive',
          reason,
          requestId: crypto.randomUUID(),
        }),
        signal: AbortSignal.timeout(30000),
      }
    ).catch(() => {
      throw new Error(
        'Unable to contact the account-management service. Check your connection and try again.'
      );
    });

    const body = await response.json().catch(() => null);

    if (!response.ok || body?.saved !== true) {
      throw new Error(
        typeof body?.error === 'string'
          ? body.error
          : 'The account restoration was not confirmed. Refresh before retrying.'
      );
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'Unable to complete the operation.';
  }

  // ========================================
  // RELOAD
  // ========================================

  retryLoad(): void {

    if (this.archiving()) return;

    this.clearSelection();

    this.service.reload();

  }

  // ========================================
  // PHOTO FUNCTIONS
  // ========================================

  retryPhoto(): void {

    void this.service.selectPhoto(
      this.selectedConcern(),
      true
    );

  }

  imageFailed(): void {

    this.service.imageFailed();

  }

  // ========================================
  // CONCERN INFORMATION
  // ========================================

  submittedBy(concern: Concern): string {

    return this.service.submittedBy(concern);

  }

  categoryName(concern: Concern): string {

    return (
      concern.category?.category_name ||
      `Category ${concern.category_id}`
    );

  }

  // ========================================
  // STATUS DESIGN
  // ========================================

  statusClass(status: string): string {

    const classes: Record<string, string> = {
      Pending: 'status-pending',
      'In Progress': 'status-progress',
      Resolved: 'status-resolved',
      Rejected: 'status-rejected',
    };

    return classes[status] || 'status-default';

  }

  // ========================================
  // VIEW CONCERN DETAILS
  // ========================================

  viewDetails(concern: Concern): void {

    if (this.archiving()) return;

    this.clearSelection();

    void this.router.navigate([], {

      relativeTo: this.route,

      queryParams: {
        concern: concern.concern_id,
      },

      queryParamsHandling: 'merge',

    });

  }

  // ========================================
  // BACK TO ARCHIVE
  // ========================================

  closeDetails(): void {

    if (this.archiving()) return;

    this.clearSelection();

    void this.router.navigate([], {

      relativeTo: this.route,

      queryParams: {
        concern: null,
      },

      queryParamsHandling: 'merge',

    });

  }

  // ========================================
  // CHECK IF CONCERN CAN BE RESTORED
  // ========================================

  canArchive(concern: Concern): boolean {

    return (
      concern.is_archived === true &&
      [
        'Pending',
        'In Progress',
        'Resolved',
        'Rejected',
      ].includes(concern.current_status)
    );

  }

  // ========================================
  // CHECK IF CONCERN IS SELECTED
  // ========================================

  isConcernSelected(id: string): boolean {

    return (
      !!this.selectionOwner() &&

      this.selectionOwner() ===
        this.service.accessUid() &&

      this.selectedConcernIds().has(id)
    );

  }

  // ========================================
  // SELECT SPECIFIC CONCERN
  // ========================================

  toggleConcernSelection(
    concern: Concern,
    event: Event
  ): void {

    if (
      this.archiving() ||
      !this.canArchive(concern)
    ) {
      return;
    }

    const actor = this.service.accessUid();

    if (!actor) return;

    if (this.selectionOwner() !== actor) {

      this.selectedConcernIds.set(
        new Set<string>()
      );

      this.selectionOwner.set(actor);

    }

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectedConcernIds.update(ids => {

      const next = new Set(ids);

      if (checked) {

        next.add(concern.concern_id);

      } else {

        next.delete(concern.concern_id);

      }

      return next;

    });

  }

  // ========================================
  // SELECT ALL ARCHIVED CONCERNS
  // ========================================

  toggleSelectAll(event: Event): void {

    if (this.archiving()) return;

    const actor = this.service.accessUid();

    if (!actor) return;

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectionOwner.set(actor);

    this.selectedConcernIds.set(

      checked

        ? new Set(
            this.selectableConcerns().map(
              concern => concern.concern_id
            )
          )

        : new Set<string>()

    );

  }

  // ========================================
  // CLEAR SELECTION
  // ========================================

  clearSelection(): void {

    if (this.archiving()) return;

    this.selectedConcernIds.set(
      new Set<string>()
    );

    this.selectionOwner.set('');

  }

  // ========================================
  // SEARCH FILTER
  // ========================================

  setSearchTerm(value: string): void {

    if (this.archiving()) return;

    this.clearSelection();

    this.searchTerm.set(value);

  }

  // ========================================
  // STATUS FILTER
  // ========================================

  setStatusFilter(value: StatusFilter): void {

    if (this.archiving()) return;

    this.clearSelection();

    this.selectedStatus.set(value);

  }

  // ========================================
  // RESTORE CONFIRMATION
  // ========================================

  private confirmRestore(count: number) {

    return Swal.fire({

      title:
        count === 1
          ? 'Restore Concern'
          : 'Restore Selected Concerns',

      text:
        count === 1
          ? 'Are you sure you want to restore this concern? It will return to Community Concerns.'
          : `Are you sure you want to restore ${count} selected concerns? They will return to Community Concerns.`,

      icon: 'warning',
      iconColor: '#16814c',

      showCancelButton: true,
      reverseButtons: true,

      confirmButtonText: 'Yes, restore',
      cancelButtonText: 'Cancel',

      buttonsStyling: false,
      focusCancel: true,
      showCloseButton: false,

      width: 440,
      padding: '28px 24px 24px',

      background: '#ffffff',
      color: '#21372a',

      backdrop: 'rgba(16, 34, 24, 0.45)',

      customClass: {

        popup: 'rbccms-confirm-popup',

        icon: 'rbccms-confirm-icon',

        title: 'rbccms-confirm-title',

        htmlContainer: 'rbccms-confirm-message',

        actions: 'rbccms-confirm-actions',

        confirmButton: 'rbccms-confirm-primary',

        cancelButton: 'rbccms-confirm-cancel',

      },

    });

  }

  // ========================================
  // RESTORE SELECTED CONCERNS
  // ========================================

  async restoreSelected(): Promise<void> {

    if (this.archiving()) return;

    const selected = this.selectedConcerns();

    if (!selected.length) return;

    const actor = this.service.accessUid();

    if (!actor) {

      this.archiveError.set(
        'Please sign in again.'
      );

      return;

    }

    this.archiving.set('bulk');

    this.archiveFeedback.set('');
    this.archiveError.set('');

    const successful = new Set<string>();

    let firstError = '';

    try {

      const result =
        await this.confirmRestore(
          selected.length
        );

      if (
        !result.isConfirmed ||
        this.destroyed
      ) {
        return;
      }

      // Restore selected concerns individually.
      // Preserve existing Firestore transactions
      // and audit logging.

      for (const concern of selected) {

        if (
          this.destroyed ||

          this.service.accessUid() !== actor
        ) {

          firstError =
            'The page or account access changed.';

          break;

        }

        try {

          await this.service.setArchived(

            concern.concern_id,

            false,

            concern.archive_revision ?? 0

          );

          successful.add(
            concern.concern_id
          );

        } catch (error: unknown) {

          firstError ||=

            error instanceof Error

              ? error.message

              : 'A restore request failed.';

        }

      }

      // SUCCESS MESSAGE

      if (successful.size > 0) {

        this.archiveFeedback.set(

          successful.size === 1

            ? 'The concern has been restored successfully.'

            : `${successful.size} concerns have been restored successfully.`

        );

      }

      // FAILED RESTORATIONS

      const remaining =
        selected.length - successful.size;

      if (remaining > 0) {

        this.archiveError.set(

          `${remaining} concern(s) were not restored. ` +

          `${firstError} ` +

          'Please review the latest records and try again.'

        );

      }

    } catch (error: unknown) {

      this.archiveError.set(

        error instanceof Error

          ? error.message

          : 'Unable to restore selected concerns.'

      );

    } finally {

      // Remove successfully restored concerns
      // from the current selection.

      this.selectedConcernIds.update(ids =>

        new Set(

          [...ids].filter(
            id => !successful.has(id)
          )

        )

      );

      this.archiving.set('');

    }

  }

  // ========================================
  // CLEAR FILTERS
  // ========================================

  clearFilters(): void {

    if (this.archiving()) return;

    this.clearSelection();

    this.searchTerm.set('');

    this.selectedStatus.set('All Status');

  }

  // ========================================
  // CLEANUP
  // ========================================

  ngOnDestroy(): void {

    this.destroyed = true;

    ++this.archiveGeneration;
    this.stopArchiveAuth?.();
    this.stopArchiveProfile?.();
    this.stopArchivedUsers?.();

    void this.service.selectPhoto(null);

  }

}
