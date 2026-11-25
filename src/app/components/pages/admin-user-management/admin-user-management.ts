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
  query,
  where,
} from 'firebase/firestore';

import Swal from 'sweetalert2';

import { firebaseApp } from '../../../core/firebase.config';

interface AccountRecord {
  uid: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string | null;
  residentId: string;
  address: string;
  contactNumber: string;
  verified: boolean;
  incomplete: boolean;
  isArchived: boolean;
  archiveChangedAt: string | null;
  archiveRevision: number;
}

@Component({
  selector: 'app-admin-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-user-management.html',
  styleUrl: './admin-user-management.scss',
})
export class AdminUserManagement implements OnDestroy {
  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  private stopAuth?: () => void;
  private stopAdmin?: () => void;
  private stopAccounts?: () => void;

  private generation = 0;
  private listGeneration = 0;
  private destroyed = false;

  private readonly records = signal<AccountRecord[]>([]);
  private readonly authorized = signal(false);

  readonly currentUid = signal('');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly feedback = signal('');
  readonly savingUid = signal('');
  readonly archiveError = signal('');
  readonly archiving = signal(false);

  readonly searchTerm = signal('');
  readonly selectedRole = signal('All Roles');
  readonly selectedStatus = signal('All Status');
  readonly selectedUid = signal('');
  readonly selectedAccountUids = signal<Set<string>>(new Set());

  readonly page = signal(1);
  readonly pageSize = 10;

  readonly roleOptions = [
    'All Roles',
    'resident',
    'personnel',
    'admin',
  ];

  readonly statusOptions = [
    'All Status',
    'approved',
    'suspended',
    'pending',
    'rejected',
  ];

  readonly selectedAccount = computed(
    () =>
      this.records().find(
        account => account.uid === this.selectedUid()
      ) ?? null
  );

  readonly filteredAccounts = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();

