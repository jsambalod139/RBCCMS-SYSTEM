
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

  private destroyed = false;

  private readonly params = toSignal(
    this.route.queryParamMap,
    {
      initialValue: this.route.snapshot.queryParamMap,
    }
  );

  // ARCHIVE MODE

  readonly archiveMode = computed(() => true);

  readonly archiving = signal('');
  readonly archiveFeedback = signal('');
  readonly archiveError = signal('');

  readonly concerns = this.service.concerns;

  // LOADING AND ERRORS

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

  // PHOTO

  readonly photoUrl = this.service.photoUrl;
  readonly photoLoading = this.service.photoLoading;
  readonly photoError = this.service.photoError;

  // SEARCH AND STATUS FILTER

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

  // SELECTED CONCERN DETAILS

  readonly requestedId = computed(
    () => this.params().get('concern') || ''
  );

  readonly selectedConcern = computed(
    () =>
      this.concerns().find(
        item =>
          item.concern_id === this.requestedId() &&
          item.is_archived === true
      ) ?? null
  );

  // ========================================
  // FILTER ARCHIVED CONCERNS
  // ========================================

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
          concern.is_archived === true &&
          matchesStatus &&
          matchesSearch
        );

      })

      // Most recently archived concerns first.

      .sort((a, b) =>
        (b.archive_changed_at ?? '').localeCompare(
          a.archive_changed_at ?? ''
        ) ||

        b.reported_at.localeCompare(
          a.reported_at
        ) ||

        (b.concern_number ?? 0) -
        (a.concern_number ?? 0) ||

        a.concern_id.localeCompare(
          b.concern_id
        )
      );
  });

  // ========================================
  // BULK SELECTION
  // ========================================

  private readonly selectionOwner = signal('');

  readonly selectedConcernIds =
    signal<Set<string>>(new Set());

  // Concerns available for restoration.

  readonly selectableConcerns = computed(() =>
    this.filteredConcerns().filter(
      concern => this.canArchive(concern)
    )
  );

  // Selected concerns.

  readonly selectedConcerns = computed(() => {

    if (
      !this.selectionOwner() ||
      this.selectionOwner() !==
        this.service.accessUid()
    ) {
      return [];
    }

    return this.selectableConcerns().filter(
      concern =>
        this.selectedConcernIds().has(
          concern.concern_id
        )
    );

  });

  // Number of selected concerns.

  readonly selectedCount = computed(
    () => this.selectedConcerns().length
  );

  // Check if all concerns are selected.

  readonly allSelected = computed(() =>
    this.selectableConcerns().length > 0 &&
    this.selectedCount() ===
      this.selectableConcerns().length
  );

  // Check if some concerns are selected.

  readonly partiallySelected = computed(() =>
    this.selectedCount() > 0 &&
    !this.allSelected()
  );

  // ========================================
  // CONSTRUCTOR
  // ========================================

  constructor() {

    effect(() => {

      void this.service.selectPhoto(
        this.selectedConcern()
      );

    });

    // Clear selection when account access changes.

    effect(() => {

      this.service.accessUid();

      this.selectedConcernIds.set(
        new Set<string>()
      );

      this.selectionOwner.set('');

    });

  }

  // ========================================
  // RELOAD
  // ========================================

  retryLoad(): void {

    if (this.archiving()) return;

    this.clearSelection();

    this.service.reload();

  }

  // ========================================
  // PHOTO FUNCTIONS
  // ========================================

  retryPhoto(): void {

    void this.service.selectPhoto(
      this.selectedConcern(),
      true
    );

  }

  imageFailed(): void {

    this.service.imageFailed();

  }

  // ========================================
  // CONCERN INFORMATION
  // ========================================

  submittedBy(concern: Concern): string {

    return this.service.submittedBy(concern);

  }

  categoryName(concern: Concern): string {

    return (
      concern.category?.category_name ||
      `Category ${concern.category_id}`
    );

  }

  // ========================================
  // STATUS DESIGN
  // ========================================

  statusClass(status: string): string {

    const classes: Record<string, string> = {
      Pending: 'status-pending',
      'In Progress': 'status-progress',
      Resolved: 'status-resolved',
      Rejected: 'status-rejected',
    };

    return classes[status] || 'status-default';

  }

  // ========================================
  // VIEW CONCERN DETAILS
  // ========================================

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

  // ========================================
  // BACK TO ARCHIVE
  // ========================================

  closeDetails(): void {

    if (this.archiving()) return;

    this.clearSelection();

    void this.router.navigate([], {

      relativeTo: this.route,

      queryParams: {
        concern: null,
      },

      queryParamsHandling: 'merge',

    });

  }

  // ========================================
  // CHECK IF CONCERN CAN BE RESTORED
  // ========================================

  canArchive(concern: Concern): boolean {

    return (
      concern.is_archived === true &&
      [
        'Pending',
        'In Progress',
        'Resolved',
        'Rejected',
      ].includes(concern.current_status)
    );

  }

  // ========================================
  // CHECK IF CONCERN IS SELECTED
  // ========================================

  isConcernSelected(id: string): boolean {

    return (
      !!this.selectionOwner() &&

      this.selectionOwner() ===
        this.service.accessUid() &&

      this.selectedConcernIds().has(id)
    );

  }

  // ========================================
  // SELECT SPECIFIC CONCERN
  // ========================================

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

    const actor = this.service.accessUid();

    if (!actor) return;

    if (this.selectionOwner() !== actor) {

      this.selectedConcernIds.set(
        new Set<string>()
      );

      this.selectionOwner.set(actor);

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

  // ========================================
  // SELECT ALL ARCHIVED CONCERNS
  // ========================================

  toggleSelectAll(event: Event): void {

    if (this.archiving()) return;

    const actor = this.service.accessUid();

    if (!actor) return;

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectionOwner.set(actor);

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

  // ========================================
  // CLEAR SELECTION
  // ========================================

  clearSelection(): void {

    if (this.archiving()) return;

    this.selectedConcernIds.set(
      new Set<string>()
    );

    this.selectionOwner.set('');

  }

  // ========================================
  // SEARCH FILTER
  // ========================================

  setSearchTerm(value: string): void {

    if (this.archiving()) return;

    this.clearSelection();

    this.searchTerm.set(value);

  }

  // ========================================
  // STATUS FILTER
  // ========================================

  setStatusFilter(value: StatusFilter): void {

    if (this.archiving()) return;

    this.clearSelection();

    this.selectedStatus.set(value);

  }

  // ========================================
  // RESTORE CONFIRMATION
  // ========================================

  private confirmRestore(count: number) {

    return Swal.fire({

      title:
        count === 1
          ? 'Restore Concern'
          : 'Restore Selected Concerns',

      text:
        count === 1
          ? 'Are you sure you want to restore this concern? It will return to Community Concerns.'
          : `Are you sure you want to restore ${count} selected concerns? They will return to Community Concerns.`,

      icon: 'warning',
      iconColor: '#16814c',

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

  }

  // ========================================
  // RESTORE SELECTED CONCERNS
  // ========================================

  async restoreSelected(): Promise<void> {

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
        await this.confirmRestore(
          selected.length
        );

      if (
        !result.isConfirmed ||
        this.destroyed
      ) {
        return;
      }

      // Restore selected concerns individually.
      // Preserve existing Firestore transactions
      // and audit logging.

      for (const concern of selected) {

        if (
          this.destroyed ||

          this.service.accessUid() !== actor
        ) {

          firstError =
            'The page or account access changed.';

          break;

        }

        try {

          await this.service.setArchived(

            concern.concern_id,

            false,

            concern.archive_revision ?? 0

          );

          successful.add(
            concern.concern_id
          );

        } catch (error: unknown) {

          firstError ||=

            error instanceof Error

              ? error.message

              : 'A restore request failed.';

        }

      }

      // SUCCESS MESSAGE

      if (successful.size > 0) {

        this.archiveFeedback.set(

          successful.size === 1

            ? 'The concern has been restored successfully.'

            : `${successful.size} concerns have been restored successfully.`

        );

      }

      // FAILED RESTORATIONS

      const remaining =
        selected.length - successful.size;

      if (remaining > 0) {

        this.archiveError.set(

          `${remaining} concern(s) were not restored. ` +

          `${firstError} ` +

          'Please review the latest records and try again.'

        );

      }

    } catch (error: unknown) {

      this.archiveError.set(

        error instanceof Error

          ? error.message

          : 'Unable to restore selected concerns.'

      );

    } finally {

      // Remove successfully restored concerns
      // from the current selection.

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

  // ========================================
  // CLEAR FILTERS
  // ========================================

  clearFilters(): void {

    if (this.archiving()) return;

    this.clearSelection();

    this.searchTerm.set('');

    this.selectedStatus.set('All Status');

  }

  // ========================================
  // CLEANUP
  // ========================================

  ngOnDestroy(): void {

    this.destroyed = true;

    void this.service.selectPhoto(null);

  }

}
