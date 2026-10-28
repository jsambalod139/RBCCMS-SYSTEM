import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';

import {
  AdminDashboardService,
} from '../../../core/services/admin-dashboard.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.scss',
})
export class AdminDashboard {
  readonly dashboard = inject(AdminDashboardService);

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