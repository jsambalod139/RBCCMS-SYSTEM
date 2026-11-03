import {
  Injectable,
  OnDestroy,
  signal,
} from '@angular/core';

import {
  BehaviorSubject,
  Observable,
} from 'rxjs';

import {
  getAuth,
  onAuthStateChanged,
} from 'firebase/auth';

import {
  Transaction,
  collection,
  doc,
  getFirestore,
  onSnapshot,
} from 'firebase/firestore';

import { firebaseApp } from '../firebase.config';
import { ConcernCategory } from '../models/concern.model';

interface CategoryRecord extends ConcernCategory {
  active: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConcernCategoryService implements OnDestroy {
  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  private readonly records =
    signal<CategoryRecord[]>([]);

  private readonly available =
    new BehaviorSubject<ConcernCategory[]>([]);

  readonly loading = signal(true);
  readonly error = signal('');

  private stopAuth?: () => void;
  private stopProfile?: () => void;
  private stopCategories?: () => void;

  private generation = 0;
  private listGeneration = 0;

  constructor() {
    this.stopAuth = onAuthStateChanged(
      this.auth,
      () => this.reload()
    );
  }

  reload(): void {
    const generation = ++this.generation;

    this.stopProfile?.();
    this.stopProfile = undefined;
    this.clear();

    this.loading.set(true);
    this.error.set('');

    const user = this.auth.currentUser;

    if (!user) {
      this.loading.set(false);
      this.error.set(
        'Please sign in to load concern categories.'
      );
      return;
    }

    this.stopProfile = onSnapshot(
      doc(this.db, 'users', user.uid),
      snapshot => {
        if (generation !== this.generation) return;

        this.clear();

        const profile = snapshot.data();

        if (
          profile?.['accountStatus'] !== 'approved' ||
          !['resident', 'personnel', 'admin'].includes(
            profile?.['role']
          )
        ) {
          this.loading.set(false);
          this.error.set(
            'An approved account is required to load categories.'
          );
          return;
        }

        this.loading.set(true);
        this.error.set('');

        const listGeneration = this.listGeneration;

        const current = (): boolean =>
          generation === this.generation &&
          listGeneration === this.listGeneration;

        this.stopCategories = onSnapshot(
          collection(this.db, 'categories'),
          result => {
            if (!current()) return;

            const rows: CategoryRecord[] = [];

            for (const item of result.docs) {
              const id = Number(item.id);
              const data = item.data();

              const name =
                typeof data['category_name'] === 'string'
                  ? data['category_name'].trim()
                  : '';

              if (
                !Number.isSafeInteger(id) ||
                id < 1 ||
                String(id) !== item.id ||
                !name
              ) {
                continue;
              }

              rows.push({
                category_id: id,
                category_name: name,
                active: data['is_active'] === true,
              });
            }

            rows.sort((a, b) => {
              const aIsOther = this.isOtherCategory(a);
              const bIsOther = this.isOtherCategory(b);

              if (aIsOther !== bIsOther) {
                return aIsOther ? 1 : -1;
              }

              return a.category_id - b.category_id;
            });

            this.records.set(rows);

            this.available.next(
              rows
                .filter(row => row.active)
                .map(row => ({
                  category_id: row.category_id,
                  category_name: row.category_name,
                }))
            );

            this.loading.set(false);
            this.error.set('');
          },
          () => {
            if (!current()) return;

            this.records.set([]);
            this.available.next([]);
            this.loading.set(false);
            this.error.set(
              'Unable to load concern categories. Please try again.'
            );
          }
        );
      },
      () => {
        if (generation !== this.generation) return;

        this.clear();
        this.loading.set(false);
        this.error.set(
          'Unable to verify access to concern categories.'
        );
      }
    );
  }

  private isOtherCategory(
    category: ConcernCategory
  ): boolean {
    return (
      category.category_id === 8 ||
      category.category_name
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase() === 'other community concerns'
    );
  }

  getCategories(): Observable<ConcernCategory[]> {
    return this.available.asObservable();
  }

  getById(
    categoryId: number
  ): ConcernCategory | undefined {
    if (
      !Number.isSafeInteger(categoryId) ||
      categoryId < 1
    ) {
      return undefined;
    }

    const records = this.records;

    return {
      category_id: categoryId,

      get category_name(): string {
        return (
          records().find(
            row => row.category_id === categoryId
          )?.category_name ||
          `Category ${categoryId}`
        );
      },
    };
  }

  async getOfficeId(
    categoryId: number,
    transaction: Transaction
  ): Promise<string> {
    if (
      !Number.isSafeInteger(categoryId) ||
      categoryId < 1
    ) {
      throw new Error(
        'Select a valid concern category.'
      );
    }

    const categorySnapshot = await transaction.get(
      doc(this.db, 'categories', String(categoryId))
    );

    const category = categorySnapshot.data();
    const officeId = category?.['office_id'];

    if (
      category?.['is_active'] !== true ||
      typeof officeId !== 'string' ||
      !officeId.trim() ||
      officeId.includes('/')
    ) {
      throw new Error(
        'This category has no active responsible office configured. ' +
        'Please contact the barangay.'
      );
    }

    const officeSnapshot = await transaction.get(
      doc(this.db, 'offices', officeId)
    );

    if (!officeSnapshot.exists()) {
      throw new Error(
        'The responsible office is unavailable. ' +
        'Please contact the barangay.'
      );
    }

    return officeId;
  }

  private clear(): void {
    ++this.listGeneration;

    this.stopCategories?.();
    this.stopCategories = undefined;

    this.records.set([]);
    this.available.next([]);
  }

  ngOnDestroy(): void {
    ++this.generation;

    this.stopAuth?.();
    this.stopProfile?.();
    this.clear();

    this.available.complete();
  }
}