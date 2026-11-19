
import { CommonModule } from '@angular/common';

import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  ActivatedRoute,
  Router,
} from '@angular/router';

import {
  takeUntilDestroyed,
} from '@angular/core/rxjs-interop';

import {
  ResidentRecord,
  ResidentService,
} from '../../../core/services/resident.service';

import {
  Concern,
  ConcernStatus,
} from '../../../core/models/concern.model';

import {
  ConcernService,
} from '../../../core/services/concern.service';

@Component({
  selector: 'app-personnel-residents',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './personnel-residents.html',
  styleUrl: './personnel-residents.scss',
})
export class PersonnelResidents implements OnDestroy {

  readonly service = inject(ResidentService);
  readonly concernService = inject(ConcernService);

  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly mode =
    signal<'list' | 'view' | 'add' | 'edit' | 'resume'>('list');

  readonly profileUid = signal('');

  readonly profileTab =
    signal<'personal' | 'history'>('personal');

  readonly saving = signal(false);
  readonly feedback = signal('');
  readonly saveError = signal('');
  readonly search = signal('');
  readonly submitted = signal(false);
  readonly passwordVisible = signal(false);
  readonly verifiedAlready = signal(false);

  private selectedUid = '';
  private requestId = '';
  private destroyed = false;

  // RESIDENT FORM

  readonly form = this.fb.nonNullable.group({
    firstName: [
      '',
      [
        Validators.required,
        Validators.maxLength(60),
        Validators.pattern(/\S/),
      ],
    ],

    middleName: ['', Validators.maxLength(60)],

    lastName: [
      '',
      [
        Validators.required,
        Validators.maxLength(60),
        Validators.pattern(/\S/),
      ],
    ],

    email: [
      '',
      [
        Validators.required,
        Validators.email,
        Validators.maxLength(254),
      ],
    ],

    password: [
      '',
      [
        Validators.required,
        Validators.minLength(8),
        Validators.maxLength(128),
      ],
    ],

    contactNumber: [
      '',
      [
        Validators.maxLength(30),
        Validators.pattern(/^[+\d() .-]{7,30}$/),
      ],
    ],

    address: [
      '',
      [
        Validators.required,
        Validators.maxLength(255),
        Validators.pattern(/\S/),
      ],
    ],

    purok: [
      '',
      [
        Validators.required,
        Validators.maxLength(60),
        Validators.pattern(/\S/),
      ],
    ],

    residencyVerified: [
      false,
      Validators.requiredTrue,
    ],
  });

  // FILTER RESIDENTS

  readonly filteredResidents = computed(() => {

    const term =
      this.search().trim().toLowerCase();

    const numberOf = (value: string): number => {
      const number = Number(value);

      return Number.isSafeInteger(number) && number > 0
        ? number
        : Number.MAX_SAFE_INTEGER;
    };

    return this.service.residents()
      .filter(resident =>
        [
          resident.name,
          resident.email,
          resident.address,
          resident.purok,
          resident.residentId,
        ].some(value =>
          value.toLowerCase().includes(term)
        )
      )
      .sort((a, b) =>
        numberOf(a.residentId) - numberOf(b.residentId) ||
        a.name.localeCompare(b.name)
      );
  });

  readonly selectedResident = computed(() =>
    this.service.residents().find(
      item => item.uid === this.profileUid()
    ) ?? null
  );

  // CONCERN HISTORY

  readonly residentConcerns = signal<Concern[]>([]);
  readonly historyLoading = signal(false);
  readonly historyError = signal('');

  // SEARCH AND STATUS FILTER

  readonly historySearch = signal('');

  readonly historyStatus =
    signal<'All Status' | ConcernStatus>('All Status');

  readonly historyStatusOptions:
    ('All Status' | ConcernStatus)[] = [
      'All Status',
      'Pending',
      'In Progress',
      'Resolved',
      'Rejected',
    ];

  // FILTER AND DISPLAY NEWEST CONCERNS FIRST

  readonly filteredHistory = computed(() => {

    const search = this.historySearch()
      .trim()
      .toLowerCase();

    const status = this.historyStatus();

    return this.residentConcerns()

      .filter(concern => {

        const matchesSearch = [
          String(concern.concern_number ?? ''),
          this.categoryName(concern),
          concern.location_description,
          concern.description,
        ].some(value =>
          (value ?? '').toLowerCase().includes(search)
        );

        const matchesStatus =
          status === 'All Status' ||
          concern.current_status === status;

        return matchesSearch && matchesStatus;
      })

      .sort((a, b) =>
        (b.reported_at || '').localeCompare(
          a.reported_at || ''
        ) ||

        (b.concern_number ?? 0) -
        (a.concern_number ?? 0) ||

        a.concern_id.localeCompare(b.concern_id)
      );
  });

  clearHistoryFilters(): void {
    this.historySearch.set('');
    this.historyStatus.set('All Status');
  }

