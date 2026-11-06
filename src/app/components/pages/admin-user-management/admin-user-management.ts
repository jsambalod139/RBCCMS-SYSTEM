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

  readonly searchTerm = signal('');
  readonly selectedRole = signal('All Roles');
  readonly selectedStatus = signal('All Status');
  readonly selectedUid = signal('');

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
    this.loading.set(true);
    this.selectedUid.set('');
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
                    createdAt:
                      data['createdAt'] instanceof Timestamp
                        ? data['createdAt'].toDate().toISOString()
                        : null,
                  };
                })
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

  resetFilters(): void {
    this.searchTerm.set('');
    this.selectedRole.set('All Roles');
    this.selectedStatus.set('All Status');
    this.page.set(1);
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