import { CommonModule } from '@angular/common';
import Swal from 'sweetalert2';

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
  selector: 'app-admin-archive',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-archive.html',
  styleUrl: './admin-archive.scss',
})
export class AdminArchive implements OnDestroy {
  private readonly service = inject(ConcernService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly params = toSignal(
    this.route.queryParamMap,
    {
      initialValue: this.route.snapshot.queryParamMap,
    }
  );

  readonly archiveMode = computed(() => true);
  readonly archiving = signal('');
  readonly archiveFeedback = signal('');
  readonly archiveError = signal('');

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
          && (item.is_archived === true) === this.archiveMode()
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

        return (concern.is_archived === true) === this.archiveMode()
          && matchesStatus && matchesSearch;
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

  canArchive(concern: Concern): boolean {
    return concern.is_archived === true && [
      'Pending', 'In Progress', 'Resolved', 'Rejected'
    ].includes(concern.current_status);
  }

  async changeArchive(concern: Concern): Promise<void> {
    if (this.archiving() || !this.canArchive(concern)) return;
    this.archiving.set(concern.concern_id);
    this.archiveFeedback.set('');
    this.archiveError.set('');
    try {
      const result = await Swal.fire({
        title: 'Restore Concern',
        text: 'Please confirm that you wish to restore this concern to the Concerns list.',
        icon: 'warning',
        iconColor: '#b7791f',
        showCancelButton: true,
        reverseButtons: true,
        confirmButtonText: 'Yes, restore',
        cancelButtonText: 'Cancel',
        buttonsStyling: false,
        focusCancel: true,
        showCloseButton: false,
        width: 440,
        padding: '28px 24px 24px',
        background: '#ffffff',
        color: '#21372a',
        backdrop: 'rgba(16, 34, 24, 0.45)',
        customClass: {
          popup: 'rbccms-confirm-popup',
          icon: 'rbccms-confirm-icon',
          title: 'rbccms-confirm-title',
          htmlContainer: 'rbccms-confirm-message',
          actions: 'rbccms-confirm-actions',
          confirmButton: 'rbccms-confirm-primary',
          cancelButton: 'rbccms-confirm-cancel',
        },
      });
      if (!result.isConfirmed) return;
      await this.service.setArchived(
        concern.concern_id, false, concern.archive_revision ?? 0
      );
      this.archiveFeedback.set('The concern has been restored successfully.');
      if (this.requestedId() === concern.concern_id) this.closeDetails();
    } catch (error: unknown) {
      this.archiveError.set(error instanceof Error
        ? error.message : 'The request could not be completed. Please try again.');
    } finally {
      this.archiving.set('');
    }
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.selectedStatus.set('All Status');
  }

  ngOnDestroy(): void {
    void this.service.selectPhoto(null);
  }
}