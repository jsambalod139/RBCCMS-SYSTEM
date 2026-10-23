import { CommonModule } from '@angular/common';

import {
  Component,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import {
  Concern,
  ConcernStatus
} from '../../../core/models/concern.model';

import {
  ConcernService
} from '../../../core/services/concern.service';

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

  readonly concerns = this.concernService.concerns;
  readonly loading = this.concernService.loading;
  readonly loadError = this.concernService.error;
  readonly photoError = this.concernService.photoError;

  readonly saving = signal(false);
  readonly feedback = signal('');

  readonly searchTerm = signal('');
  readonly selectedStatus = signal<StatusFilter>('All Status');

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
      const selected = this.selectedConcern;

      if (!selected) return;

      const current = records.find(
        item => item.concern_id === selected.concern_id
      );

      if (current) {
        this.selectedConcern = current;
      } else {
        this.closeDetails();
      }
    });
  }

  readonly filteredConcerns = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    const status = this.selectedStatus();

    return this.concerns().filter(concern => {
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
    });
  });

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

  trackConcern(
    _index: number,
    concern: Concern
  ): string {
    return concern.concern_id;
  }
}