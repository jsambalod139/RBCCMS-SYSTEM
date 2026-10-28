import { CommonModule } from '@angular/common';

import {
  Component,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import {
  Concern,
  ConcernStatus
} from '../../../core/models/concern.model';

import {
  ConcernService
} from '../../../core/services/concern.service';

import {
  ResidentService
} from '../../../core/services/resident.service';

type StatusFilter = 'All Status' | ConcernStatus;

@Component({
  selector: 'app-personnel-concerns',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './personnel-concern.html',
  styleUrl: './personnel-concern.scss'
})
export class PersonnelConcerns {
  private readonly concernService = inject(ConcernService);
  private readonly residentService = inject(ResidentService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly routeParams = toSignal(
    this.route.queryParamMap,
    {
      initialValue: this.route.snapshot.queryParamMap
    }
  );

  readonly concerns = this.concernService.concerns;
  readonly loading = this.concernService.loading;
  readonly loadError = this.concernService.error;
  readonly photoError = this.concernService.photoError;

  readonly residentLoadError = this.residentService.error;

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
    'Rejected'
  ];

  readonly availableStatuses: ConcernStatus[] = [
    'Pending',
    'In Progress',
    'Resolved',
    'Rejected'
  ];

  constructor() {
    effect(() => {
      const records = this.concerns();
      const requestedId = this.routeParams().get('concern');
      const loading = this.loading();
      const failed = this.loadError();
      const selected = this.selectedConcern;

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
        }
      } else if (!loading && !failed) {
        this.closeDetails();
      }
    });
  }

  readonly filteredConcerns = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    const status = this.selectedStatus();

    return this.concerns()
      .filter(concern => {
        const matchesSearch = [
          String(concern.concern_number ?? ''),
          this.categoryName(concern),
          concern.location_description,
          concern.description,
          concern.office?.office_name ?? ''
        ].some(value =>
          (value ?? '').toLowerCase().includes(search)
        );

        const matchesStatus =
          status === 'All Status' ||
          concern.current_status === status;

        return matchesSearch && matchesStatus;
      })
      .sort(
        (a, b) =>
          (a.concern_number ?? Number.MAX_SAFE_INTEGER) -
          (b.concern_number ?? Number.MAX_SAFE_INTEGER)
      );
  });

  submittedBy(concern: Concern): string {
    if (this.residentService.loading()) {
      return 'Loading resident information...';
    }

    if (this.residentService.error()) {
      return 'Resident information unavailable';
    }

    const resident = this.residentService.residents().find(
      item => item.uid === concern.resident_id
    );

    if (!resident) {
      return 'Resident record unavailable';
    }

    const fullName = [
      resident.firstName,
      resident.middleName,
      resident.lastName
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    const name =
      resident.name.trim() ||
      fullName ||
      'Name not recorded';

    const residentId = resident.residentId.trim();

    if (/^[1-9]\d*$/.test(residentId)) {
      return `${name} (Resident ID: ${residentId})`;
    }

    return `${name} (Resident ID not assigned)`;
  }

  retryResidents(): void {
    this.residentService.reload();
  }

  retryLoad(): void {
    this.concernService.reload();
  }

  categoryName(concern: Concern): string {
    return (
      concern.category?.category_name ??
      `Category ${concern.category_id}`
    );
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
    this.statusDraft = concern.current_status;
    this.remarks = '';
    this.feedback.set('');
  }

  closeDetails(): void {
    this.selectedConcern = null;
    this.remarks = '';
    this.feedback.set('');

    if (this.route.snapshot.queryParamMap.has('concern')) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { concern: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  async saveStatus(): Promise<void> {
    const concern = this.selectedConcern;

    if (!concern || this.saving()) return;

    if (this.statusDraft === concern.current_status) {
      this.feedback.set(
        'Select a different status before updating.'
      );
      return;
    }

    this.saving.set(true);
    this.feedback.set('');

    try {
      const updated = await this.concernService.updateStatus(
        concern.concern_id,
        this.statusDraft,
        this.remarks
      );

      if (
        this.selectedConcern?.concern_id !== concern.concern_id
      ) {
        return;
      }

      this.selectedConcern = updated;
      this.statusDraft = updated.current_status;
      this.remarks = '';

      this.feedback.set(
        'Status and history saved to Firebase.'
      );
    } catch (error: unknown) {
      this.feedback.set(
        error instanceof Error
          ? error.message
          : 'Unable to save the status.'
      );
    } finally {
      this.saving.set(false);
    }
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.selectedStatus.set('All Status');
  }

  trackConcern(_index: number, concern: Concern): string {
    return concern.concern_id;
  }
}