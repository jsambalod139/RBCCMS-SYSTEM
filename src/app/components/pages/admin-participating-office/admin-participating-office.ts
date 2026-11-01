import { CommonModule } from '@angular/common';

import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  ViewChild,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';

import { FormsModule, NgForm } from '@angular/forms';

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

  @ViewChild('viewHeading')
  private viewHeading?: ElementRef<HTMLElement>;

  readonly selectedId = signal('');
  readonly personnelOfficeId = signal('');

  readonly saving = signal(false);
  readonly success = signal('');
  readonly error = signal('');

  officeName = '';
  description = '';
  officeActive = true;

  personnelName = '';
  personnelEmail = '';
  personnelPassword = '';
  confirmPassword = '';
  showPasswords = false;

  private destroyed = false;
  private lastPayload = '';
  private requestId = '';

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
    if (this.saving() || !office.is_active) return;

    this.closeEditors();
    this.personnelOfficeId.set(office.office_id);

    this.success.set('');
    this.error.set('');
    this.showViewStart();
  }

  officeLabel(id: string): string {
    return this.offices.records().find(
      office => office.office_id === id
    )?.office_name || 'Selected office';
  }

  cancel(): void {
    if (this.saving()) return;

    this.closeEditors();
    this.error.set('');
    this.showViewStart();
  }

  async save(form: NgForm): Promise<void> {
    if (this.saving() || !this.selectedId()) return;

    this.success.set('');
    this.error.set('');

    if (form.invalid || !this.officeName.trim()) {
      form.form.markAllAsTouched();
      this.error.set('Enter a valid office name.');
      return;
    }

    const payload = {
      action: 'update-office',
      officeId: this.selectedId(),
      name: this.officeName.trim(),
      description: this.description.trim(),
      active: this.officeActive,
    };

    this.saving.set(true);

    try {
      await this.offices.updateOffice(
        payload.officeId,
        payload.name,
        payload.description,
        payload.active,
        this.idFor(payload)
      );

      if (this.destroyed) return;

      this.closeEditors();

      this.success.set(
        'Office information updated and recorded in Audit Logs.'
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
    if (this.saving() || !this.personnelOfficeId()) return;

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
        'Enter a name, valid email address, and password of 8–128 characters.'
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

    // Keep the request ID when retrying the same registration.
    // Passwords are not included in the stored payload identifier.
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
    afterNextRender(() => {
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
    }, {
      injector: this.injector,
    });
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
    this.selectedId.set('');
    this.personnelOfficeId.set('');

    this.officeName = '';
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