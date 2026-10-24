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

import {
  ConcernService
} from '../../../core/services/concern.service';

interface MonthSummary {
  key: string;
  label: string;
  count: number;
}

interface CategorySummary {
  category_id: number;
  label: string;
  count: number;
}

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

  readonly concerns = this.concernService.concerns;
  readonly loading = this.concernService.loading;
  readonly loadError = this.concernService.error;

  readonly residentName = signal('Resident');
  readonly monthRange = signal(6);

  private readonly selectedConcernId = signal<string | null>(null);

  readonly selectedConcern = computed(() =>
    this.concerns().find(
      concern => concern.concern_id === this.selectedConcernId()
    ) ?? null
  );

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

  readonly monthlyConcerns = computed(() =>
    buildMonthlySeries(
      this.concerns(),
      this.monthRange(),
      new Date()
    )
  );

  readonly chartMaximum = computed(() => {
    const maximum = Math.max(
      0,
      ...this.monthlyConcerns().map(month => month.count)
    );

    return Math.max(1, Math.ceil(maximum / 5)) * 5;
  });

  readonly chartTicks = computed(() =>
    Array.from(
      { length: 6 },
      (_, index) => this.chartMaximum() * (5 - index) / 5
    )
  );

  readonly chartDescription = computed(() =>
    this.monthlyConcerns()
      .map(month => `${month.label}: ${month.count} concerns`)
      .join('; ')
  );

  readonly categoryBreakdown = computed(() =>
    buildCategoryBreakdown(this.concerns())
  );

  readonly categoryMaximum = computed(() =>
    Math.max(
      1,
      ...this.categoryBreakdown().map(category => category.count)
    )
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

  changeMonthRange(event: Event): void {
    const value = Number(
      (event.target as HTMLSelectElement).value
    );

    if (value === 6 || value === 12) {
      this.monthRange.set(value);
    }
  }

  retryLoad(): void {
    this.concernService.reload();
  }

  newConcern(): void {
    void this.router.navigate([
      '/res-dashboard/resident-submit-concern'
    ]);
  }

  viewAllConcerns(): void {
    void this.router.navigate([
      '/res-dashboard/resident-my-concern'
    ]);
  }

  viewConcern(concern: Concern): void {
    this.selectedConcernId.set(concern.concern_id);
  }

  closeConcernDetails(): void {
    this.selectedConcernId.set(null);
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

// Use Philippine calendar months when grouping timestamps.
function monthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')!.value;
  const month = parts.find(part => part.type === 'month')!.value;

  return `${year}-${month}`;
}

export function buildMonthlySeries(
  concerns: readonly Concern[],
  months: number,
  now: Date
): MonthSummary[] {
  const [year, month] = monthKey(now)
    .split('-')
    .map(Number);

  const result = Array.from(
    { length: months },
    (_, index) => {
      const date = new Date(
        Date.UTC(year, month - months + index, 1)
      );

      return {
        key: monthKey(date),
        label: new Intl.DateTimeFormat('en-PH', {
          timeZone: 'Asia/Manila',
          month: 'short',
          year: 'numeric'
        }).format(date),
        count: 0
      };
    }
  );

  const lookup = new Map(
    result.map(item => [item.key, item])
  );

  for (const concern of concerns) {
    const date = new Date(concern.reported_at);

    if (!Number.isFinite(date.getTime())) {
      continue;
    }

    const bucket = lookup.get(monthKey(date));

    if (bucket) {
      bucket.count++;
    }
  }

  return result;
}

export function buildCategoryBreakdown(
  concerns: readonly Concern[]
): CategorySummary[] {
  const groups = new Map<number, CategorySummary>();

  for (const concern of concerns) {
    const existing = groups.get(concern.category_id);

    if (existing) {
      existing.count++;
    } else {
      groups.set(concern.category_id, {
        category_id: concern.category_id,
        label:
          concern.category?.category_name ??
          `Category ${concern.category_id}`,
        count: 1
      });
    }
  }

  return [...groups.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.category_id - b.category_id
  );
}