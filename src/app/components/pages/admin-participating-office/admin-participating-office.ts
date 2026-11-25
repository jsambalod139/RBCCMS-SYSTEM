import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { getAuth } from 'firebase/auth';
import Swal from 'sweetalert2';

import { firebaseApp } from '../../../core/firebase.config';
import {
  ParticipatingOffice,
  ParticipatingOfficeService,
} from '../../../core/services/participating-office.service';

@Component({
  selector: 'app-admin-participating-office',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-participating-office.html',
  styleUrl: './admin-participating-office.scss',
})
export class AdminParticipatingOffice implements OnDestroy {
  readonly offices = inject(ParticipatingOfficeService);

  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private readonly auth = getAuth(firebaseApp);

  @ViewChild('viewHeading')
  private viewHeading?: ElementRef<HTMLElement>;

  readonly creatingOffice = signal(false);
  readonly selectedId = signal('');
  readonly personnelOfficeId = signal('');

  readonly saving = signal(false);
  readonly success = signal('');
  readonly error = signal('');
  readonly deletingId = signal('');
  readonly selectedOfficeIds = signal<Set<string>>(new Set());
  readonly archiving = signal(false);

  readonly archiveableOffices = computed(() =>
    this.offices.records().filter(
      office => this.canArchiveOffice(office)
    )
  );

  readonly selectedOffices = computed(() => {
    const ids = this.selectedOfficeIds();

    return this.archiveableOffices().filter(
      office => ids.has(office.office_id)
    );
  });

  readonly selectedOfficeCount = computed(
    () => this.selectedOffices().length
  );

  readonly allOfficesSelected = computed(() =>
    this.archiveableOffices().length > 0 &&
    this.selectedOfficeCount() ===
      this.archiveableOffices().length
  );

  readonly partiallySelectedOffices = computed(() =>
    this.selectedOfficeCount() > 0 &&
    !this.allOfficesSelected()
  );

  officeName = '';
  categoryName = '';
  description = '';
  officeActive = true;

  personnelName = '';
  personnelEmail = '';
  personnelPassword = '';
  confirmPassword = '';
  showPasswords = false;

  private deleteRequest: {
    officeId: string;
    name: string;
    requestId: string;
    categoryToken: string;
  } | null = null;

  private destroyed = false;
  private lastPayload = '';
  private requestId = '';

  deleteHint(office: ParticipatingOffice): string {
    if (office.office_id === 'barangay-office') {
      return 'The core resident-management office cannot be deleted.';
    }

    if (this.offices.personnelFor(office.office_id).length) {
      return 'Personnel assigned: deactivate this office instead.';
    }

    return '';
  }

  canArchiveOffice(
    office: ParticipatingOffice
  ): boolean {
    return (
      office.office_id !== 'barangay-office' &&
      !office.is_archived
    );
  }

  isOfficeSelected(officeId: string): boolean {
    return this.selectedOfficeIds().has(officeId);
  }

  toggleOfficeSelection(
    office: ParticipatingOffice,
    event: Event
  ): void {
    if (this.saving() || !this.canArchiveOffice(office)) {
      return;
    }

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectedOfficeIds.update(ids => {
      const next = new Set(ids);

      if (checked) {
        next.add(office.office_id);
      } else {
        next.delete(office.office_id);
      }

      return next;
    });
  }

  toggleAllOffices(event: Event): void {
    if (this.saving()) return;

    const checked =
      (event.target as HTMLInputElement).checked;

    this.selectedOfficeIds.set(
      checked
        ? new Set(
            this.archiveableOffices().map(
              office => office.office_id
            )
          )
        : new Set()
    );
  }

  clearOfficeSelection(): void {
    if (!this.saving()) {
      this.selectedOfficeIds.set(new Set());
    }
  }

  async archiveOffice(
    office: ParticipatingOffice
  ): Promise<void> {
    await this.archiveOffices([office]);
  }

  async archiveSelectedOffices(): Promise<void> {
    await this.archiveOffices(this.selectedOffices());
  }

  private async archiveOffices(
    selected: ParticipatingOffice[]
  ): Promise<void> {
    if (this.saving() || !selected.length) return;

    const offices = selected.filter(
      office => this.canArchiveOffice(office)
    );

    if (!offices.length) return;

    const decision = await Swal.fire({
      title:
        offices.length === 1
          ? 'Archive Participating Office'
          : 'Archive Selected Offices',
      text:
        offices.length === 1
          ? `Archive ${offices[0].office_name}? It will be unavailable for new concern routing until restored.`
          : `Archive ${offices.length} selected offices? They will be unavailable for new concern routing until restored.`,
      icon: 'warning',
      iconColor: '#b7791f',
      showCancelButton: true,
      reverseButtons: true,
      confirmButtonText: 'Yes, archive',
      cancelButtonText: 'Cancel',
      buttonsStyling: false,
      focusCancel: true,
      width: 460,
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
        confirmButton: 'rbccms-confirm-danger',
        cancelButton: 'rbccms-confirm-cancel',
      },
    });

