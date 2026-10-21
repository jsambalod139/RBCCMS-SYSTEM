import {
  Component,
  computed,
  inject,
  signal
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import {
  Concern,
  ConcernStatus
} from '../../../core/models/concern.model';
// Adjust this path to wherever concern.service.ts lives in your project.
import { ConcernService } from '../../../core/services/concern.service';

@Component({
  selector: 'app-resident-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './resident-dashboard.html',
  styleUrl: './resident-dashboard.scss'
})
export class ResidentDashboard {
  private readonly router = inject(Router);
  private readonly concernService = inject(ConcernService);

  // Live data shared with Submit Concern and My Concerns.
  readonly concerns = this.concernService.concerns;

  // Replace with the logged-in resident's name later.
  readonly residentName = signal('Resident');

  readonly selectedConcern = signal<Concern | null>(null);

  readonly totalConcerns = computed(
    () => this.concerns().length
  );

  readonly pendingCount = computed(
    () => this.countByStatus('Pending')
  );

  readonly inProgressCount = computed(
    () => this.countByStatus('In Progress')
  );

  readonly resolvedCount = computed(
    () => this.countByStatus('Resolved')
  );

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

  // Navigate to Submit Concern.
  newConcern(): void {
    void this.router.navigate([
      '/res-dashboard/resident-submit-concern'
    ]);
  }

  // Navigate to My Concerns.
  viewAllConcerns(): void {
    void this.router.navigate([
      '/res-dashboard/resident-my-concern'
    ]);
  }

  // Open the selected concern's details.
  viewConcern(concern: Concern): void {
    this.selectedConcern.set(concern);
  }

  // Close the details dialog.
  closeConcernDetails(): void {
    this.selectedConcern.set(null);
  }

  categoryName(concern: Concern): string {
    return (
      concern.category?.category_name ??
      `Category ${concern.category_id}`
    );
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

  trackConcern(
    _index: number,
    concern: Concern
  ): string {
    return concern.concern_id;
  }
}