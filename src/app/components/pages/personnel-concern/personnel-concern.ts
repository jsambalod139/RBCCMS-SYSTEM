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
  Concern,
  ConcernStatus,
} from '../../../core/models/concern.model';

import {
  ConcernService,
} from '../../../core/services/concern.service';

type StatusFilter =
  | 'All Status'
  | ConcernStatus;

@Component({
  selector: 'app-personnel-concerns',
  standalone: true,

  imports: [
    CommonModule,
    FormsModule,
  ],

  templateUrl: './personnel-concern.html',
  styleUrl: './personnel-concern.scss',
})
export class PersonnelConcerns {
  private readonly concernService =
    inject(ConcernService);

  private readonly router =
    inject(Router);

  private readonly route =
    inject(ActivatedRoute);

  private readonly routeParams = toSignal(
    this.route.queryParamMap,
    {
      initialValue:
        this.route.snapshot.queryParamMap,
    }
  );

  readonly concerns =
    this.concernService.concerns;

  readonly loading =
    this.concernService.loading;

  readonly loadError =
    this.concernService.error;

  readonly photoError =
    this.concernService.photoError;

  readonly residentLoadError =
    this.concernService.submitterError;

  readonly saving = signal(false);
  readonly feedback = signal('');
  readonly searchTerm = signal('');

  readonly selectedStatus =
    signal<StatusFilter>('All Status');

  selectedConcern: Concern | null = null;
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
      const records = this.concerns();

      const requestedId =
        this.routeParams().get('concern');

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
        item =>
          item.concern_id === targetId
      );

      if (current) {
        if (
          selected?.concern_id !==
          current.concern_id
        ) {
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

  readonly filteredConcerns = computed(() => {
    const search = this.searchTerm()
      .trim()
      .toLowerCase();

    const status =
      this.selectedStatus();

    return this.concerns()
      .filter(concern => {
        const matchesSearch = [
          String(
            concern.concern_number ?? ''
          ),
          this.categoryName(concern),
          concern.location_description,
          concern.description,
          concern.office?.office_name ?? '',
        ].some(value =>
          (value ?? '')
            .toLowerCase()
            .includes(search)
        );

        const matchesStatus =
          status === 'All Status' ||
          concern.current_status === status;

        return matchesSearch && matchesStatus;
      })
      .sort((a, b) =>
        (
          a.concern_number ??
          Number.MAX_SAFE_INTEGER
        ) -
        (
          b.concern_number ??
          Number.MAX_SAFE_INTEGER
        )
      );
  });

  submittedBy(
    concern: Concern
  ): string {
    return this.concernService
      .submitterLabel(concern);
  }

  retryResidents(): void {
    if (this.selectedConcern) {
      void this.concernService
        .loadSubmitter(
          this.selectedConcern,
          true
        );
    }
  }

  retryLoad(): void {
    this.concernService.reload();
  }

  categoryName(
    concern: Concern
  ): string {
    return (
      concern.category?.category_name ??
      `Category ${concern.category_id}`
    );
  }

  statusClass(
    status: string
  ): string {
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

  viewDetails(
    concern: Concern
  ): void {
    this.selectedConcern = concern;

    void this.concernService
      .loadSubmitter(concern);

    this.statusDraft =
      concern.current_status;

    this.remarks = '';
    this.feedback.set('');
  }

  closeDetails(): void {
    this.concernService.clearSubmitter();

    this.selectedConcern = null;
    this.remarks = '';
    this.feedback.set('');

    if (
      this.route.snapshot
        .queryParamMap
        .has('concern')
    ) {
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
    const concern =
      this.selectedConcern;

    if (
      !concern ||
      this.saving()
    ) return;

    if (
      this.remarks.length > 2000
    ) {
      this.feedback.set(
        'Use at most 2000 characters for remarks.'
      );
      return;
    }

    if (
      this.statusDraft ===
        concern.current_status &&
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
        await this.concernService
          .updateStatus(
            concern.concern_id,
            this.statusDraft,
            this.remarks,
            concern.current_status
          );

      if (
        this.selectedConcern?.concern_id !==
        concern.concern_id
      ) return;

      if (
        !this.concerns().some(
          item =>
            item.concern_id ===
            updated.concern_id
        )
      ) {
        this.selectedConcern = null;
        this.remarks = '';
        return;
      }

      this.selectedConcern = updated;

      this.statusDraft =
        updated.current_status;

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