  // RESET FILTERS WHEN CHANGING RESIDENT OR ACCOUNT

  private readonly resetHistoryFilters = effect(() => {
    this.profileUid();
    this.concernService.accessUid();

    this.clearHistoryFilters();
  });

  // LOAD RESIDENT CONCERN HISTORY

  private readonly historyRetry = signal(0);

  private readonly followHistory = effect(onCleanup => {

    const resident = this.selectedResident();

    const canManage =
      this.service.canManageResidents();

    const mode = this.mode();
    const tab = this.profileTab();

    const accessUid =
      this.concernService.accessUid();

    const office =
      this.concernService.officeId();

    this.historyRetry();

    const controller = new AbortController();

    let active = true;

    onCleanup(() => {
      active = false;
      controller.abort();
    });

    this.residentConcerns.set([]);
    this.historyError.set('');
    this.historyLoading.set(false);

    if (
      !resident ||
      !canManage ||
      !accessUid ||
      office !== 'barangay-office' ||
      mode !== 'view' ||
      tab !== 'history'
    ) {
      return;
    }

    this.historyLoading.set(true);

    void this.concernService

      .getResidentHistory(
        resident.uid,
        controller.signal
      )

      .then(records => {

        if (active && !this.destroyed) {
          this.residentConcerns.set(records);
        }

      })

      .catch(error => {

        if (active && !this.destroyed) {

          this.historyError.set(
            error instanceof Error
              ? error.message
              : 'Unable to load resident history. Please retry.'
          );

        }

      })

      .finally(() => {

        if (active && !this.destroyed) {
          this.historyLoading.set(false);
        }

      });
  });

  // RESIDENT PROFILE PHOTO

  readonly residentPhotoUrl = signal('');
  readonly residentPhotoLoading = signal(false);
  readonly residentPhotoError = signal('');

  private readonly photoRetry = signal(0);

  private readonly followResidentPhoto =
    effect(onCleanup => {

      const resident = this.selectedResident();

      const canManage =
        this.service.canManageResidents();

      const mode = this.mode();

      this.photoRetry();

      const controller = new AbortController();

      let active = true;
      let url = '';

      this.residentPhotoUrl.set('');
      this.residentPhotoError.set('');
      this.residentPhotoLoading.set(false);

      onCleanup(() => {

        active = false;
        controller.abort();

        if (url) {
          URL.revokeObjectURL(url);
        }

      });

      if (
        !canManage ||
        mode !== 'view' ||
        !resident?.profilePhotoPath
      ) {
        return;
      }

      this.residentPhotoLoading.set(true);

      void this.service

        .downloadResidentPhoto(
          resident.uid,
          controller.signal
        )

        .then(blob => {

          if (!active || this.destroyed) return;

          url = URL.createObjectURL(blob);

          this.residentPhotoUrl.set(url);

        })

        .catch(() => {

          if (active && !this.destroyed) {

            this.residentPhotoError.set(
              'Resident photo could not be loaded.'
            );

          }

        })

        .finally(() => {

          if (active && !this.destroyed) {
            this.residentPhotoLoading.set(false);
          }

        });
    });

  // CONSTRUCTOR

  constructor() {

    this.route.queryParamMap

      .pipe(takeUntilDestroyed())

      .subscribe(params => {

        this.form.controls.password.setValue('');

        this.passwordVisible.set(false);

        this.profileUid.set(
          params.get('resident') || ''
        );

        this.profileTab.set(
          params.get('tab') === 'history'
            ? 'history'
            : 'personal'
        );

        this.mode.set(
          this.profileUid() ? 'view' : 'list'
        );

        this.saveError.set('');

      });
  }

  // REFRESH CONCERN HISTORY

  refreshHistory(): void {
    this.historyRetry.update(value => value + 1);
  }

  retryResidentPhoto(): void {
    this.photoRetry.update(value => value + 1);
  }

  residentPhotoFailed(): void {

    this.residentPhotoUrl.set('');

    this.residentPhotoError.set(
      'Resident photo could not be displayed.'
    );
  }

  // VIEW RESIDENT

  view(resident: ResidentRecord): void {

    void this.router.navigate([], {

      relativeTo: this.route,

      queryParams: {
        resident: resident.uid,
      },

      queryParamsHandling: 'merge',

    });
  }

  residentNumber(resident: ResidentRecord): string {

    return /^[1-9]\d*$/.test(resident.residentId)

      ? resident.residentId

      : 'Not assigned';
  }

  initials(resident: ResidentRecord): string {

    return resident.name

      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('') || 'R';
  }

  // CONCERN CATEGORY

  categoryName(concern: Concern): string {

    return concern.category?.category_name ||

      `Category ${concern.category_id}`;
  }

  // CONCERN STATUS

