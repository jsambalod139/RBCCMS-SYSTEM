import { CommonModule } from '@angular/common';

import {
  Component,
  computed,
  inject,
  signal
} from '@angular/core';

import { Router } from '@angular/router';

import {
  Concern,
  ConcernStatus
} from '../../../core/models/concern.model';

import {
  ConcernService
} from '../../../core/services/concern.service';

@Component({
  selector: 'app-personnel-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './personnel-dashboard.html',
  styleUrl: './personnel-dashboard.scss'
})
export class PersonnelDashboard {
  private readonly concernService =
    inject(ConcernService);

  private readonly router = inject(Router);

  readonly concerns = this.concernService.concerns;
  readonly loading = this.concernService.loading;
  readonly loadError = this.concernService.error;

  readonly period = signal<6 | 12>(6);

  private readonly today = signal(new Date());

  private readonly monthFormatter =
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit'
    });

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
          this.dateValue(b.reported_at) -
          this.dateValue(a.reported_at)
      )
      .slice(0, 5)
  );

  readonly monthlySubmissions = computed(() => {
    const current =
      this.monthParts(this.today())!;

    const rows = Array.from(
      { length: this.period() },

      (_, index) => {
        const date = new Date(
          Date.UTC(
            current.year,
            current.month - this.period() + index,
            1
          )
        );

        return {
          key:
            `${date.getUTCFullYear()}-` +
            String(
              date.getUTCMonth() + 1
            ).padStart(2, '0'),

          label: date.toLocaleDateString(
            'en-US',
            {
              timeZone: 'UTC',
              month: 'short',
              year: 'numeric'
            }
          ),

          count: 0
        };
      }
    );

    const byMonth = new Map(
      rows.map(row => [row.key, row])
    );

    for (const concern of this.concerns()) {
      const parts = this.monthParts(
        new Date(concern.reported_at)
      );

      if (!parts) continue;

      const key =
        `${parts.year}-` +
        String(parts.month).padStart(2, '0');

      const row = byMonth.get(key);

      if (row) {
        row.count++;
      }
    }

    return rows;
  });

  // Integer tick values and room above the tallest bar.
  readonly chartStep = computed(() => {
    const highest = Math.max(
      0,
      ...this.monthlySubmissions().map(
        row => row.count
      )
    );

    return Math.max(
      1,
      Math.ceil((highest + 1) / 4)
    );
  });

  readonly chartMaximum = computed(
    () => this.chartStep() * 4
  );

  readonly chartTicks = computed(() =>
    [0, 1, 2, 3, 4].map(index => ({
      value: index * this.chartStep(),
      position: index * 25
    }))
  );

  readonly periodTotal = computed(() =>
    this.monthlySubmissions().reduce(
      (sum, row) => sum + row.count,
      0
    )
  );

  readonly officeBreakdown = computed(() => {
    const offices = new Map<
      string,
      {
        id: string;
        name: string;
        count: number;
      }
    >([
      [
        'menro',
        {
          id: 'menro',
          name:
            'Municipal Environment and Natural Resources Office',
          count: 0
        }
      ],
      [
        'municipal-engineering',
        {
          id: 'municipal-engineering',
          name: 'Municipal Engineering Office',
          count: 0
        }
      ],
      [
        'municipal-waterworks',
        {
          id: 'municipal-waterworks',
          name: 'Municipal Waterworks',
          count: 0
        }
      ],
      [
        'barangay-office',
        {
          id: 'barangay-office',
          name: 'Barangay Office',
          count: 0
        }
      ]
    ]);

    for (const concern of this.concerns()) {
      const id =
        concern.office_id || 'unassigned';

      const row = offices.get(id) ?? {
        id,
        name:
          id === 'unassigned'
            ? 'Not assigned'
            : id,
        count: 0
      };

      row.name =
        concern.office?.office_name?.trim() ||
        row.name;

      row.count++;

      offices.set(id, row);
    }

    return [...offices.values()].sort(
      (a, b) =>
        b.count - a.count ||
        a.name.localeCompare(b.name)
    );
  });

  readonly officeMaximum = computed(() =>
    Math.max(
      1,
      ...this.officeBreakdown().map(
        row => row.count
      )
    )
  );

  changePeriod(event: Event): void {
    const value = Number(
      (event.target as HTMLSelectElement).value
    );

    if (value === 6 || value === 12) {
      this.today.set(new Date());
      this.period.set(value);
    }
  }

  retryLoad(): void {
    this.today.set(new Date());
    this.concernService.reload();
  }

  private monthParts(
    date: Date
  ): { year: number; month: number } | null {
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const parts =
      this.monthFormatter.formatToParts(date);

    return {
      year: Number(
        parts.find(
          part => part.type === 'year'
        )!.value
      ),

      month: Number(
        parts.find(
          part => part.type === 'month'
        )!.value
      )
    };
  }

  private countByStatus(
    status: ConcernStatus
  ): number {
    return this.concerns().filter(
      concern => concern.current_status === status
    ).length;
  }

  private dateValue(value: string): number {
    const timestamp = Date.parse(value);

    return Number.isNaN(timestamp)
      ? 0
      : timestamp;
  }

  categoryName(concern: Concern): string {
    return (
      concern.category?.category_name ??
      'Uncategorized'
    );
  }

  statusClass(status: ConcernStatus): string {
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

  viewConcerns(): void {
    void this.router.navigate([
      '/perso-dashboard/personnel-concern'
    ]);
  }
}