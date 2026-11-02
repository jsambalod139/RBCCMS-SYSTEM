import {
  Injectable,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';

import { Observable, defer } from 'rxjs';

import {
  getAuth,
  onAuthStateChanged,
} from 'firebase/auth';

import {
  DocumentData,
  Timestamp,
  Unsubscribe,
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { firebaseApp } from '../firebase.config';

import {
  ConcernOffice,
  ConcernPayload,
  ConcernResponse,
  ConcernStatus,
  ConcernUpdate,
  ConcernWithRelations,
} from '../models/concern.model';

import {
  ConcernCategoryService,
} from './concern-category.service';

import {
  ConcernPhotoService,
} from './concern-photo.service';

const SUBMITTER_ENDPOINT =
  'https://nlwjwvhjojnjrmlaykym.supabase.co/functions/v1/concern-photos';

const STATUSES: ConcernStatus[] = [
  'Pending',
  'In Progress',
  'Resolved',
  'Rejected',
];

@Injectable({ providedIn: 'root' })
export class ConcernService implements OnDestroy {
  private readonly categoryService =
    inject(ConcernCategoryService);

  private readonly photoService =
    inject(ConcernPhotoService);

  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  private readonly records =
    signal<ConcernWithRelations[]>([]);

  private readonly busy = signal(true);
  private readonly failure = signal('');
  private readonly photoFailure = signal('');

  readonly concerns = this.records.asReadonly();
  readonly loading = this.busy.asReadonly();
  readonly error = this.failure.asReadonly();
  readonly photoError = this.photoFailure.asReadonly();

  readonly accessUid = signal('');
  readonly officeId = signal('');

  private stopAuth?: Unsubscribe;
  private stopProfile?: Unsubscribe;
  private stopRecords?: Unsubscribe;
  private stopOffices?: Unsubscribe;
  private stopResidents?: Unsubscribe;

  private activeRole = '';

  private readonly residentProfiles = signal(
    new Map<string, { name: string; id: string }>()
  );

  readonly adminResidentLoading = signal(false);
  readonly adminResidentError = signal('');

  readonly photoUrl = signal('');
  readonly photoLoading = signal(false);

  private selectedPhotoKey = '';
  private selectedPhotoGeneration = 0;

  private offices = new Map<string, ConcernOffice>();

  private generation = 0;
  private profileGeneration = 0;
  private photoGeneration = 0;

  private readonly objectUrls =
    new Map<string, string>();

  private submitterGeneration = 0;
  private submitterRequestKey = '';
  private submitterLoadedKey = '';
  private submitterValue = '';
  private submitterDestroyed = false;

  readonly submitterLoading = signal(false);
  readonly submitterError = signal('');

  constructor() {
    this.stopAuth = onAuthStateChanged(
      this.auth,
      () => this.reload()
    );
  }

  private submitterKey(
    concern: ConcernWithRelations
  ): string {
    const uid = this.auth.currentUser?.uid;
    const office = this.officeId();

    if (
      !uid ||
      uid !== this.accessUid() ||
      !office ||
      concern.office_id !== office
    ) {
      return '';
    }

    return [
      uid,
      office,
      concern.concern_id,
      concern.resident_id,
    ].join(':');
  }

  submitterLabel(
    concern: ConcernWithRelations
  ): string {
    const key = this.submitterKey(concern);

    if (
      !key ||
      key !== this.submitterRequestKey
    ) {
      return 'Resident information unavailable';
    }

    if (this.submitterLoading()) {
      return 'Loading resident information...';
    }

    if (this.submitterError()) {
      return 'Resident information unavailable';
    }

    return key === this.submitterLoadedKey
      ? this.submitterValue
      : 'Resident information unavailable';
  }

  async loadSubmitter(
    concern: ConcernWithRelations,
    force = false
  ): Promise<void> {
    const key = this.submitterKey(concern);

    if (this.submitterDestroyed) return;

    if (!key) {
      this.clearSubmitter();
      return;
    }

    if (
      !force &&
      this.submitterRequestKey === key
    ) return;

    const generation =
      ++this.submitterGeneration;

    this.submitterRequestKey = key;
    this.submitterLoadedKey = '';
    this.submitterValue = '';

    this.submitterError.set('');
    this.submitterLoading.set(true);

    try {
      await this.auth.authStateReady();

      const user = this.auth.currentUser;

      if (
        !user ||
        key !== this.submitterKey(concern)
      ) {
        throw new Error(
          'Your account or office changed. Refresh the page.'
        );
      }

      const token = await user.getIdToken();

      if (
        generation !== this.submitterGeneration ||
        key !== this.submitterKey(concern)
      ) return;

      const response = await fetch(
        SUBMITTER_ENDPOINT,
        {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',

          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },

          body: JSON.stringify({
            action: 'submitter',
            concern_id: concern.concern_id,
          }),

          signal: AbortSignal.timeout(30000),
        }
      );

      const data = await response
        .json()
        .catch(() => null);

      if (
        generation !== this.submitterGeneration ||
        key !== this.submitterKey(concern)
      ) return;

      if (!response.ok) {
        throw new Error(
          typeof data?.error === 'string'
            ? data.error
            : 'Unable to load the submitter. Please try again.'
        );
      }

      if (
        data?.concern_id !== concern.concern_id ||
        typeof data.name !== 'string' ||
        typeof data.resident_id !== 'string'
      ) {
        throw new Error(
          'The submitter response was invalid.'
        );
      }

      const name =
        data.name.trim() ||
        'Name not recorded';

      const residentId =
        data.resident_id.trim();

      this.submitterValue =
        /^[1-9]\d*$/.test(residentId)
          ? `${name} (Resident ID: ${residentId})`
          : `${name} (Resident ID not assigned)`;

      this.submitterLoadedKey = key;
    } catch (error: unknown) {
      if (
        !this.submitterDestroyed &&
        generation === this.submitterGeneration &&
        key === this.submitterKey(concern)
      ) {
        this.submitterError.set(
          error instanceof Error
            ? error.message
            : 'Unable to load resident information. Please try again.'
        );
      }
    } finally {
      if (
        generation === this.submitterGeneration
      ) {
        this.submitterLoading.set(false);
      }
    }
  }

  clearSubmitter(): void {
    ++this.submitterGeneration;

    this.submitterRequestKey = '';
    this.submitterLoadedKey = '';
    this.submitterValue = '';

    this.submitterLoading.set(false);
    this.submitterError.set('');
  }

  reload(): void {
    const generation = ++this.generation;

    this.stopProfile?.();
    this.stopRecords?.();
    this.stopOffices?.();
    this.stopResidents?.();

    this.activeRole = '';
    this.accessUid.set('');
    this.officeId.set('');

    this.residentProfiles.set(new Map());
    this.adminResidentLoading.set(false);
    this.adminResidentError.set('');

    this.offices.clear();
    this.clearRecords();

    this.failure.set('');
    this.busy.set(true);

    const user = this.auth.currentUser;

    if (!user) {
      this.busy.set(false);
      return;
    }

    this.stopProfile = onSnapshot(
      doc(this.db, 'users', user.uid),
      snapshot => {
        if (generation !== this.generation) return;

        const profileGeneration =
          ++this.profileGeneration;

        this.stopRecords?.();
        this.stopOffices?.();
        this.stopResidents?.();

        this.activeRole = '';
        this.accessUid.set('');
        this.officeId.set('');

        this.residentProfiles.set(new Map());
        this.adminResidentLoading.set(false);
        this.adminResidentError.set('');

        this.offices.clear();
        this.clearRecords();
        this.failure.set('');

        const profile = snapshot.data();

        if (
          !profile ||
          profile['accountStatus'] !== 'approved' ||
          !['resident', 'personnel', 'admin']
            .includes(profile['role'])
        ) {
          this.busy.set(false);
          this.failure.set(
            'An approved account is required.'
          );
          return;
        }

        this.busy.set(true);
        this.activeRole = profile['role'];

        const resident =
          this.activeRole === 'resident';

        const personnel =
          this.activeRole === 'personnel';

        const assignedOffice =
          profile['officeId'];

        if (
          personnel &&
          (
            typeof assignedOffice !== 'string' ||
            !assignedOffice.trim() ||
            assignedOffice !== assignedOffice.trim() ||
            assignedOffice.includes('/')
          )
        ) {
          this.busy.set(false);
          this.failure.set(
            'Your personnel account has no valid assigned office. Contact the administrator.'
          );
          return;
        }

        this.accessUid.set(user.uid);
        this.officeId.set(
          personnel ? assignedOffice : ''
        );

        if (this.activeRole === 'admin') {
          this.adminResidentLoading.set(true);

          this.stopResidents = onSnapshot(
            query(
              collection(this.db, 'users'),
              where('role', '==', 'resident')
            ),
            result => {
              if (
                generation !== this.generation ||
                profileGeneration !== this.profileGeneration
              ) return;

              this.residentProfiles.set(
                new Map(
                  result.docs.map(item => {
                    const data = item.data();

                    return [
                      item.id,
                      {
                        name:
                          typeof data['name'] === 'string'
                            ? data['name'].trim()
                            : 'Name not recorded',
                        id:
                          typeof data['residentId'] === 'string'
                            ? data['residentId'].trim()
                            : '',
                      },
                    ];
                  })
                )
              );

              this.adminResidentLoading.set(false);
              this.adminResidentError.set('');
            },
            () => {
              if (
                generation !== this.generation ||
                profileGeneration !== this.profileGeneration
              ) return;

              this.residentProfiles.set(new Map());
              this.adminResidentLoading.set(false);
              this.adminResidentError.set(
                'Unable to load resident information. Try again.'
              );
            }
          );
        }

        this.stopOffices = onSnapshot(
          collection(this.db, 'offices'),
          result => {
            if (
              generation !== this.generation ||
              profileGeneration !== this.profileGeneration
            ) return;

            this.offices = new Map(
              result.docs.map(item => [
                item.id,
                {
                  office_id: item.id,
                  office_name:
                    item.data()['office_name'],
                  description:
                    item.data()['description'],
                },
              ])
            );

            this.records.update(items =>
              items.map(item => ({
                ...item,
                office: item.office_id
                  ? this.offices.get(item.office_id)
                  : undefined,
              }))
            );
          },
          () => {
            if (
              generation !== this.generation ||
              profileGeneration !== this.profileGeneration
            ) return;

            this.offices.clear();

            this.records.update(items =>
              items.map(item => ({
                ...item,
                office: undefined,
              }))
            );
          }
        );

        const scopedQuery = resident
          ? query(
              collection(this.db, 'concerns'),
              where('resident_id', '==', user.uid)
            )
          : personnel
            ? query(
                collection(this.db, 'concerns'),
                where('office_id', '==', assignedOffice)
              )
            : query(
                collection(this.db, 'concerns')
              );

        this.stopRecords = onSnapshot(
          scopedQuery,
          result => {
            if (
              generation !== this.generation ||
              profileGeneration !== this.profileGeneration
            ) return;

            const concerns = result.docs
              .map(item =>
                this.toConcern(
                  item.id,
                  item.data()
                )
              )
              .sort((a, b) =>
                b.reported_at.localeCompare(
                  a.reported_at
                )
              );

            this.records.set(concerns);
            this.busy.set(false);
            this.failure.set('');

            if (this.activeRole !== 'admin') {
              this.loadPhotos(generation);
            }
          },
          error => {
            if (
              generation !== this.generation ||
              profileGeneration !== this.profileGeneration
            ) return;

            this.clearRecords();
            this.busy.set(false);
            this.failure.set(
              this.errorMessage(error)
            );
          }
        );
      },
      error => {
        if (generation !== this.generation) return;

        ++this.profileGeneration;

        this.stopRecords?.();
        this.stopOffices?.();
        this.stopResidents?.();

        this.activeRole = '';
        this.accessUid.set('');
        this.officeId.set('');

        this.residentProfiles.set(new Map());
        this.adminResidentLoading.set(false);
        this.adminResidentError.set('');

        this.offices.clear();
        this.clearRecords();

        this.busy.set(false);
        this.failure.set(
          this.errorMessage(error)
        );
      }
    );
  }

  submittedBy(
    concern: ConcernWithRelations
  ): string {
    const resident =
      this.residentProfiles().get(
        concern.resident_id
      );

    if (!resident) {
      return 'Resident record unavailable';
    }

    const name =
      resident.name ||
      'Name not recorded';

    return /^[1-9]\d*$/.test(resident.id)
      ? `${name} (Resident ID: ${resident.id})`
      : name;
  }

  async selectPhoto(
    concern: ConcernWithRelations | null,
    force = false
  ): Promise<void> {
    const path = concern?.photo_path || '';

    const key = path
      ? `${concern?.concern_id}:${path}`
      : '';

    if (
      !force &&
      key === this.selectedPhotoKey
    ) return;

    this.clearSelectedPhoto();
    this.selectedPhotoKey = key;

    const uid = this.auth.currentUser?.uid;

    if (
      !path ||
      !uid ||
      this.activeRole !== 'admin'
    ) return;

    const generation = this.generation;
    const photoGeneration =
      this.selectedPhotoGeneration;

    this.photoLoading.set(true);

    try {
      const blob =
        await this.photoService.download(path);

      if (
        generation !== this.generation ||
        photoGeneration !== this.selectedPhotoGeneration ||
        this.auth.currentUser?.uid !== uid ||
        this.activeRole !== 'admin'
      ) return;

      this.photoUrl.set(
        URL.createObjectURL(blob)
      );
    } catch (error: unknown) {
      if (
        generation === this.generation &&
        photoGeneration === this.selectedPhotoGeneration
      ) {
        this.photoFailure.set(
          error instanceof Error
            ? error.message
            : 'Unable to load this photo.'
        );
      }
    } finally {
      if (
        photoGeneration === this.selectedPhotoGeneration
      ) {
        this.photoLoading.set(false);
      }
    }
  }

  imageFailed(): void {
    if (this.photoUrl()) {
      URL.revokeObjectURL(this.photoUrl());
    }

    this.photoUrl.set('');
    this.photoFailure.set(
      'This photo could not be displayed. Try loading it again.'
    );
  }

  private clearSelectedPhoto(): void {
    ++this.selectedPhotoGeneration;
    this.selectedPhotoKey = '';

    if (this.photoUrl()) {
      URL.revokeObjectURL(this.photoUrl());
    }

    this.photoUrl.set('');
    this.photoLoading.set(false);
    this.photoFailure.set('');
  }

  submitConcern(
    payload: ConcernPayload,
    photo: File | null
  ): Observable<ConcernResponse> {
    return defer(() =>
      this.createConcern(payload, photo)
    );
  }

  private async createConcern(
    payload: ConcernPayload,
    photo: File | null
  ): Promise<ConcernResponse> {
    const user =
      await this.requireRole('resident');

    const category =
      this.categoryService.getById(
        payload.category_id
      );

    const location =
      payload.location_description.trim();

    const description =
      payload.description.trim();

    if (
      !category ||
      !location ||
      location.length > 255 ||
      !description ||
      description.length > 5000
    ) {
      throw new Error(
        'Provide a valid category, location, and description.'
      );
    }

    if (
      photo &&
      (
        ![
          'image/jpeg',
          'image/png',
          'image/webp',
        ].includes(photo.type) ||
        photo.size <= 0 ||
        photo.size > 5 * 1024 * 1024
      )
    ) {
      throw new Error(
        'Select a JPG, PNG, or WebP photo no larger than 5 MB.'
      );
    }

    const concernRef = doc(
      collection(this.db, 'concerns')
    );

    const submissionAuditRef = doc(
      this.db,
      'audit_logs',
      `concern_submitted_${concernRef.id}`
    );

    const photoPath = photo
      ? `concern-photos/${user.uid}/${concernRef.id}/photo`
      : null;

    let uploaded = false;

    try {
      if (photo && photoPath) {
        await this.photoService.upload(
          concernRef.id,
          photo,
          user.uid
        );

        uploaded = true;
      }

      if (
        this.auth.currentUser?.uid !== user.uid
      ) {
        throw new Error(
          'Your login changed. Sign in again.'
        );
      }

      const numbers = await runTransaction(
        this.db,
        async transaction => {
          const officeId =
            await this.categoryService.getOfficeId(
              payload.category_id,
              transaction
            );

          const counterRef = doc(
            this.db,
            'counters',
            'concerns'
          );

          const residentCounterRef = doc(
            this.db,
            'resident_concern_counters',
            user.uid
          );

          const residentRef = doc(
            this.db,
            'users',
            user.uid
          );

          const [
            counterSnapshot,
            residentCounterSnapshot,
            residentSnapshot,
          ] = await Promise.all([
            transaction.get(counterRef),
            transaction.get(residentCounterRef),
            transaction.get(residentRef),
          ]);

          const resident =
            residentSnapshot.data();

          if (
            resident?.['role'] !== 'resident' ||
            resident?.['accountStatus'] !== 'approved'
          ) {
            throw new Error(
              'An approved resident account is required.'
            );
          }

          const residentName =
            typeof resident['name'] === 'string' &&
            resident['name'].length > 0
              ? resident['name']
              : 'Resident';

          const lastNumber =
            counterSnapshot.data()?.['last_number'];

          if (
            !counterSnapshot.exists() ||
            !Number.isSafeInteger(lastNumber) ||
            lastNumber < 0 ||
            lastNumber >= Number.MAX_SAFE_INTEGER
          ) {
            throw new Error(
              'The concern counter is unavailable or invalid. Please contact the barangay.'
            );
          }

          const residentLastNumber =
            residentCounterSnapshot.exists()
              ? residentCounterSnapshot.data()['last_number']
              : 0;

          if (
            !Number.isSafeInteger(residentLastNumber) ||
            residentLastNumber < 0 ||
            residentLastNumber >= Number.MAX_SAFE_INTEGER
          ) {
            throw new Error(
              'Your personal concern counter is invalid. Contact the barangay.'
            );
          }

          const nextNumber = lastNumber + 1;

          const residentNumber =
            residentLastNumber + 1;

          if (
            this.auth.currentUser?.uid !== user.uid
          ) {
            throw new Error(
              'Your login changed. Sign in again.'
            );
          }

          transaction.set(concernRef, {
            concern_number: nextNumber,
            resident_concern_number: residentNumber,
            resident_id: user.uid,
            assigned_personnel_id: null,
            office_id: officeId,
            category_id: payload.category_id,
            location_description: location,
            description,
            photo_path: photoPath,
            current_status: 'Pending',
            reported_at: serverTimestamp(),
            updated_at: null,
            updates: {},
            revision: 0,
          });

          transaction.update(counterRef, {
            last_number: nextNumber,
            last_concern_id: concernRef.id,
          });

          transaction.set(residentCounterRef, {
            last_number: residentNumber,
            last_concern_id: concernRef.id,
          });

          transaction.set(submissionAuditRef, {
            user_id: user.uid,
            user_name: residentName,
            user_role: 'resident',
            category: 'Concern',
            action: 'Concern submitted',
            entity_type: 'concern',
            entity_id: concernRef.id,
            concern_number: nextNumber,
            resident_concern_number: residentNumber,
            details:
              `Concern #${nextNumber} submitted.`,
            created_at: serverTimestamp(),
          });

          return {
            shared: nextNumber,
            personal: residentNumber,
          };
        }
      );

      return {
        concern_id: concernRef.id,
        concern_number: numbers.shared,
        resident_concern_number: numbers.personal,
        message:
          `Concern #${numbers.personal} saved to Firebase.`,
      };
    } catch (error) {
      if (uploaded && photoPath) {
        await this.photoService
          .cleanup(
            concernRef.id,
            user.uid
          )
          .catch(() => undefined);
      }

      throw new Error(
        this.errorMessage(error)
      );
    }
  }

  async updateStatus(
    concernId: string,
    newStatus: ConcernStatus,
    remarks: string,
    expectedStatus?: ConcernStatus
  ): Promise<ConcernWithRelations> {
    const user =
      await this.requireRole('personnel');

    if (
      !STATUSES.includes(newStatus) ||
      remarks.length > 2000
    ) {
      throw new Error(
        'Choose a valid status and use at most 2000 characters for remarks.'
      );
    }

    const concernRef = doc(
      this.db,
      'concerns',
      concernId
    );

    await runTransaction(
      this.db,
      async transaction => {
        const personnelSnapshot =
          await transaction.get(
            doc(
              this.db,
              'users',
              user.uid
            )
          );

        const snapshot =
          await transaction.get(concernRef);

        if (!snapshot.exists()) {
          throw new Error(
            'Concern not found.'
          );
        }

        const personnel =
          personnelSnapshot.data();

        const data = snapshot.data();

        if (
          personnel?.['role'] !== 'personnel' ||
          personnel?.['accountStatus'] !== 'approved'
        ) {
          throw new Error(
            'An approved personnel account is required.'
          );
        }

        if (
          this.auth.currentUser?.uid !== user.uid
        ) {
          throw new Error(
            'Your login changed. Sign in again.'
          );
        }

        const officeId =
          personnel['officeId'];

        if (
          typeof officeId !== 'string' ||
          !officeId.trim() ||
          officeId !== officeId.trim() ||
          officeId.includes('/') ||
          data['office_id'] !== officeId
        ) {
          throw new Error(
            'You can update only concerns assigned to your office.'
          );
        }

        const personnelName =
          typeof personnel['name'] === 'string' &&
          personnel['name'].length > 0
            ? personnel['name']
            : 'Personnel';

        const previousStatus =
          data['current_status'];

        if (
          !STATUSES.includes(previousStatus)
        ) {
          throw new Error(
            'The existing concern status is invalid.'
          );
        }

        if (
          expectedStatus !== undefined &&
          previousStatus !== expectedStatus
        ) {
          throw new Error(
            'This concern status changed. Review the latest status and try again.'
          );
        }

        const progressOnly =
          previousStatus === newStatus;

        if (
          progressOnly &&
          !remarks.trim()
        ) {
          throw new Error(
            'Enter a progress note or select a different status.'
          );
        }

        const previousRevision =
          data['revision'];

        const concernNumber =
          data['concern_number'];

        if (
          !Number.isSafeInteger(previousRevision) ||
          previousRevision < 0 ||
          previousRevision >= Number.MAX_SAFE_INTEGER
        ) {
          throw new Error(
            'The concern revision is invalid. Contact the administrator.'
          );
        }

        if (
          !Number.isSafeInteger(concernNumber) ||
          concernNumber <= 0
        ) {
          throw new Error(
            'The concern number is invalid. Contact the administrator.'
          );
        }

        const revision =
          previousRevision + 1;

        const auditRef = doc(
          this.db,
          'audit_logs',
          `concern_${concernId}_${revision}`
        );

        transaction.update(concernRef, {
          current_status: newStatus,
          updated_at: serverTimestamp(),
          revision,

          updates: {
            ...data['updates'],

            [String(revision)]: {
              update_id: revision,
              previous_status: previousStatus,
              new_status: newStatus,
              remarks: remarks.trim() || null,
              created_at: serverTimestamp(),
              updated_by: user.uid,
              updated_by_name: personnelName,
            },
          },
        });

        transaction.set(auditRef, {
          user_id: user.uid,
          user_name: personnelName,
          user_role: 'personnel',
          category: 'Concern',

          action: progressOnly
            ? 'Progress update added'
            : 'Status changed',

          entity_type: 'concern',
          entity_id: concernId,
          concern_number: concernNumber,
          revision,
          previous_status: previousStatus,
          new_status: newStatus,

          details: progressOnly
            ? `Concern #${concernNumber}: Progress update added; status remains ${newStatus}.`
            : `Concern #${concernNumber}: ${previousStatus} → ${newStatus}`,

          created_at: serverTimestamp(),
        });
      }
    );

    const saved =
      await getDoc(concernRef);

    if (!saved.exists()) {
      throw new Error(
        'Saved concern is unavailable.'
      );
    }

    return this.toConcern(
      saved.id,
      saved.data()
    );
  }

  private async requireRole(
    role: 'resident' | 'personnel'
  ) {
    await this.auth.authStateReady();

    const user =
      this.auth.currentUser;

    if (!user) {
      throw new Error(
        'Please sign in first.'
      );
    }

    const profile = (
      await getDoc(
        doc(
          this.db,
          'users',
          user.uid
        )
      )
    ).data();

    if (
      this.auth.currentUser?.uid !== user.uid
    ) {
      throw new Error(
        'Your login changed. Sign in again.'
      );
    }

    if (
      profile?.['role'] !== role ||
      profile?.['accountStatus'] !== 'approved'
    ) {
      throw new Error(
        `An approved ${role} account is required.`
      );
    }

    return user;
  }

  private iso(value: unknown): string {
    return value instanceof Timestamp
      ? value.toDate().toISOString()
      : '';
  }

  private toConcern(
    id: string,
    data: DocumentData
  ): ConcernWithRelations {
    const entries = Object.values(
      data['updates'] ?? {}
    ) as DocumentData[];

    const updates: ConcernUpdate[] = entries
      .map(update => ({
        update_id: update['update_id'],
        previous_status:
          update['previous_status'],
        new_status:
          update['new_status'],
        remarks:
          update['remarks'],
        created_at:
          this.iso(update['created_at']),
        updated_by:
          update['updated_by'],

        updated_by_name:
          typeof update['updated_by_name'] === 'string'
            ? update['updated_by_name']
            : undefined,

        updated_by_label:
          this.personnelLabel(
            update['updated_by_name'],
            update['updated_by']
          ),
      }))
      .sort(
        (a, b) =>
          a.update_id - b.update_id
      );

    const latestUpdate =
      updates[updates.length - 1];

    return {
      concern_id: id,

      concern_number:
        Number.isSafeInteger(data['concern_number']) &&
        data['concern_number'] > 0
          ? data['concern_number']
          : null,

      resident_concern_number:
        Number.isSafeInteger(data['resident_concern_number']) &&
        data['resident_concern_number'] > 0
          ? data['resident_concern_number']
          : null,

      resident_id:
        data['resident_id'],

      assigned_personnel_id:
        data['assigned_personnel_id'] ?? null,

      office_id:
        data['office_id'] ?? null,

      office:
        this.offices.get(
          data['office_id']
        ),

      last_updated_by:
        latestUpdate?.updated_by ?? null,

      last_updated_by_name:
        latestUpdate?.updated_by_name ?? null,

      last_updated_by_label:
        latestUpdate
          ? latestUpdate.updated_by_label
          : 'No personnel update yet',

      category_id:
        data['category_id'],

      category:
        this.categoryService.getById(
          data['category_id']
        ),

      location_description:
        data['location_description'],

      description:
        data['description'],

      photo_path:
        data['photo_path'],

      photo_url:
        this.objectUrls.get(
          data['photo_path']
        ) ?? null,

      current_status:
        data['current_status'],

      reported_at:
        this.iso(
          data['reported_at']
        ),

      updated_at:
        data['updated_at']
          ? this.iso(data['updated_at'])
          : null,

      updates,
    };
  }

  private personnelLabel(
    name: unknown,
    uid: unknown
  ): string {
    const label =
      typeof name === 'string'
        ? name.trim()
        : '';

    if (label) {
      return label === 'Personnel'
        ? label
        : `${label} Personnel`;
    }

    return uid
      ? 'Personnel (name not recorded)'
      : 'Updater not recorded';
  }

  private loadPhotos(
    generation: number
  ): void {
    const photoGeneration =
      ++this.photoGeneration;

    this.photoFailure.set('');

    const visiblePaths = new Set(
      this.records()
        .map(item => item.photo_path)
        .filter(Boolean)
    );

    for (
      const [path, url]
      of this.objectUrls
    ) {
      if (!visiblePaths.has(path)) {
        URL.revokeObjectURL(url);
        this.objectUrls.delete(path);
      }
    }

    for (
      const concern
      of this.records()
    ) {
      const path =
        concern.photo_path;

      if (
        !path ||
        this.objectUrls.has(path)
      ) continue;

      void this.photoService.download(path)
        .then(blob => {
          if (
            generation !== this.generation ||
            photoGeneration !== this.photoGeneration
          ) return;

          const url =
            URL.createObjectURL(blob);

          this.objectUrls.set(path, url);

          this.records.update(items =>
            items.map(item =>
              item.photo_path === path
                ? {
                    ...item,
                    photo_url: url,
                  }
                : item
            )
          );
        })
        .catch(() => {
          if (
            generation === this.generation &&
            photoGeneration === this.photoGeneration
          ) {
            this.photoFailure.set(
              'A photo could not be loaded. Check your connection and photo access.'
            );
          }
        });
    }
  }

  private clearRecords(): void {
    this.clearSubmitter();
    this.clearSelectedPhoto();

    ++this.photoGeneration;

    this.records.set([]);
    this.photoFailure.set('');

    for (
      const url
      of this.objectUrls.values()
    ) {
      URL.revokeObjectURL(url);
    }

    this.objectUrls.clear();
  }

  private errorMessage(
    error: unknown
  ): string {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error
        ? String(error.code)
        : '';

    if (
      code.includes('permission-denied')
    ) {
      return 'Access denied. Check account approval, office assignment, and Firestore rules.';
    }

    if (
      code.includes('unavailable')
    ) {
      return 'Firebase is unavailable. Check your connection and retry.';
    }

    return error instanceof Error
      ? error.message
      : 'Unable to access concern records.';
  }

  ngOnDestroy(): void {
    this.submitterDestroyed = true;
    ++this.generation;

    this.stopAuth?.();
    this.stopProfile?.();
    this.stopRecords?.();
    this.stopOffices?.();
    this.stopResidents?.();

    this.activeRole = '';
    this.accessUid.set('');
    this.officeId.set('');

    this.residentProfiles.set(new Map());
    this.adminResidentLoading.set(false);
    this.adminResidentError.set('');

    this.offices.clear();
    this.clearRecords();
  }
}