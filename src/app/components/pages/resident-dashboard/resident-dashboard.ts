
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

@Component({
  selector: 'app-resident-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './resident-dashboard.html',
  styleUrl: './resident-dashboard.scss'
})
export class ResidentDashboard {
  private readonly router = inject(Router);

  // No dummy data. Starts empty.
  readonly concerns = signal<Concern[]>([]);

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
      concern =>
        concern.current_status.toLowerCase() ===
        status.toLowerCase()
    ).length;
  }

  // Navigate to Submit Concern.
  newConcern(): void {
    void this.router.navigate([
      '/res-dashboard/submit-concern'
    ]);
  }

  // Navigate to My Concerns.
  viewAllConcerns(): void {
    void this.router.navigate([
      '/res-dashboard/my-concerns'
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

  // Display the category from either a joined category
  // object or a category_name property.
  categoryName(concern: Concern): string {
    return (
      concern.category?.category_name ??
      concern.category_name ??
      'Uncategorized'
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
  ): number {
    return concern.concern_id;
  }
}
