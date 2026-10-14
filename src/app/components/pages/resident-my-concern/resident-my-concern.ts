
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type {
  ConcernStatus,
  ConcernWithRelations
} from '../../../core/models/concern.model';

@Component({
  selector: 'app-resident-my-concern',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './resident-my-concern.html',
  styleUrl: './resident-my-concern.scss'
})
export class ResidentMyConcern {
  searchTerm = '';
  selectedStatus = 'All Status';

  selectedConcern: ConcernWithRelations | null = null;
  showNavigationPlaceholder = false;

  readonly statusOptions: string[] = [
    'All Status',
    'Pending',
    'In Progress',
    'Resolved',
    'Rejected'
  ];

  /**
   * Real concern records will be assigned here later.
   * No sample or dummy records are included.
   */
  concerns: ConcernWithRelations[] = [];

  /**
   * Filters concerns by ID, category, location, description,
   * and selected status.
   */
  get filteredConcerns(): ConcernWithRelations[] {
    const search = this.searchTerm.trim().toLowerCase();

    return this.concerns.filter((concern) => {
      const categoryName =
        concern.category?.category_name ??
        `Category ${concern.category_id}`;

      const matchesSearch =
        String(concern.concern_id).toLowerCase().includes(search) ||
        categoryName.toLowerCase().includes(search) ||
        concern.location_description.toLowerCase().includes(search) ||
        concern.description.toLowerCase().includes(search);

      const matchesStatus =
        this.selectedStatus === 'All Status' ||
        concern.current_status === this.selectedStatus;

      return matchesSearch && matchesStatus;
    });
  }

  /**
   * Returns the CSS class for the current status.
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
   * Opens the selected concern's details.
   */
  viewConcern(concern: ConcernWithRelations): void {
    this.selectedConcern = concern;
  }

  /**
   * Closes the details modal.
   */
  closeDetails(): void {
    this.selectedConcern = null;
  }

  /**
   * Resets the search and status filter.
   */
  clearFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = 'All Status';
  }

  /**
   * Placeholder only: no route is assumed or invented.
   */
  onSubmitConcernClick(): void {
    this.showNavigationPlaceholder = true;
  }
}
