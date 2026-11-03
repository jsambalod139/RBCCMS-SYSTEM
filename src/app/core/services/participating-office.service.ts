import {
  Injectable,
  OnDestroy,
  signal,
} from '@angular/core';

import {
  getAuth,
  onAuthStateChanged,
} from 'firebase/auth';

import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  Unsubscribe,
  where,
} from 'firebase/firestore';

import { firebaseApp } from '../firebase.config';

export interface OfficeCategory {
  id: string;
  name: string;
  officeId: string;
  active: boolean;
}

export interface OfficePersonnel {
  uid: string;
  name: string;
  email: string;
  officeId: string;
  status: string;
}

export interface ParticipatingOffice {
  office_id: string;
  office_name: string;
  description: string;
  is_active: boolean;
}

export interface OfficeDeletionCheck {
  canDelete: boolean;
  officeName: string;
  reason: string;
  categoryNames: string[];
  categoryToken: string;
}

@Injectable({ providedIn: 'root' })
export class ParticipatingOfficeService
  implements OnDestroy {
  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  private readonly endpoint =
    'https://nlwjwvhjojnjrmlaykym.supabase.co/functions/v1/manage-offices';

  readonly records =
    signal<ParticipatingOffice[]>([]);

  readonly categories =
    signal<OfficeCategory[]>([]);

  readonly personnel =
    signal<OfficePersonnel[]>([]);

  readonly loading = signal(true);
  readonly error = signal('');

  private stopAuth?: Unsubscribe;
  private stopProfile?: Unsubscribe;
  private stops: Unsubscribe[] = [];

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
    this.clearLists();

    this.error.set('');
    this.loading.set(true);

    const user = this.auth.currentUser;

    if (!user) {
      this.loading.set(false);

      this.error.set(
        'Please sign in with an administrator account.'
      );

      return;
    }

    this.stopProfile = onSnapshot(
      doc(this.db, 'users', user.uid),

      snapshot => {
        if (generation !== this.generation) return;

        this.clearLists();

        const profile = snapshot.data();

        if (
          profile?.['role'] !== 'admin' ||
          profile['accountStatus'] !== 'approved'
        ) {
          this.loading.set(false);

          this.error.set(
            'An approved administrator account is required.'
          );

          return;
        }

        this.loading.set(true);
        this.error.set('');

        const listGeneration =
          this.listGeneration;

        const ready = new Set<string>();
        const failures =
          new Map<string, string>();

        const current = (): boolean =>
          generation === this.generation &&
          listGeneration === this.listGeneration;

        const finish = (
          key: string,
          message = ''
        ): void => {
          if (!current()) return;

          ready.add(key);

          if (message) {
            failures.set(key, message);
          } else {
            failures.delete(key);
          }

          this.loading.set(ready.size < 3);

          this.error.set(
            Array.from(
              failures.values()
            ).join(' ')
          );
        };

        this.stops.push(
          onSnapshot(
            collection(this.db, 'offices'),

            result => {
              if (!current()) return;

              this.records.set(
                result.docs
                  .map(item => {
                    const data = item.data();

                    return {
                      office_id: item.id,

                      office_name:
                        typeof data['office_name'] === 'string'
                          ? data['office_name']
                          : 'Unnamed office',

                      description:
                        typeof data['description'] === 'string'
                          ? data['description']
                          : '',

                      is_active:
                        data['is_active'] !== false,
                    };
                  })
                  .sort((a, b) =>
                    a.office_name.localeCompare(
                      b.office_name
                    )
                  )
              );

              finish('offices');
            },

            () => {
              if (!current()) return;

              this.records.set([]);

              finish(
                'offices',
                'Unable to load offices.'
              );
            }
          )
        );

        this.stops.push(
          onSnapshot(
            collection(this.db, 'categories'),

            result => {
              if (!current()) return;

              this.categories.set(
                result.docs
                  .map(item => {
                    const data = item.data();

                    return {
                      id: item.id,

                      name:
                        typeof data['category_name'] === 'string'
                          ? data['category_name']
                          : 'Unnamed category',

                      officeId:
                        typeof data['office_id'] === 'string'
                          ? data['office_id']
                          : '',

                      active:
                        data['is_active'] === true,
                    };
                  })
                  .sort((a, b) =>
                    a.name.localeCompare(b.name)
                  )
              );

              finish('categories');
            },

            () => {
              if (!current()) return;

              this.categories.set([]);

              finish(
                'categories',
                'Unable to load category assignments.'
              );
            }
          )
        );

        this.stops.push(
          onSnapshot(
            query(
              collection(this.db, 'users'),
              where('role', '==', 'personnel')
            ),

            result => {
              if (!current()) return;

              this.personnel.set(
                result.docs
                  .map(item => {
                    const data = item.data();

                    const text = (
                      key: string
                    ): string =>
                      typeof data[key] === 'string'
                        ? data[key]
                        : '';

                    return {
                      uid: item.id,
                      name:
                        text('name') || 'Personnel',
                      email: text('email'),
                      officeId: text('officeId'),
                      status: text('accountStatus'),
                    };
                  })
                  .sort((a, b) =>
                    a.name.localeCompare(b.name)
                  )
              );

              finish('personnel');
            },

            () => {
              if (!current()) return;

              this.personnel.set([]);

              finish(
                'personnel',
                'Unable to load assigned personnel.'
              );
            }
          )
        );
      },

      () => {
        if (generation !== this.generation) return;

        this.clearLists();
        this.loading.set(false);

        this.error.set(
          'Unable to verify administrator access.'
        );
      }
    );
  }

  categoriesFor(
    officeId: string
  ): OfficeCategory[] {
    return this.categories().filter(
      category =>
        category.officeId === officeId
    );
  }

  personnelFor(
    officeId: string
  ): OfficePersonnel[] {
    return this.personnel().filter(
      person =>
        person.officeId === officeId
    );
  }

  async createOffice(
    name: string,
    categoryName: string,
    description: string,
    active: boolean,
    requestId: string
  ): Promise<void> {
    await this.request({
      action: 'create-office',
      name: name.trim(),
      categoryName: categoryName.trim(),
      description: description.trim(),
      active,
      requestId,
    });
  }

  async updateOffice(
    officeId: string,
    name: string,
    description: string,
    active: boolean,
    requestId: string
  ): Promise<void> {
    await this.request({
      action: 'update-office',
      officeId,
      name: name.trim(),
      description: description.trim(),
      active,
      requestId,
    });
  }

  async createPersonnel(
    officeId: string,
    name: string,
    email: string,
    password: string,
    requestId: string
  ): Promise<void> {
    await this.request({
      action: 'create-personnel',
      officeId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      requestId,
    });
  }

  async checkOfficeDeletion(
    officeId: string
  ): Promise<OfficeDeletionCheck> {
    const result = await this.request({
      action: 'check-office-deletion',
      officeId,
      requestId: crypto.randomUUID(),
    });

    if (
      typeof result['canDelete'] !== 'boolean' ||
      typeof result['officeName'] !== 'string' ||
      typeof result['reason'] !== 'string' ||
      !Array.isArray(result['categoryNames']) ||
      !result['categoryNames'].every(
        (name: unknown) =>
          typeof name === 'string'
      ) ||
      typeof result['categoryToken'] !== 'string' ||
      !/^[0-9a-f]{64}$/.test(
        result['categoryToken']
      )
    ) {
      throw new Error(
        'Unable to verify office deletion eligibility.'
      );
    }

    return {
      canDelete: result['canDelete'],
      officeName: result['officeName'],
      reason: result['reason'],
      categoryNames:
        result['categoryNames'] as string[],
      categoryToken:
        result['categoryToken'] as string,
    };
  }

  async deleteOffice(
    officeId: string,
    expectedName: string,
    requestId: string,
    expectedCategoryToken: string
  ): Promise<void> {
    await this.request({
      action: 'delete-office',
      officeId,
      expectedName,
      requestId,
      expectedCategoryToken,
    });
  }

  private async request(
    body: object
  ): Promise<Record<string, unknown>> {
    const expectedUid =
      this.auth.currentUser?.uid;

    await this.auth.authStateReady();

    const user =
      this.auth.currentUser;

    if (
      !user ||
      !expectedUid ||
      user.uid !== expectedUid
    ) {
      throw new Error(
        'Your login changed. Please sign in again.'
      );
    }

    const uid = user.uid;
    const token = await user.getIdToken();

    if (
      this.auth.currentUser?.uid !== uid
    ) {
      throw new Error(
        'Your login changed. Please sign in again.'
      );
    }

    let response: Response;

    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',

        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },

        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error: unknown) {
      const name =
        error instanceof Error
          ? error.name
          : '';

      if (
        name === 'TimeoutError' ||
        name === 'AbortError'
      ) {
        throw new Error(
          'The server did not respond within 30 seconds. ' +
          'The change may still have completed. Check the directory ' +
          'before retrying the same details. For personnel creation, ' +
          'use the original password.'
        );
      }

      throw new Error(
        'The browser could not connect to manage-offices. ' +
        'Check the Network request for a CORS, network, or gateway error.'
      );
    }

    const result = await response
      .json()
      .catch(() => null);

    if (
      !response.ok ||
      result?.saved !== true
    ) {
      throw new Error(
        typeof result?.error === 'string'
          ? result.error
          : `The server returned HTTP ${response.status} without confirming the change. Check the function logs before retrying.`
      );
    }

    if (
      this.auth.currentUser?.uid !== uid
    ) {
      throw new Error(
        'Your login changed. Reload before continuing.'
      );
    }

    return result as Record<string, unknown>;
  }

  private clearLists(): void {
    ++this.listGeneration;

    for (const stop of this.stops) {
      stop();
    }

    this.stops = [];

    this.records.set([]);
    this.categories.set([]);
    this.personnel.set([]);
  }

  ngOnDestroy(): void {
    ++this.generation;

    this.stopAuth?.();
    this.stopProfile?.();
    this.clearLists();
  }
}