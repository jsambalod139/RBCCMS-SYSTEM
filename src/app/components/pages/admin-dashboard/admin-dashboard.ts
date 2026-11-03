import { CommonModule } from '@angular/common';

import {
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import {
  AdminDashboardService,
  localDay,
} from '../../../core/services/admin-dashboard.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.scss',
})
export class AdminDashboard {
  readonly dashboard =
    inject(AdminDashboardService);

  readonly filterError = signal('');

  dateFrom = this.dashboard.period().from;
  dateTo = this.dashboard.period().to;

  get today(): string {
    return localDay(new Date());
  }

  constructor() {
    effect(() => {
      const period = this.dashboard.period();

      this.dateFrom = period.from;
      this.dateTo = period.to;
      this.filterError.set('');
    });
  }

  applyFilters(): void {
    this.filterError.set(
      this.dashboard.applyPeriod(
        this.dateFrom,
        this.dateTo
      )
    );
  }

  resetFilters(): void {
    this.dashboard.resetPeriod();
    this.filterError.set('');
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

  retryLoad(): void {
    this.dashboard.reload();
  }
}