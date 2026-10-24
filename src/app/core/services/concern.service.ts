import {
  Injectable,
  OnDestroy,
  inject,
  signal
} from '@angular/core';

import { Observable, defer } from 'rxjs';

import {
  getAuth,
  onAuthStateChanged
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
  where
} from 'firebase/firestore';

import { firebaseApp } from '../firebase.config';

import {
  ConcernOffice,
  ConcernPayload,
  ConcernResponse,
  ConcernStatus,
  ConcernUpdate,
  ConcernWithRelations
} from '../models/concern.model';

import {
  ConcernCategoryService
} from './concern-category.service';

import {
  ConcernPhotoService
} from './concern-photo.service';

const STATUSES: ConcernStatus[] = [
  'Pending',
  'In Progress',
  'Resolved',
  'Rejected'
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

  private stopAuth?: Unsubscribe;
  private stopProfile?: Unsubscribe;
  private stopRecords?: Unsubscribe;
  private stopOffices?: Unsubscribe;

  private offices = new Map<string, ConcernOffice>();

  private generation = 0;
  private profileGeneration = 0;
  private photoGeneration = 0;

  private readonly objectUrls =
    new Map<string, string>();

  constructor() {
    this.stopAuth = onAuthStateChanged(
      this.auth,
      () => this.reload()
    );
  }

  reload(): void {
    const generation = ++this.generation;

    this.stopProfile?.();
    this.stopRecords?.();
    this.stopOffices?.();

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

        this.offices.clear();
        this.clearRecords();
        this.failure.set('');

        const profile = snapshot.data();

        if (
          !profile ||
          profile['accountStatus'] !== 'approved' ||
          !['resident', 'personnel'].includes(profile['role'])
        ) {
          this.busy.set(false);

          this.failure.set(
            'An approved resident or personnel account is required.'
          );

          return;
        }

        this.busy.set(true);

        const resident =
          profile['role'] === 'resident';

        this.stopOffices = onSnapshot(
          collection(this.db, 'offices'),

          result => {
            if (
              generation !== this.generation ||
              profileGeneration !== this.profileGeneration
            ) {
              return;
            }

            this.offices = new Map(
              result.docs.map(item => [
                item.id,
                {
                  office_id: item.id,
                  office_name: item.data()['office_name'],
                  description: item.data()['description']
                }
              ])
            );

            this.records.update(items =>
              items.map(item => ({
                ...item,

                office: item.office_id
                  ? this.offices.get(item.office_id)
                  : undefined
              }))
            );
          },

          () => {
            if (
              generation !== this.generation ||
              profileGeneration !== this.profileGeneration
            ) {
              return;
            }

            this.offices.clear();

            this.records.update(items =>
              items.map(item => ({
                ...item,
                office: undefined
              }))
            );
          }
        );

        const scopedQuery = resident
          ? query(
              collection(this.db, 'concerns'),
              where('resident_id', '==', user.uid)
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
            ) {
              return;
            }

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

            this.loadPhotos(generation);
          },

          error => {
            if (
              generation !== this.generation ||
              profileGeneration !== this.profileGeneration
            ) {
              return;
            }

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

        this.offices.clear();
        this.clearRecords();

        this.busy.set(false);

        this.failure.set(
          this.errorMessage(error)
        );
      }
    );
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
        !['image/jpeg', 'image/png', 'image/webp']
          .includes(photo.type) ||
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

      if (this.auth.currentUser?.uid !== user.uid) {
        throw new Error(
          'Your login changed. Sign in again.'
        );
      }

      const concernNumber =
        await runTransaction(
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

            const counterSnapshot =
              await transaction.get(counterRef);

            const lastNumber =
              counterSnapshot.data()?.['last_number'];

            if (
              !counterSnapshot.exists() ||
              !Number.isSafeInteger(lastNumber) ||
              lastNumber < 0 ||
              lastNumber >= Number.MAX_SAFE_INTEGER
            ) {
              throw new Error(
                'The concern counter is unavailable or invalid. ' +
                'Please contact the barangay.'
              );
            }

            const nextNumber = lastNumber + 1;

            if (
              this.auth.currentUser?.uid !== user.uid
            ) {
              throw new Error(
                'Your login changed. Sign in again.'
              );
            }

            transaction.set(concernRef, {
              concern_number: nextNumber,
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
              revision: 0
            });

            transaction.update(counterRef, {
              last_number: nextNumber,
              last_concern_id: concernRef.id
            });

            return nextNumber;
          }
        );

      return {
        concern_id: concernRef.id,
        concern_number: concernNumber,

        message:
          `Concern #${concernNumber} saved to Firebase.`
      };
    } catch (error) {
      if (uploaded && photoPath) {
        // Saved concern photos cannot be deleted by this cleanup.
        await this.photoService
          .cleanup(concernRef.id, user.uid)
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
    remarks: string
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
            doc(this.db, 'users', user.uid)
          );

        const snapshot =
          await transaction.get(concernRef);

        if (!snapshot.exists()) {
          throw new Error('Concern not found.');
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
          data['current_status'] === newStatus
        ) {
          throw new Error(
            'Select a different status.'
          );
        }

        const revision =
          Number(data['revision']) + 1;

        transaction.update(concernRef, {
          current_status: newStatus,
          updated_at: serverTimestamp(),
          revision,

          updates: {
            ...data['updates'],

            [String(revision)]: {
              update_id: revision,
              previous_status: data['current_status'],
              new_status: newStatus,
              remarks: remarks.trim() || null,
              created_at: serverTimestamp(),
              updated_by: user.uid
            }
          }
        });
      }
    );

    const saved = await getDoc(concernRef);

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

    const user = this.auth.currentUser;

    if (!user) {
      throw new Error(
        'Please sign in first.'
      );
    }

    const profile = (
      await getDoc(
        doc(this.db, 'users', user.uid)
      )
    ).data();

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
        previous_status: update['previous_status'],
        new_status: update['new_status'],
        remarks: update['remarks'],
        created_at: this.iso(update['created_at']),
        updated_by: update['updated_by']
      }))
      .sort((a, b) =>
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

      resident_id: data['resident_id'],

      assigned_personnel_id:
        data['assigned_personnel_id'] ?? null,

      office_id:
        data['office_id'] ?? null,

      office:
        this.offices.get(data['office_id']),

      last_updated_by:
        latestUpdate?.updated_by ?? null,

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
        this.iso(data['reported_at']),

      updated_at:
        data['updated_at']
          ? this.iso(data['updated_at'])
          : null,

      updates
    };
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

    for (const concern of this.records()) {
      const path = concern.photo_path;

      if (
        !path ||
        this.objectUrls.has(path)
      ) {
        continue;
      }

      void this.photoService
        .download(path)

        .then(blob => {
          if (
            generation !== this.generation ||
            photoGeneration !== this.photoGeneration
          ) {
            return;
          }

          const url =
            URL.createObjectURL(blob);

          this.objectUrls.set(path, url);

          this.records.update(items =>
            items.map(item =>
              item.photo_path === path
                ? {
                    ...item,
                    photo_url: url
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
      return (
        'Access denied. Check account approval and Firestore rules.'
      );
    }

    if (
      code.includes('unavailable')
    ) {
      return (
        'Firebase is unavailable. Check your connection and retry.'
      );
    }

    return error instanceof Error
      ? error.message
      : 'Unable to access concern records.';
  }

  ngOnDestroy(): void {
    ++this.generation;

    this.stopAuth?.();
    this.stopProfile?.();
    this.stopRecords?.();
    this.stopOffices?.();

    this.offices.clear();
    this.clearRecords();
  }
}