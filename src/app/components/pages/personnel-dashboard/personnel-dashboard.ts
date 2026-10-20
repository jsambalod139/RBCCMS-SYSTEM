import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import type {
  ConcernStatus,
  ConcernWithRelations
} from '../../../core/models/concern.model';

@Component({
  selector: 'app-personnel-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './personnel-dashboard.html',
  styleUrl: './personnel-dashboard.scss'
})
export class PersonnelDashboard {
  /**
   * FRONTEND ONLY:
   * No sample or dummy concerns are included.
   *
   * When integrating the backend later, populate this
   * collection with the concerns assigned to the current
   * personnel account.
   */
  concerns: ConcernWithRelations[] = [];

  selectedConcern: ConcernWithRelations | null = null;

  showViewAllPlaceholder = false;

  /**
   * Total records in the assigned-concerns collection.
   *
   * The supplied ERD has no individual personnel assignment
   * field. This count becomes meaningful when the collection
   * contains actual assigned records.
   */
  get assignedCount(): number {
    return this.concerns.length;
  }

  get pendingCount(): number {
    return this.countByStatus('Pending');
  }

  get inProgressCount(): number {
    return this.countByStatus('In Progress');
  }

  get resolvedCount(): number {
    return this.countByStatus('Resolved');
  }

  get rejectedCount(): number {
    return this.countByStatus('Rejected');
  }

  /**
   * Counts concerns by their current status.
   */
  private countByStatus(status: ConcernStatus): number {
    return this.concerns.filter(
      concern => concern.current_status === status
    ).length;
  }

  /**
   * Returns a readable category name.
   */
  getCategoryName(concern: ConcernWithRelations): string {
    return concern.category?.category_name ?? 'Category unavailable';
  }

  /**
   * Returns a CSS class for the current status badge.
   */
  getStatusClass(status: ConcernStatus): string {
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
        return '';
    }
  }

  /**
   * Formats reported_at for the dashboard table.
   */
  formatDate(dateValue: string | null | undefined): string {
    if (!dateValue) {
      return 'Date unavailable';
    }

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
      return 'Invalid date';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date);
  }

  /**
   * Opens the details modal for the selected concern.
   */
  viewConcern(concern: ConcernWithRelations): void {
    this.selectedConcern = concern;
  }

  /**
   * Closes the details modal.
   */
  closeConcernDetails(): void {
    this.selectedConcern = null;
  }

  /**
   * Frontend-only placeholder.
   * No application route is assumed.
   */
  onViewAllClick(): void {
    this.showViewAllPlaceholder = true;
  }

  closeViewAllPlaceholder(): void {
    this.showViewAllPlaceholder = false;
  }
}