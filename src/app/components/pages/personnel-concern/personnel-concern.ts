import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Concern } from '../../../core/models/concern.model';
import { Category } from '../../../core/models/category.model';
import { Office } from '../../..//core/models/office.model';
import { ConcernUpdate } from '../../../core/models/concern-update.model';

@Component({
  selector: 'app-personnel-concern',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './personnel-concern.html',
  styleUrls: ['./personnel-concern.scss']
})
export class PersonnelConcern {
  // Connect real data here later. No sample records are included.
  concerns: Concern[] = [];
  categories: Category[] = [];
  offices: Office[] = [];
  concernUpdates: ConcernUpdate[] = [];

  searchTerm = '';
  selectedCategory = '';
  selectedOffice = '';
  selectedStatus = '';

  currentPage = 1;
  pageSize = 10;

  selectedConcern: Concern | null = null;
  showDetailsModal = false;

  get filteredConcerns(): Concern[] {
    const search = this.searchTerm.trim().toLowerCase();

    return this.concerns.filter((concern) => {
      const categoryName = this.getCategoryName(concern).toLowerCase();

      const matchesSearch =
        !search ||
        String(concern.concern_id).toLowerCase().includes(search) ||
        categoryName.includes(search) ||
        concern.location_description.toLowerCase().includes(search) ||
        concern.description.toLowerCase().includes(search);

      const matchesCategory =
        !this.selectedCategory ||
        String(concern.category_id) === this.selectedCategory;

      const matchesOffice =
        !this.selectedOffice ||
        String(concern.office_id) === this.selectedOffice;

      const matchesStatus =
        !this.selectedStatus ||
        concern.current_status.toLowerCase() ===
          this.selectedStatus.toLowerCase();

      return (
        matchesSearch &&
        matchesCategory &&
        matchesOffice &&
        matchesStatus
      );
    });
  }

  get paginatedConcerns(): Concern[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;

    return this.filteredConcerns.slice(
      startIndex,
      startIndex + this.pageSize
    );
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredConcerns.length / this.pageSize));
  }

  get firstRecordNumber(): number {
    return this.filteredConcerns.length === 0
      ? 0
      : (this.currentPage - 1) * this.pageSize + 1;
  }

  get lastRecordNumber(): number {
    return Math.min(
      this.currentPage * this.pageSize,
      this.filteredConcerns.length
    );
  }

  get pendingCount(): number {
    return this.concerns.filter(
      (concern) => this.normalizeStatus(concern.current_status) === 'pending'
    ).length;
  }

  get inProgressCount(): number {
    return this.concerns.filter(
      (concern) =>
        this.normalizeStatus(concern.current_status) === 'in progress'
    ).length;
  }

  get resolvedCount(): number {
    return this.concerns.filter(
      (concern) => this.normalizeStatus(concern.current_status) === 'resolved'
    ).length;
  }

  get rejectedCount(): number {
    return this.concerns.filter(
      (concern) => this.normalizeStatus(concern.current_status) === 'rejected'
    ).length;
  }

  getCategoryName(concern: Concern): string {
    if (concern.category_name) {
      return concern.category_name;
    }

    return (
      this.categories.find(
        (category) => category.category_id === concern.category_id
      )?.category_name || 'Category unavailable'
    );
  }

  getOfficeName(concern: Concern): string {
    return (
      this.offices.find(
        (office) => String(office.office_id) === String(concern.office_id)
      )?.office_name || 'Office unavailable'
    );
  }

  normalizeStatus(status: string): string {
    return status.trim().toLowerCase();
  }

  getStatusClass(status: string): string {
    switch (this.normalizeStatus(status)) {
      case 'pending':
        return 'status-pending';

      case 'in progress':
        return 'status-in-progress';

      case 'resolved':
        return 'status-resolved';

      case 'rejected':
        return 'status-rejected';

      default:
        return 'status-default';
    }
  }

  formatDate(value: string | Date): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return 'Date unavailable';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric'
    }).format(date);
  }

  onFilterChange(): void {
    this.currentPage = 1;
  }

  changePage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  onPageSizeChange(): void {
    this.currentPage = 1;
  }

  openDetails(concern: Concern): void {
    this.selectedConcern = concern;
    this.showDetailsModal = true;
  }

  closeDetails(): void {
    this.showDetailsModal = false;
    this.selectedConcern = null;
  }

  get selectedConcernUpdates(): ConcernUpdate[] {
    if (!this.selectedConcern) {
      return [];
    }

    return this.concernUpdates
      .filter(
        (update) =>
          update.concern_id === this.selectedConcern?.concern_id
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime()
      );
  }

  // Frontend-only placeholder: intentionally does not save a record.
  addConcern(): void {
    // Add a form or connect the appropriate workflow later.
  }
}