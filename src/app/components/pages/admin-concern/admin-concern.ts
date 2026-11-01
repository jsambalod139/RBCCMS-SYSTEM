import { CommonModule } from '@angular/common';

import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import {
  ActivatedRoute,
  Router,
} from '@angular/router';

import {
  toSignal,
} from '@angular/core/rxjs-interop';

import {
  Concern,
  ConcernStatus,
} from '../../../core/models/concern.model';

import {
  ConcernService,
} from '../../../core/services/concern.service';

type StatusFilter = 'All Status' | ConcernStatus;

@Component({
  selector: 'app-admin-concern',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-concern.html',
  styleUrl: './admin-concern.scss',
})
export class AdminConcern implements OnDestroy {
  private readonly service = inject(ConcernService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly params = toSignal(
    this.route.queryParamMap,
    {
      initialValue: this.route.snapshot.queryParamMap,
    }
  );

  readonly concerns = this.service.concerns;

  readonly loading = computed(
    () =>
      this.service.loading() ||
      this.service.adminResidentLoading()
  );

  readonly loadError = computed(
    () =>
      this.service.error() ||
      this.service.adminResidentError()
  );

  readonly photoUrl = this.service.photoUrl;
  readonly photoLoading = this.service.photoLoading;
  readonly photoError = this.service.photoError;

  readonly searchTerm = signal('');

  readonly selectedStatus =
    signal<StatusFilter>('All Status');

  readonly statusOptions: StatusFilter[] = [
    'All Status',
    'Pending',
    'In Progress',
    'Resolved',
    'Rejected',
  ];

  readonly requestedId = computed(
    () => this.params().get('concern') || ''
  );

  readonly selectedConcern = computed(
    () =>
      this.concerns().find(
        item => item.concern_id === this.requestedId()
      ) ?? null
  );

  readonly filteredConcerns = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();

    return this.concerns()
      .filter(concern => {
        const matchesStatus =
          this.selectedStatus() === 'All Status' ||
          concern.current_status === this.selectedStatus();

        const matchesSearch = [
          String(concern.concern_number ?? ''),
          this.categoryName(concern),
          this.submittedBy(concern),
          concern.location_description,
          concern.description,
          concern.office?.office_name || '',
        ].some(value =>
          value.toLowerCase().includes(search)
        );

        return matchesStatus && matchesSearch;
      })
      .sort(
        (a, b) =>
          (
            a.concern_number ?? Number.MAX_SAFE_INTEGER
          ) -
          (
            b.concern_number ?? Number.MAX_SAFE_INTEGER
          ) ||
          a.concern_id.localeCompare(b.concern_id)
      );
  });

  constructor() {
    effect(() => {
      void this.service.selectPhoto(
        this.selectedConcern()
      );
    });
  }

  retryLoad(): void {
    this.service.reload();
  }

  retryPhoto(): void {
    void this.service.selectPhoto(
      this.selectedConcern(),
      true
    );
  }

  imageFailed(): void {
    this.service.imageFailed();
  }

  submittedBy(concern: Concern): string {
    return this.service.submittedBy(concern);
  }

  categoryName(concern: Concern): string {
    return (
      concern.category?.category_name ||
      `Category ${concern.category_id}`
    );
  }

  statusClass(status: string): string {
    const classes: Record<string, string> = {
      Pending: 'status-pending',
      'In Progress': 'status-progress',
      Resolved: 'status-resolved',
      Rejected: 'status-rejected',
    };

    return classes[status] || 'status-default';
  }

  viewDetails(concern: Concern): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        concern: concern.concern_id,
      },
      queryParamsHandling: 'merge',
    });
  }

  closeDetails(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        concern: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.selectedStatus.set('All Status');
  }

  ngOnDestroy(): void {
    void this.service.selectPhoto(null);
  }
}