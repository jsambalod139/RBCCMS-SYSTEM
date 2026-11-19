
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

  private destroyed = false;

  private readonly params = toSignal(
    this.route.queryParamMap,
    {
      initialValue: this.route.snapshot.queryParamMap,
    }
  );

  readonly archiveMode = computed(() => false);

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
        item =>
          item.concern_id === this.requestedId() &&
          (item.is_archived === true) === this.archiveMode()
      ) ?? null
  );

  // FILTER AND DISPLAY NEWEST CONCERNS FIRST

  readonly filteredConcerns = computed(() => {
    const search =
      this.searchTerm().trim().toLowerCase();

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
          (value ?? '').toLowerCase().includes(search)
        );

        return (
          (concern.is_archived === true) === this.archiveMode()
          && matchesStatus
          && matchesSearch
        );
      })
      .sort((a, b) =>
        b.reported_at.localeCompare(a.reported_at) ||
        (b.concern_number ?? 0) -
        (a.concern_number ?? 0) ||
        a.concern_id.localeCompare(b.concern_id)
      );
  });

  // BULK SELECTION

  readonly selectedConcernIds =
    signal<Set<string>>(new Set());

  readonly selectableConcerns = computed(() =>
    this.filteredConcerns().filter(
      concern => this.canArchive(concern)
    )
  );

  readonly selectedConcerns = computed(() =>
    this.selectableConcerns().filter(concern =>
      this.selectedConcernIds().has(
        concern.concern_id
      )
    )
  );

  readonly selectedCount = computed(
    () => this.selectedConcerns().length
  );

  readonly allSelected = computed(() =>
    this.selectableConcerns().length > 0 &&
    this.selectedCount() ===
      this.selectableConcerns().length
  );

  readonly partiallySelected = computed(() =>
    this.selectedCount() > 0 &&
    !this.allSelected()
  );

  constructor() {
    effect(() => {
      void this.service.selectPhoto(
        this.selectedConcern()
      );
    });

    // Clear selections when account access changes.
    effect(() => {
      this.service.accessUid();

      this.selectedConcernIds.set(
        new Set<string>()
      );
    });
  }

  retryLoad(): void {
    this.clearSelection();
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
    if (this.archiving()) return;

    this.clearSelection();

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
    return (
      concern.is_archived !== true &&
      [
        'Pending',
        'In Progress',
        'Resolved',
        'Rejected',
      ].includes(concern.current_status)
    );
  }

  // CHECK IF CONCERN IS SELECTED

  isConcernSelected(id: string): boolean {
    return this.selectedConcernIds().has(id);
  }

  // SELECT SPECIFIC CONCERN

  toggleConcernSelection(
    concern: Concern,
    event: Event
  ): void {

    if (
      this.archiving() ||
      !this.canArchive(concern)
    ) {
      return;
    }

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectedConcernIds.update(ids => {
      const next = new Set(ids);

      if (checked) {
        next.add(concern.concern_id);
      } else {
        next.delete(concern.concern_id);
      }

      return next;
    });
  }

  // SELECT ALL DISPLAYED CONCERNS

  toggleSelectAll(event: Event): void {
    if (this.archiving()) return;

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectedConcernIds.set(
      checked
        ? new Set(
            this.selectableConcerns().map(
              concern => concern.concern_id
            )
          )
        : new Set<string>()
    );
  }

  // CLEAR SELECTED CONCERNS

  clearSelection(): void {
    this.selectedConcernIds.set(
      new Set<string>()
    );
  }

  // SEARCH FILTER

  setSearchTerm(value: string): void {
    if (this.archiving()) return;

    this.clearSelection();
    this.searchTerm.set(value);
  }

  // STATUS FILTER

  setStatusFilter(value: StatusFilter): void {
    if (this.archiving()) return;

    this.clearSelection();
    this.selectedStatus.set(value);
  }

  // SWEETALERT CONFIRMATION

  private confirmArchive(count: number) {
    return Swal.fire({
      title:
        count === 1
          ? 'Archive Concern'
          : 'Archive Selected Concerns',

      text:
        count === 1
          ? 'Please confirm that you wish to archive this concern.'
          : `Archive ${count} selected concerns? You can restore them from the Archive page.`,

      icon: 'warning',
      iconColor: '#b7791f',

      showCancelButton: true,
      reverseButtons: true,

      confirmButtonText: 'Yes, archive',
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
  }

  // ARCHIVE INDIVIDUAL CONCERN

  async changeArchive(
    concern: Concern
  ): Promise<void> {

    if (
      this.archiving() ||
      !this.canArchive(concern)
    ) {
      return;
    }

    const actor = this.service.accessUid();

    if (!actor) return;

    this.archiving.set(concern.concern_id);
    this.archiveFeedback.set('');
    this.archiveError.set('');

    try {
      const result =
        await this.confirmArchive(1);

      if (
        !result.isConfirmed ||
        this.destroyed
      ) {
        return;
      }

      if (this.service.accessUid() !== actor) {
        throw new Error(
          'Your account access changed. Please try again.'
        );
      }

      await this.service.setArchived(
        concern.concern_id,
        true,
        concern.archive_revision ?? 0
      );

      this.selectedConcernIds.update(ids => {
        const next = new Set(ids);
        next.delete(concern.concern_id);
        return next;
      });

      this.archiveFeedback.set(
        'The concern has been archived successfully.'
      );

      if (
        this.requestedId() === concern.concern_id
      ) {
        this.closeDetails();
      }

    } catch (error: unknown) {

      this.archiveError.set(
        error instanceof Error
          ? error.message
          : 'The request could not be completed. Please try again.'
      );

    } finally {
      this.archiving.set('');
    }
  }

  // ARCHIVE MULTIPLE SELECTED CONCERNS

  async archiveSelected(): Promise<void> {

    if (this.archiving()) return;

    const selected = this.selectedConcerns();

    if (!selected.length) return;

    const actor = this.service.accessUid();

    if (!actor) {
      this.archiveError.set(
        'Please sign in again.'
      );
      return;
    }

    this.archiving.set('bulk');
    this.archiveFeedback.set('');
    this.archiveError.set('');

    const successful = new Set<string>();

    let firstError = '';

    try {
      const result =
        await this.confirmArchive(
          selected.length
        );

      if (
        !result.isConfirmed ||
        this.destroyed
      ) {
        return;
      }

      // Use existing secured archive transaction.
      // Each successful archive creates an audit log.

      for (const concern of selected) {

        if (
          this.destroyed ||
          this.service.accessUid() !== actor
        ) {
          firstError ||=
            'The page or account access changed.';

          break;
        }

        try {
          await this.service.setArchived(
            concern.concern_id,
            true,
            concern.archive_revision ?? 0
          );

          successful.add(concern.concern_id);

        } catch (error: unknown) {

          firstError ||=
            error instanceof Error
              ? error.message
              : 'An archive request failed.';
        }
      }

      if (successful.size > 0) {
        this.archiveFeedback.set(
          `${successful.size} concern(s) archived successfully.`
        );
      }

      const remaining =
        selected.length - successful.size;

      if (remaining > 0) {
        this.archiveError.set(
          `${remaining} concern(s) were not archived. ` +
          `${firstError} ` +
          'Review the latest records and try again.'
        );
      }

    } catch (error: unknown) {

      this.archiveError.set(
        error instanceof Error
          ? error.message
          : 'The archive request could not be completed.'
      );

    } finally {

      // Remove successfully archived selections.
      this.selectedConcernIds.update(ids =>
        new Set(
          [...ids].filter(
            id => !successful.has(id)
          )
        )
      );

      this.archiving.set('');
    }
  }

  clearFilters(): void {
    if (this.archiving()) return;

    this.clearSelection();

    this.searchTerm.set('');
    this.selectedStatus.set('All Status');
  }

  ngOnDestroy(): void {
    this.destroyed = true;

    void this.service.selectPhoto(null);
  }
}