  statusClass(status: ConcernStatus): string {

    return {
      Pending: 'pending',
      'In Progress': 'progress',
      Resolved: 'resolved',
      Rejected: 'rejected',
    }[status];

  }

  // VIEW CONCERN DETAILS

  showConcern(concern: Concern): void {

    if (
      !this.service.canManageResidents() ||

      concern.resident_id !==
        this.selectedResident()?.uid ||

      !this.residentConcerns().some(
        item => item.concern_id === concern.concern_id
      )
    ) {
      return;
    }

    void this.router.navigate(
      ['/perso-dashboard/personnel-concern'],

      {
        queryParams: {

          concern: concern.concern_id,

          historyResident: concern.resident_id,

        },
      }
    );
  }

  // FORM VALIDATION

  invalid(
    field: keyof typeof this.form.controls
  ): boolean {

    const control = this.form.controls[field];

    return control.invalid &&
      (control.touched || this.submitted());
  }

  // ADD RESIDENT

  add(): void {

    this.prepare('add');

    this.form.reset();

    this.requestId = crypto.randomUUID();

    this.form.controls.email.enable();

    this.form.controls.password.setValidators([
      Validators.required,
      Validators.minLength(8),
      Validators.maxLength(128),
    ]);

    this.form.controls.residencyVerified

      .setValidators(Validators.requiredTrue);

    this.form.controls.password
      .updateValueAndValidity();

    this.form.controls.residencyVerified
      .updateValueAndValidity();
  }

  // EDIT RESIDENT

  edit(resident: ResidentRecord): void {

    if (resident.registrationState === 'incomplete') {
      return;
    }

    this.fill(resident, 'edit');

    this.form.controls.email.disable();

    this.form.controls.password.clearValidators();

    this.form.controls.residencyVerified
      .clearValidators();

    this.form.controls.password
      .updateValueAndValidity();

    this.form.controls.residencyVerified
      .updateValueAndValidity();
  }

  // RESUME INCOMPLETE REGISTRATION

  resume(resident: ResidentRecord): void {

    if (!this.service.canResume(resident)) return;

    this.add();

    this.fill(resident, 'resume');

    this.requestId = resident.registrationRequestId;

    this.form.controls.email.disable();
  }

  // FILL RESIDENT INFORMATION

  private fill(
    resident: ResidentRecord,
    mode: 'edit' | 'resume'
  ): void {

    this.prepare(mode);

    this.selectedUid = resident.uid;

    const names = resident.name.trim().split(/\s+/);

    this.form.reset({

      firstName:
        resident.firstName || names[0] || '',

      middleName: resident.middleName,

      lastName:
        resident.lastName || names.slice(1).join(' '),

      email: resident.email,

      password: '',

      contactNumber: resident.contactNumber,

      address: resident.address,

      purok: resident.purok,

      residencyVerified: resident.residencyVerified,

    });

    this.verifiedAlready.set(
      resident.residencyVerified
    );
  }

  private prepare(
    mode: 'add' | 'edit' | 'resume'
  ): void {

    this.mode.set(mode);

    this.submitted.set(false);
    this.feedback.set('');
    this.saveError.set('');
    this.passwordVisible.set(false);
    this.verifiedAlready.set(false);
  }

  // BACK TO RESIDENTS

  back(): void {

    if (this.saving()) return;

    this.form.controls.password.setValue('');

    this.passwordVisible.set(false);
    this.saveError.set('');

    if (
      this.mode() === 'edit' &&
      this.profileUid()
    ) {

      this.mode.set('view');

      return;
    }

    this.mode.set('list');

    void this.router.navigate([], {

      relativeTo: this.route,

      queryParams: {
        resident: null,
      },

      queryParamsHandling: 'merge',

    });
  }

  // SAVE RESIDENT

  async save(): Promise<void> {

    if (this.saving()) return;

    this.submitted.set(true);
    this.saveError.set('');

    if (this.form.invalid) {

      this.form.markAllAsTouched();

      return;
    }

    this.saving.set(true);

    const editing = this.mode() === 'edit';

    try {

      const details = this.form.getRawValue();

      const message = editing

        ? await this.service.edit(
            this.selectedUid,
            details
          )

        : await this.service.create(
            details,
            this.requestId
          );

      if (this.destroyed) return;

      this.form.controls.password.setValue('');

      this.passwordVisible.set(false);

      this.mode.set(
        editing && this.profileUid()
          ? 'view'
          : 'list'
      );

      this.feedback.set(message);

    } catch (error) {

      if (!this.destroyed) {

        this.saveError.set(
          error instanceof Error
            ? error.message
            : 'Unable to save resident.'
        );

      }

    } finally {

      if (!this.destroyed) {
        this.saving.set(false);
      }

    }
  }

  // CLEANUP

  ngOnDestroy(): void {

    this.destroyed = true;

    this.form.controls.password.setValue('');
  }
}