    if (!decision.isConfirmed || this.destroyed) return;

    this.saving.set(true);
    this.archiving.set(true);
    this.success.set('');
    this.error.set('');

    const archived = new Set<string>();
    let firstError = '';

    try {
      for (const office of offices) {
        try {
          await this.offices.archiveOffice(
            office.office_id,
            crypto.randomUUID()
          );

          archived.add(office.office_id);
        } catch (error: unknown) {
          firstError ||= this.message(error);
        }
      }

      if (archived.size) {
        this.success.set(
          archived.size === 1
            ? 'The office was archived successfully and recorded in Audit Logs.'
            : `${archived.size} offices were archived successfully and recorded in Audit Logs.`
        );
      }

      const failed = offices.length - archived.size;

      if (failed) {
        this.error.set(
          `${failed} office(s) were not archived. ${firstError}`
        );
      }
    } finally {
      this.selectedOfficeIds.update(ids =>
        new Set(
          [...ids].filter(id => !archived.has(id))
        )
      );

      this.archiving.set(false);
      this.saving.set(false);
    }
  }

  async deleteOffice(
    office: ParticipatingOffice
  ): Promise<void> {
    const uid = this.auth.currentUser?.uid;

    if (
      !uid ||
      this.saving() ||
      this.offices.loading() ||
      this.offices.error() ||
      this.deleteHint(office)
    ) {
      return;
    }

    const current = (): boolean =>
      !this.destroyed &&
      this.auth.currentUser?.uid === uid;

    this.saving.set(true);
    this.deletingId.set(office.office_id);
    this.error.set('');
    this.success.set('');

    try {
      const check = await this.offices.checkOfficeDeletion(
        office.office_id
      );

      if (!current()) return;

      if (!check.canDelete) {
        const result = await Swal.fire({
          title: 'Office Deletion Unavailable',
          text: check.reason,
          icon: 'warning',
          iconColor: '#b7791f',
          showCancelButton: true,
          reverseButtons: true,
          confirmButtonText: 'Edit Office',
          cancelButtonText: 'Close',
          buttonsStyling: false,
          focusCancel: true,
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

        if (current() && result.isConfirmed) {
          this.saving.set(false);

          this.edit(
            this.offices.records().find(
              item => item.office_id === office.office_id
            ) || office
          );
        }

        return;
      }

      const decision = await Swal.fire({
        title: 'Confirm Office Deletion',
        text:
          `Please confirm the permanent deletion of "${check.officeName}".` +
          (
            check.categoryNames.length
              ? ` The following unused categories will also be deleted: ${
                  check.categoryNames.join(', ')
                }.`
              : ''
          ) +
          ' This action cannot be undone.',
        icon: 'warning',
        iconColor: '#b7791f',
        showCancelButton: true,
        reverseButtons: true,
        confirmButtonText: 'Yes, delete',
        cancelButtonText: 'Cancel',
        buttonsStyling: false,
        focusCancel: true,
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
          confirmButton: 'rbccms-confirm-danger',
          cancelButton: 'rbccms-confirm-cancel',
        },
      });

      if (!current() || !decision.isConfirmed) {
        return;
      }

      if (
        this.deleteRequest?.officeId !== office.office_id ||
        this.deleteRequest.name !== check.officeName ||
        this.deleteRequest.categoryToken !== check.categoryToken
      ) {
        this.deleteRequest = {
          officeId: office.office_id,
          name: check.officeName,
          requestId: crypto.randomUUID(),
          categoryToken: check.categoryToken,
        };
      }

      await this.offices.deleteOffice(
        office.office_id,
        check.officeName,
        this.deleteRequest.requestId,
        check.categoryToken
      );

      if (!current()) return;

      this.deleteRequest = null;

      this.success.set(
        'The office and any unused categories have been deleted successfully. The action was recorded in Audit Logs.'
      );
    } catch (error: unknown) {
      if (current()) {
        this.error.set(this.message(error));
      }
    } finally {
      if (!this.destroyed) {
        this.saving.set(false);
        this.deletingId.set('');
      }
    }
  }

  addOffice(): void {
    if (this.saving()) return;

    this.closeEditors();
    this.creatingOffice.set(true);
    this.success.set('');
    this.error.set('');
    this.showViewStart();
  }

  edit(office: ParticipatingOffice): void {
    if (this.saving()) return;

    this.closeEditors();

    this.selectedId.set(office.office_id);
    this.officeName = office.office_name;
    this.description = office.description;
    this.officeActive = office.is_active;

    this.success.set('');
    this.error.set('');
    this.showViewStart();
  }

  addPersonnel(office: ParticipatingOffice): void {
    if (this.saving() || !office.is_active) {
      return;
    }

    this.closeEditors();
    this.personnelOfficeId.set(office.office_id);
    this.success.set('');
    this.error.set('');
    this.showViewStart();
  }

  officeLabel(id: string): string {
    return (
      this.offices.records().find(
        office => office.office_id === id
      )?.office_name ||
      'Selected office'
    );
  }

  cancel(): void {
    if (this.saving()) return;

    this.closeEditors();
    this.error.set('');
    this.showViewStart();
  }

  async save(form: NgForm): Promise<void> {
    if (
      this.saving() ||
      (!this.selectedId() && !this.creatingOffice())
    ) {
      return;
    }

    this.success.set('');
    this.error.set('');

    if (
      form.invalid ||
      !this.officeName.trim() ||
      this.officeName.trim().length > 150 ||
      this.description.trim().length > 1000 ||
      (
        this.creatingOffice() &&
        (
          !this.categoryName.trim() ||
          this.categoryName.trim().length > 150
        )
      )
    ) {
      form.form.markAllAsTouched();

      this.error.set(
        'Enter valid office information and a new category name.'
      );
      return;
    }

    const payload = {
      action: this.creatingOffice()
        ? 'create-office'
        : 'update-office',
      categoryName: this.creatingOffice()
        ? this.categoryName.trim()
        : '',
      officeId: this.selectedId(),
      name: this.officeName.trim(),
      description: this.description.trim(),
      active: this.officeActive,
    };

    this.saving.set(true);

    try {
      const creating = this.creatingOffice();

      if (creating) {
        await this.offices.createOffice(
          payload.name,
          payload.categoryName,
          payload.description,
          payload.active,
          this.idFor(payload)
        );
      } else {
        await this.offices.updateOffice(
          payload.officeId,
          payload.name,
          payload.description,
          payload.active,
          this.idFor(payload)
        );
      }

      if (this.destroyed) return;

      this.closeEditors();

      this.success.set(
        creating
          ? 'Office and category created successfully and recorded in Audit Logs.'
          : 'Office information updated and recorded in Audit Logs.'
      );

      this.showViewStart();
    } catch (error: unknown) {
      if (!this.destroyed) {
        this.error.set(this.message(error));
      }
    } finally {
      if (!this.destroyed) {
        this.saving.set(false);
      }
    }
  }

  async registerPersonnel(form: NgForm): Promise<void> {
    if (this.saving() || !this.personnelOfficeId()) {
      return;
    }

    this.success.set('');
    this.error.set('');

    if (
      form.invalid ||
      !this.personnelName.trim() ||
      this.personnelPassword.length < 8 ||
      this.personnelPassword.length > 128
    ) {
      form.form.markAllAsTouched();

      this.error.set(
        'Enter a name, valid email address, and password of 8-128 characters.'
      );
      return;
    }

    if (this.personnelPassword !== this.confirmPassword) {
      form.form.markAllAsTouched();
      this.error.set('The passwords do not match.');
      return;
    }

    const payload = {
      action: 'create-personnel',
      officeId: this.personnelOfficeId(),
      name: this.personnelName.trim(),
      email: this.personnelEmail.trim().toLowerCase(),
    };

    const requestId = this.idFor(payload);
    this.saving.set(true);

    try {
      await this.offices.createPersonnel(
        payload.officeId,
        payload.name,
        payload.email,
        this.personnelPassword,
        requestId
      );

      if (this.destroyed) return;

      this.closeEditors();

      this.success.set(
        'Personnel account created successfully. The personnel member can now log in using the email and password you provided.'
      );

      this.showViewStart();
    } catch (error: unknown) {
      if (!this.destroyed) {
        this.error.set(this.message(error));
      }
    } finally {
      this.personnelPassword = '';
      this.confirmPassword = '';
      this.showPasswords = false;

      if (!this.destroyed) {
        this.saving.set(false);
      }
    }
  }

  private showViewStart(): void {
    afterNextRender(
      () => {
        if (this.destroyed) return;

        const scroller =
          this.element.nativeElement.closest('.main-section');

        if (scroller instanceof HTMLElement) {
          scroller.scrollTop = 0;
        } else {
          window.scrollTo({
            top: 0,
            behavior: 'instant',
          });
        }

        this.viewHeading?.nativeElement.focus({
          preventScroll: true,
        });
      },
      { injector: this.injector }
    );
  }

  private idFor(payload: object): string {
    const value = JSON.stringify(payload);

    if (value !== this.lastPayload || !this.requestId) {
      this.lastPayload = value;
      this.requestId = crypto.randomUUID();
    }

    return this.requestId;
  }

  private closeEditors(): void {
    this.selectedOfficeIds.set(new Set());

    this.creatingOffice.set(false);
    this.selectedId.set('');
    this.personnelOfficeId.set('');

    this.officeName = '';
    this.categoryName = '';
    this.description = '';
    this.officeActive = true;

    this.personnelName = '';
    this.personnelEmail = '';
    this.personnelPassword = '';
    this.confirmPassword = '';
    this.showPasswords = false;

    this.lastPayload = '';
    this.requestId = '';
  }

  private message(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'Unable to complete the operation.';
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.personnelPassword = '';
    this.confirmPassword = '';
  }
}