import { CommonModule } from '@angular/common';

import {
  Component,
  OnInit,
  effect,
  inject,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import {
  ActivatedRoute,
  Router,
} from '@angular/router';

import { toSignal } from '@angular/core/rxjs-interop';

import {
  ConcernStatus,
  ConcernWithRelations,
} from '../../../core/models/concern.model';

import {
  ConcernService,
} from '../../../core/services/concern.service';

@Component({
  selector: 'app-resident-my-concern',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './resident-my-concern.html',
  styleUrl: './resident-my-concern.scss',
})
export class ResidentMyConcern implements OnInit {
  private readonly concernService =
    inject(ConcernService);

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly routeParams = toSignal(
    this.route.queryParamMap,
    {
      initialValue: this.route.snapshot.queryParamMap,
    }
  );

  searchTerm = '';
  selectedStatus = 'All Status';

  selectedConcern: ConcernWithRelations | null = null;

  readonly photoError = this.concernService.photoError;

  readonly statusOptions = [
    'All Status',
    'Pending',
    'In Progress',
    'Resolved',
    'Rejected',
  ];

  constructor() {
    effect(() => {
      const records = this.concernService.concerns();
      const requested = this.routeParams().get('concern');
      const loading = this.concernService.loading();
      const failed = this.concernService.error();

      const target =
        requested || this.selectedConcern?.concern_id;

      if (!target) return;

      const current = records.find(
        item => item.concern_id === target
      );

      if (current) {
        this.selectedConcern = current;
      } else if (!loading && !failed) {
        this.closeDetails();
      }
    });
  }

  get isLoading(): boolean {
    return this.concernService.loading();
  }

  get errorMessage(): string {
    return this.concernService.error();
  }

  get concerns(): ConcernWithRelations[] {
    return this.concernService.concerns();
  }

  ngOnInit(): void {
    this.loadConcerns();
  }

  loadConcerns(): void {
    this.concernService.reload();
  }

  retryLoad(): void {
    this.loadConcerns();
  }

  get filteredConcerns(): ConcernWithRelations[] {
    const search = this.searchTerm.trim().toLowerCase();

    return this.concerns
      .filter(concern => {
        const categoryName =
          concern.category?.category_name ??
          `Category ${concern.category_id}`;

        const matchesSearch = [
          String(concern.resident_concern_number ?? ''),
          categoryName,
          concern.location_description,
          concern.description,
        ].some(value =>
          (value ?? '').toLowerCase().includes(search)
        );

        const matchesStatus =
          this.selectedStatus === 'All Status' ||
          concern.current_status === this.selectedStatus;

        return matchesSearch && matchesStatus;
      })
      .sort(
        (a, b) =>
          (
            a.resident_concern_number ??
            Number.MAX_SAFE_INTEGER
          ) -
          (
            b.resident_concern_number ??
            Number.MAX_SAFE_INTEGER
          )
      );
  }

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

  viewConcern(
    concern: ConcernWithRelations
  ): void {
    this.selectedConcern = concern;

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        concern: concern.concern_id,
      },
      queryParamsHandling: 'merge',
    });
  }

  closeDetails(): void {
    this.selectedConcern = null;

    if (
      this.route.snapshot.queryParamMap.has('concern')
    ) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          concern: null,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = 'All Status';
  }

  onSubmitConcernClick(): void {
    void this.router.navigate([
      '/res-dashboard/resident-submit-concern',
    ]);
  }

  trackConcern(
    _index: number,
    concern: ConcernWithRelations
  ): string {
    return concern.concern_id;
  }
}