    return this.records().filter(
      account =>
        (
          this.selectedRole() === 'All Roles' ||
          account.role === this.selectedRole()
        ) &&
        (
          this.selectedStatus() === 'All Status' ||
          account.status === this.selectedStatus()
        ) &&
        [account.name, account.email].some(
          value => value.toLowerCase().includes(search)
        )
    );
  });

  readonly totalPages = computed(() =>
    Math.max(
      1,
      Math.ceil(
        this.filteredAccounts().length / this.pageSize
      )
    )
  );

  readonly displayedPage = computed(() =>
    Math.min(this.page(), this.totalPages())
  );

  readonly visibleAccounts = computed(() => {
    const start =
      (this.displayedPage() - 1) * this.pageSize;

    return this.filteredAccounts().slice(
      start,
      start + this.pageSize
    );
  });

  readonly archiveableAccounts = computed(() =>
    this.filteredAccounts().filter(
      account => this.canArchive(account)
    )
  );

  readonly selectedAccounts = computed(() => {
    const ids = this.selectedAccountUids();

    return this.archiveableAccounts().filter(
      account => ids.has(account.uid)
    );
  });

  readonly selectedAccountCount = computed(
    () => this.selectedAccounts().length
  );

  readonly allAccountsSelected = computed(() =>
    this.archiveableAccounts().length > 0 &&
    this.selectedAccountCount() ===
      this.archiveableAccounts().length
  );

  readonly partiallySelectedAccounts = computed(() =>
    this.selectedAccountCount() > 0 &&
    !this.allAccountsSelected()
  );

  constructor() {
    this.stopAuth = onAuthStateChanged(
      this.auth,
      () => this.reload()
    );
  }

  reload(): void {
    const generation = ++this.generation;

    this.stopAdmin?.();
    this.clearAccounts();

    this.authorized.set(false);
    this.error.set('');
    this.feedback.set('');
    this.archiveError.set('');
    this.loading.set(true);
    this.selectedUid.set('');
    this.selectedAccountUids.set(new Set());
    this.page.set(1);

    const user = this.auth.currentUser;
    this.currentUid.set(user?.uid || '');

    if (!user) {
      this.loading.set(false);
      this.error.set(
        'Please sign in with an administrator account.'
      );
      return;
    }

    this.stopAdmin = onSnapshot(
      doc(this.db, 'users', user.uid),

      snapshot => {
        if (generation !== this.generation) return;

        const data = snapshot.data();

        if (
          data?.['role'] !== 'admin' ||
          data['accountStatus'] !== 'approved'
        ) {
          this.authorized.set(false);
          this.clearAccounts();
          this.loading.set(false);
          this.error.set(
            'An approved administrator account is required.'
          );
          return;
        }

        this.authorized.set(true);

        if (this.stopAccounts) return;

        const listGeneration = ++this.listGeneration;

        this.stopAccounts = onSnapshot(
          query(
            collection(this.db, 'users'),
            where(
              'role',
              'in',
              ['resident', 'personnel', 'admin']
            )
          ),

          records => {
            if (
              generation !== this.generation ||
              listGeneration !== this.listGeneration
            ) {
              return;
            }

            this.records.set(
              records.docs
                .map(record => {
                  const data = record.data();

                  const text = (key: string): string =>
                    typeof data[key] === 'string'
                      ? data[key].trim()
                      : '';

                  return {
                    uid: record.id,
                    name: text('name') || 'Name not recorded',
                    email: text('email'),
                    role: text('role'),
                    status: text('accountStatus'),
                    residentId: text('residentId'),
                    address: text('address'),
                    contactNumber: text('contactNumber'),
                    verified:
                      data['residencyVerified'] === true,
                    incomplete:
                      data['registrationState'] === 'incomplete',

                    isArchived:
                      data['is_archived'] === true,

                    archiveChangedAt:
                      data['archive_changed_at'] instanceof Timestamp
                        ? data['archive_changed_at']
                            .toDate()
                            .toISOString()
                        : null,

                    archiveRevision:
                      Number.isSafeInteger(
                        data['archive_revision']
                      )
                        ? data['archive_revision']
                        : 0,

                    createdAt:
                      data['createdAt'] instanceof Timestamp
                        ? data['createdAt'].toDate().toISOString()
                        : null,
                  };
                })
                .filter(
                  account => !account.isArchived
                )
                .sort(
                  (a, b) =>
                    a.name.localeCompare(b.name) ||
                    a.uid.localeCompare(b.uid)
                )
            );

            this.loading.set(false);
            this.error.set('');
          },

          () => {
            if (
              generation !== this.generation ||
              listGeneration !== this.listGeneration
            ) {
              return;
            }

            this.records.set([]);
            this.loading.set(false);
            this.error.set(
              'Unable to load accounts. Check your connection and Firestore rules.'
            );
          }
        );
      },

      () => {
        if (generation !== this.generation) return;

        this.authorized.set(false);
        this.clearAccounts();
        this.loading.set(false);
        this.error.set(
          'Unable to verify administrator access. Please try again.'
        );
      }
    );
  }

  roleLabel(role: string): string {
    const labels: Record<string, string> = {
      resident: 'Resident',
      personnel: 'Personnel',
      admin: 'Administrator',
    };

    return labels[role] || role;
  }

  canChange(account: AccountRecord): boolean {
    return (
      this.authorized() &&
      !account.isArchived &&
      account.uid !== this.currentUid() &&
      ['resident', 'personnel'].includes(account.role) &&
      !account.incomplete &&
      (
        account.status === 'approved' ||
        (
          account.status === 'suspended' &&
          (
            account.role !== 'resident' ||
            account.verified
          )
        )
      )
    );
  }

  canArchive(account: AccountRecord): boolean {
    return this.canChange(account);
  }

  isAccountSelected(uid: string): boolean {
    return this.selectedAccountUids().has(uid);
  }

  toggleAccountSelection(
    account: AccountRecord,
    event: Event
  ): void {
    if (this.savingUid() || !this.canArchive(account)) {
      return;
    }

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectedAccountUids.update(ids => {
      const next = new Set(ids);

      if (checked) {
        next.add(account.uid);
      } else {
        next.delete(account.uid);
      }

      return next;
    });
  }

  toggleAllAccounts(event: Event): void {
    if (this.savingUid()) return;

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectedAccountUids.set(
      checked
        ? new Set(
            this.archiveableAccounts().map(
              account => account.uid
            )
          )
        : new Set()
    );
  }

  clearAccountSelection(): void {
    if (!this.savingUid()) {
      this.selectedAccountUids.set(new Set());
    }
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.selectedRole.set('All Roles');
    this.selectedStatus.set('All Status');
    this.page.set(1);
    this.clearAccountSelection();
  }

  async archiveAccount(
    account: AccountRecord
  ): Promise<void> {
    await this.archiveAccounts([account]);
  }

  async archiveSelectedAccounts(): Promise<void> {
    await this.archiveAccounts(this.selectedAccounts());
  }

  private async archiveAccounts(
    selected: AccountRecord[]
  ): Promise<void> {
    if (this.savingUid() || !selected.length) return;

    const accounts = selected.filter(
      account => this.canArchive(account)
    );

    if (!accounts.length) return;

    const decision = await Swal.fire({
      title:
        accounts.length === 1
          ? 'Archive Account'
          : 'Archive Selected Accounts',
      text:
        accounts.length === 1
          ? `Archive ${accounts[0].name}'s account? The account will not be able to access RBCCMS until restored.`
          : `Archive ${accounts.length} selected accounts? They will not be able to access RBCCMS until restored.`,
      icon: 'warning',
      iconColor: '#b7791f',
      input: 'textarea',
      inputLabel: 'Reason for archiving',
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
      confirmButtonText: 'Yes, archive',
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
        confirmButton: 'rbccms-confirm-danger',
        cancelButton: 'rbccms-confirm-cancel',
        input: 'rbccms-confirm-input',
        inputLabel: 'rbccms-confirm-input-label',
        validationMessage: 'rbccms-confirm-validation',
      },
    });

    if (!decision.isConfirmed || this.destroyed) return;

    this.archiving.set(true);
    this.archiveError.set('');
    this.feedback.set('');

    const archived = new Set<string>();
    let firstError = '';

    try {
      for (const account of accounts) {
        this.savingUid.set(account.uid);

        try {
          await this.requestAccountAction(
            account.uid,
            'archive',
            String(decision.value).trim()
          );
          archived.add(account.uid);
        } catch (error: unknown) {
          firstError ||= this.errorMessage(error);
        }
      }

      if (archived.size) {
        this.feedback.set(
          archived.size === 1
            ? 'The account was archived successfully and recorded in Audit Logs.'
            : `${archived.size} accounts were archived successfully and recorded in Audit Logs.`
        );
      }

      const failed = accounts.length - archived.size;

      if (failed) {
        this.archiveError.set(
          `${failed} account(s) were not archived. ${firstError}`
        );
      }
    } finally {
      this.selectedAccountUids.update(ids =>
        new Set(
          [...ids].filter(id => !archived.has(id))
        )
      );
      this.savingUid.set('');
      this.archiving.set(false);
    }
  }

  private async requestAccountAction(
    targetUid: string,
    action: 'archive' | 'restore-archive',
    reason: string
  ): Promise<void> {
    const uid = this.currentUid();
    const generation = this.generation;
    const user = this.auth.currentUser;

    if (
      !uid ||
      !user ||
      user.uid !== uid ||
      !this.authorized()
    ) {
      throw new Error('Please sign in with an administrator account.');
    }

    const token = await user.getIdToken();

    if (
      this.destroyed ||
      generation !== this.generation ||
      this.auth.currentUser?.uid !== uid
    ) {
      throw new Error('Your login changed. Refresh before continuing.');
    }

    let response: Response;

    try {
      response = await fetch(
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
            uid: targetUid,
            action,
            reason,
            requestId: crypto.randomUUID(),
          }),
          signal: AbortSignal.timeout(30000),
        }
      );
    } catch {
      throw new Error(
        'Unable to contact the account-management service. Check your connection and try again.'
      );
    }

    const body = await response.json().catch(() => null);

    if (!response.ok || body?.saved !== true) {
      throw new Error(
        typeof body?.error === 'string'
          ? body.error
          : 'The account change was not confirmed. Refresh before retrying.'
      );
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'The account change was not confirmed.';
  }

  async changeAccess(account: AccountRecord): Promise<void> {
    if (this.savingUid() || !this.canChange(account)) {
      return;
    }

    const uid = this.currentUid();
    const generation = this.generation;

    const action =
      account.status === 'approved'
        ? 'suspend'
        : 'restore';

    this.savingUid.set(account.uid);
    this.feedback.set('');

    try {
      const result = await Swal.fire({
        title:
          action === 'suspend'
            ? 'Confirm Account Suspension'
            : 'Confirm Account Restoration',

        text:
          action === 'suspend'
            ? `Please confirm the suspension of ${account.name}'s account. This will prevent access to RBCCMS.`
            : `Please confirm the restoration of ${account.name}'s account. This will allow access to RBCCMS.`,

        icon: 'warning',
        iconColor: '#b7791f',

        input: 'textarea',
        inputLabel:
          action === 'suspend'
            ? 'Reason for suspension'
            : 'Reason for restoration',

        inputPlaceholder: 'Enter a reason (3–500 characters)',

        inputAttributes: {
          maxlength: '500',
        },

        inputValidator: value => {
          const length = (value || '').trim().length;

          return length < 3 || length > 500
            ? 'Please enter a reason containing 3–500 characters.'
            : undefined;
        },

        showCancelButton: true,
        reverseButtons: true,

        confirmButtonText:
          action === 'suspend'
            ? 'Yes, suspend'
            : 'Yes, restore',

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
          confirmButton:
            action === 'suspend'
              ? 'rbccms-confirm-danger'
              : 'rbccms-confirm-primary',
          cancelButton: 'rbccms-confirm-cancel',
          input: 'rbccms-confirm-input',
          inputLabel: 'rbccms-confirm-input-label',
          validationMessage: 'rbccms-confirm-validation',
        },
      });

      if (!result.isConfirmed) return;

      const user = this.auth.currentUser;

      if (
        this.destroyed ||
        generation !== this.generation ||
        user?.uid !== uid ||
        !this.authorized()
      ) {
        return;
      }

      const token = await user.getIdToken();

      if (
        this.destroyed ||
        generation !== this.generation ||
        this.auth.currentUser?.uid !== uid
      ) {
        return;
      }

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
            uid: account.uid,
            action,
            reason: String(result.value).trim(),
            requestId: crypto.randomUUID(),
          }),

          signal: AbortSignal.timeout(30000),
        }
      );

      const body = await response.json().catch(() => null);

      if (!response.ok || body?.saved !== true) {
        throw new Error(
          body?.error ||
          'Unable to confirm the change. Refresh before retrying.'
        );
      }

      if (
        !this.destroyed &&
        generation === this.generation &&
        this.auth.currentUser?.uid === uid
      ) {
        this.feedback.set(
          action === 'suspend'
            ? 'The account has been suspended successfully. The action was recorded in Audit Logs.'
            : 'The account has been restored successfully. The action was recorded in Audit Logs.'
        );
      }
    } catch (error: unknown) {
      if (
        !this.destroyed &&
        generation === this.generation &&
        this.auth.currentUser?.uid === uid
      ) {
        await Swal.fire({
          icon: 'error',
          title: 'Account Change Not Confirmed',

          text:
            error instanceof Error &&
            error.name !== 'TimeoutError'
              ? error.message
              : 'The request could not be confirmed. Refresh the list before retrying.',

          confirmButtonText: 'OK',
          buttonsStyling: false,
          width: 440,
          padding: '28px 24px 24px',
          background: '#ffffff',
          color: '#21372a',

          customClass: {
            popup: 'rbccms-confirm-popup',
            title: 'rbccms-confirm-title',
            htmlContainer: 'rbccms-confirm-message',
            actions: 'rbccms-confirm-actions',
            confirmButton: 'rbccms-confirm-primary',
          },
        });
      }
    } finally {
      if (!this.destroyed) {
        this.savingUid.set('');
      }
    }
  }

  private clearAccounts(): void {
    ++this.listGeneration;

    this.stopAccounts?.();
    this.stopAccounts = undefined;
    this.records.set([]);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    ++this.generation;

    this.stopAuth?.();
    this.stopAdmin?.();
    this.clearAccounts();
  }
}
