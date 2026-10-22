import { CommonModule } from '@angular/common';
import { ConcernService } from '../../../core/services/concern.service';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';

import {
  Concern,
  ConcernStatus,
} from '../../../core/models/concern.model';

@Component({
  selector: 'app-personnel-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './personnel-dashboard.html',
  styleUrl: './personnel-dashboard.scss',
})
export class PersonnelDashboard {
  private readonly concernService = inject(ConcernService);
  readonly concerns = this.concernService.concerns;
  readonly loading = this.concernService.loading;
  readonly loadError = this.concernService.error;
  readonly photoError = this.concernService.photoError;
  retryLoad(): void { this.concernService.reload(); }
  constructor() {
    effect(() => {
      const records = this.concerns();
      const selected = untracked(this.selectedConcern);
      if (selected) this.selectedConcern.set(records.find(item =>
        item.concern_id === selected.concern_id) ?? null);
    });
  }

  readonly selectedConcern = signal<Concern | null>(null);

  readonly totalConcerns = computed(() => this.concerns().length);

  readonly pendingCount = computed(() => this.countByStatus('Pending'));

  readonly inProgressCount = computed(() =>
    this.countByStatus('In Progress')
  );

  readonly resolvedCount = computed(() => this.countByStatus('Resolved'));

  readonly rejectedCount = computed(() => this.countByStatus('Rejected'));

  readonly recentConcerns = computed(() =>
    [...this.concerns()]
      .sort(
        (a, b) =>
          new Date(b.reported_at).getTime() -
          new Date(a.reported_at).getTime()
      )
      .slice(0, 5)
  );

  private countByStatus(status: ConcernStatus): number {
    return this.concerns().filter(
      concern => concern.current_status === status
    ).length;
  }

  categoryName(concern: Concern): string {
    return concern.category?.category_name ?? 'Uncategorized';
  }

  statusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'status-pending';

      case 'in progress':
        return 'status-progress';

      case 'resolved':
        return 'status-resolved';

      case 'rejected':
        return 'status-rejected';

      default:
        return 'status-default';
    }
  }

  viewConcern(concern: Concern): void {
    this.selectedConcern.set(concern);
  }

  closeConcernDetails(): void {
    this.selectedConcern.set(null);
  }

  trackConcern(_index: number, concern: Concern): string {
    return concern.concern_id;
  }
}