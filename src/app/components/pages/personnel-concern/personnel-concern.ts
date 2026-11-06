import { CommonModule } from '@angular/common';

import {
  Component,
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
  doc,
  getDoc,
  getFirestore,
} from 'firebase/firestore';

import {
  firebaseApp,
} from '../../../core/firebase.config';

import {
  Concern,
  ConcernStatus,
} from '../../../core/models/concern.model';

import {
  ConcernService,
} from '../../../core/services/concern.service';

type StatusFilter = 'All Status' | ConcernStatus;

@Component({
  selector: 'app-personnel-concerns',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './personnel-concern.html',
  styleUrl: './personnel-concern.scss',
})
export class PersonnelConcerns {
  private readonly concernService = inject(ConcernService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly routeParams = toSignal(
    this.route.queryParamMap,
    {
      initialValue: this.route.snapshot.queryParamMap,
    }
  );

  readonly concerns = this.concernService.concerns;

  readonly historyResident = computed(() =>
    this.routeParams().get('historyResident') || ''
  );

  readonly historyMode = computed(() =>
    !!this.historyResident()
  );

  private readonly historyBusy = signal(false);
  private readonly historyFailure = signal('');
  private readonly historyPhotoFailure = signal('');

  private readonly historySubmitter = signal(
    'Resident information unavailable'
  );

  private readonly historyRetry = signal(0);

  readonly loading = computed(() =>
    this.historyMode()
      ? this.historyBusy()
      : this.concernService.loading()
  );

  readonly loadError = computed(() =>
    this.historyMode()
      ? this.historyFailure()
      : this.concernService.error()
  );

  readonly photoError = computed(() =>
    this.historyMode()
      ? this.historyPhotoFailure()
      : this.concernService.photoError()
  );

  readonly residentLoadError = computed(() =>
    this.historyMode()
      ? ''
      : this.concernService.submitterError()
  );

  readonly saving = signal(false);
  readonly feedback = signal('');
  readonly searchTerm = signal('');

  readonly selectedStatus =
    signal<StatusFilter>('All Status');

  private readonly selectedConcernState =
    signal<Concern | null>(null);

  get selectedConcern(): Concern | null {
    return this.selectedConcernState();
  }

  set selectedConcern(value: Concern | null) {
    this.selectedConcernState.set(value);
  }

  statusDraft: ConcernStatus = 'Pending';
  remarks = '';

  readonly statusOptions: StatusFilter[] = [
    'All Status',
    'Pending',
    'In Progress',
    'Resolved',
    'Rejected',
  ];

  readonly availableStatuses: ConcernStatus[] = [
    'Pending',
    'In Progress',
    'Resolved',
    'Rejected',
  ];

  constructor() {
    effect(() => {
      if (this.historyMode()) return;

      const records = this.concerns();
      const requestedId = this.routeParams().get('concern');
      const loading = this.loading();
      const failed = this.loadError();
      const selected = this.selectedConcern;

      if (loading || failed) {
        this.selectedConcern = null;
        this.remarks = '';
        this.feedback.set('');
        return;
      }

      const targetId =
        requestedId || selected?.concern_id;

      if (!targetId) return;

      const current = records.find(
        item => item.concern_id === targetId
      );

      if (current) {
        if (selected?.concern_id !== current.concern_id) {
          this.viewDetails(current);
        } else {
          this.selectedConcern = current;

          void this.concernService
            .loadSubmitter(current);
        }
      } else {
        this.closeDetails();
      }
    });
  }

  private readonly followResidentHistory = effect(onCleanup => {
    const residentId = this.historyResident();
    const concernId = this.routeParams().get('concern');
    const accessUid = this.concernService.accessUid();
    const office = this.concernService.officeId();

    this.historyRetry();

    const controller = new AbortController();

    let active = true;
    let photoUrl = '';

    onCleanup(() => {
      active = false;
      controller.abort();

      if (photoUrl) {
        URL.revokeObjectURL(photoUrl);
      }
    });

    if (!residentId) return;

    this.selectedConcern = null;
    this.remarks = '';
    this.feedback.set('');

    this.historyFailure.set('');
    this.historyPhotoFailure.set('');
    this.historySubmitter.set(
      'Loading resident information...'
    );

    this.historyBusy.set(true);

    if (!accessUid) {
      if (!this.concernService.loading()) {
        this.historyBusy.set(false);
        this.historyFailure.set(
          'Resident-management access is required.'
        );
      }

      return;
    }

    if (
      office !== 'barangay-office' ||
      !concernId
    ) {
      this.historyBusy.set(false);
      this.historyFailure.set(
        'Resident-management access is required.'
      );
      return;
    }

    void (async () => {
      try {
        const records =
          await this.concernService.getResidentHistory(
            residentId,
            controller.signal
          );

        if (!active) return;

        const concern = records.find(item =>
          item.concern_id === concernId &&
          item.resident_id === residentId
        );

        if (!concern) {
          throw new Error(
            'This concern is not in the selected resident history.'
          );
        }

        this.selectedConcern = concern;
        this.historyBusy.set(false);

        // The name lookup does not block the photo request.
        void getDoc(
          doc(
            getFirestore(firebaseApp),
            'users',
            residentId
          )
        )
          .then(profile => {
            if (!active) return;

            const data = profile.data();

            const name =
              typeof data?.['name'] === 'string'
                ? data['name'].trim()
                : 'Name not recorded';

            const number = String(
              data?.['residentId'] ?? ''
            );

            this.historySubmitter.set(
              /^[1-9]\d*$/.test(number)
                ? `${name} (Resident ID: ${number})`
                : name
            );
          })
          .catch(() => {
            if (active) {
              this.historySubmitter.set(
                'Resident information unavailable'
              );
            }
          });

        if (concern.photo_path) {
          try {
            const blob =
              await this.concernService
                .downloadResidentHistoryPhoto(
                  residentId,
                  concernId,
                  AbortSignal.any([
                    controller.signal,
                    AbortSignal.timeout(15000),
                  ])
                );

            if (!active) return;

            photoUrl = URL.createObjectURL(blob);

            this.selectedConcern = {
              ...concern,
              photo_url: photoUrl,
            };
          } catch {
            if (active) {
              this.historyPhotoFailure.set(
                'Unable to load the concern photo. Check your connection and reopen the concern to retry.'
              );
            }
          }
        }
      } catch (error) {
        if (active) {
          this.selectedConcern = null;

          this.historyFailure.set(
            error instanceof Error
              ? error.message
              : 'Unable to load concern history.'
          );
        }
      } finally {
        if (active) {
          this.historyBusy.set(false);
        }
      }
    })();
  });

  readonly filteredConcerns = computed(() => {
    const search = this.searchTerm()
      .trim()
      .toLowerCase();

    const status = this.selectedStatus();

    return this.concerns()
      .filter(concern => {
        const matchesSearch = [
          String(concern.concern_number ?? ''),
          this.categoryName(concern),
          concern.location_description,
          concern.description,
          concern.office?.office_name ?? '',
        ].some(value =>
          (value ?? '').toLowerCase().includes(search)
        );

        const matchesStatus =
          status === 'All Status' ||
          concern.current_status === status;

        return matchesSearch && matchesStatus;
      })
      .sort((a, b) =>
        (a.concern_number ?? Number.MAX_SAFE_INTEGER) -
        (b.concern_number ?? Number.MAX_SAFE_INTEGER)
      );
  });

  submittedBy(concern: Concern): string {
    return this.historyMode()
      ? this.historySubmitter()
      : this.concernService.submitterLabel(concern);
  }

  retryResidents(): void {
    if (this.selectedConcern) {
      void this.concernService.loadSubmitter(
        this.selectedConcern,
        true
      );
    }
  }

  retryLoad(): void {
    if (this.historyMode()) {
      this.historyRetry.update(value => value + 1);
    } else {
      this.concernService.reload();
    }
  }

  categoryName(concern: Concern): string {
    return concern.category?.category_name ??
      `Category ${concern.category_id}`;
  }

  statusClass(status: string): string {
    switch (status) {
      case 'Pending':
        return 'status-pending';
      case 'In Progress':
        return 'status-progress';
      case 'Resolved':
        return 'status-resolved';
      case 'Rejected':
        return 'status-rejected';
      default:
        return 'status-default';
    }
  }

  viewDetails(concern: Concern): void {
    this.selectedConcern = concern;

    void this.concernService.loadSubmitter(concern);

    this.statusDraft = concern.current_status;
    this.remarks = '';
    this.feedback.set('');
  }

  closeDetails(): void {
    if (this.historyMode()) {
      void this.router.navigate(
        ['/perso-dashboard/personnel-residents'],
        {
          queryParams: {
            resident: this.historyResident(),
            tab: 'history',
          },
        }
      );

      return;
    }

    this.concernService.clearSubmitter();

    this.selectedConcern = null;
    this.remarks = '';
    this.feedback.set('');

    if (this.route.snapshot.queryParamMap.has('concern')) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          concern: null,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  async saveStatus(): Promise<void> {
    const concern = this.selectedConcern;

    if (
      !concern ||
      this.historyMode() ||
      concern.office_id !== this.concernService.officeId() ||
      this.saving()
    ) {
      return;
    }

    if (this.remarks.length > 2000) {
      this.feedback.set(
        'Use at most 2000 characters for remarks.'
      );
      return;
    }

    if (
      this.statusDraft === concern.current_status &&
      !this.remarks.trim()
    ) {
      this.feedback.set(
        'Enter a progress note or select a different status.'
      );
      return;
    }

    this.saving.set(true);
    this.feedback.set('');

    try {
      const updated =
        await this.concernService.updateStatus(
          concern.concern_id,
          this.statusDraft,
          this.remarks,
          concern.current_status
        );

      if (
        this.selectedConcern?.concern_id !==
        concern.concern_id
      ) {
        return;
      }

      if (
        !this.concerns().some(
          item => item.concern_id === updated.concern_id
        )
      ) {
        this.selectedConcern = null;
        this.remarks = '';
        return;
      }

      this.selectedConcern = updated;
      this.statusDraft = updated.current_status;
      this.remarks = '';

      this.feedback.set(
        'Concern update and history saved successfully.'
      );
    } catch (error: unknown) {
      this.feedback.set(
        error instanceof Error
          ? error.message
          : 'Unable to save the concern update.'
      );
    } finally {
      this.saving.set(false);
    }
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.selectedStatus.set('All Status');
  }

  trackConcern(
    _index: number,
    concern: Concern
  ): string {
    return concern.concern_id;
  }
}