import { CommonModule } from '@angular/common';
import {
  Component,
  OnInit,
  inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  ConcernStatus,
  ConcernWithRelations
} from '../../../core/models/concern.model';

import {
  ConcernService
} from '../../../core/services/concern.service';

@Component({
  selector: 'app-resident-my-concern',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule
  ],
  templateUrl: './resident-my-concern.html',
  styleUrl: './resident-my-concern.scss'
})
export class ResidentMyConcern implements OnInit {
  private readonly concernService = inject(ConcernService);
  private readonly router = inject(Router);

  searchTerm = '';
  selectedStatus = 'All Status';

  selectedConcern: ConcernWithRelations | null = null;

  isLoading = false;
  errorMessage = '';

  readonly statusOptions: string[] = [
    'All Status',
    'Pending',
    'In Progress',
    'Resolved',
    'Rejected'
  ];

  /**
   * Read concerns from the existing shared service.
   * This keeps the page connected to the application's
   * current concern data source.
   */
  get concerns(): ConcernWithRelations[] {
    return this.concernService.concerns();
  }

  ngOnInit(): void {
    this.loadConcerns();
  }

  /**
   * Use the existing service data.
   *
   * If the service already loads concerns automatically,
   * this method requires no additional API request.
   */
  loadConcerns(): void {
    this.errorMessage = '';

    // The shared service currently exposes a synchronous signal.
    // Do not show a loading state while reading it.
    this.isLoading = false;
  }

  retryLoad(): void {
    this.loadConcerns();
  }

  /**
   * Search by concern ID, category, location, or description,
   * and apply the selected status filter.
   */
  get filteredConcerns(): ConcernWithRelations[] {
    const search = this.searchTerm.trim().toLowerCase();

    return this.concerns.filter((concern) => {
      const categoryName =
        concern.category?.category_name ??
        `Category ${concern.category_id}`;

      const matchesSearch =
        String(concern.concern_id)
          .toLowerCase()
          .includes(search) ||
        categoryName.toLowerCase().includes(search) ||
        (concern.location_description ?? '')
          .toLowerCase()
          .includes(search) ||
        (concern.description ?? '')
          .toLowerCase()
          .includes(search);

      const matchesStatus =
        this.selectedStatus === 'All Status' ||
        concern.current_status === this.selectedStatus;

      return matchesSearch && matchesStatus;
    });
  }

  /**
   * Return a CSS class for the concern status badge.
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
        return 'status-default';
    }
  }

  /**
   * Open the selected concern in the details modal.
   */
  viewConcern(concern: ConcernWithRelations): void {
    this.selectedConcern = concern;
  }

  /**
   * Close the concern details modal.
   */
  closeDetails(): void {
    this.selectedConcern = null;
  }

  /**
   * Reset search and status filters.
   */
  clearFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = 'All Status';
  }

  /**
   * Navigate to the existing Submit Concern page.
   */
  onSubmitConcernClick(): void {
    void this.router.navigate([
      '/res-dashboard/resident-submit-concern'
    ]);
  }

  /**
   * Track table rows by their concern ID.
   */
  trackConcern(
    _index: number,
    concern: ConcernWithRelations
  ): string {
    return String(concern.concern_id);
  }
}