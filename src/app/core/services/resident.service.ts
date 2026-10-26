import {
  Injectable,
  OnDestroy,
  signal
} from '@angular/core';

import {
  getAuth,
  onAuthStateChanged
} from 'firebase/auth';

import {
  Timestamp,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  where
} from 'firebase/firestore';

import { firebaseApp } from '../firebase.config';

export interface ResidentRecord {
  uid: string;
  residentId: string;
  firstName: string;
  middleName: string;
  lastName: string;
  name: string;
  email: string;
  contactNumber: string;
  address: string;
  purok: string;
  accountStatus: string;
  residencyVerified: boolean;
  verifiedAt: string | null;
  createdBy: string;
  registrationRequestId: string;
  registrationState: string;
}

export interface ResidentInput {
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  password: string;
  contactNumber: string;
  address: string;
  purok: string;
  residencyVerified: boolean;
}

@Injectable({ providedIn: 'root' })
export class ResidentService implements OnDestroy {
  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  private readonly endpoint =
    'https://nlwjwvhjojnjrmlaykym.supabase.co/functions/v1/manage-residents';

  readonly residents = signal<ResidentRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  private stopAuth: () => void;
  private stopProfile?: () => void;
  private stopResidents?: () => void;

  private generation = 0;
  private profileGeneration = 0;

  constructor() {
    this.stopAuth = onAuthStateChanged(
      this.auth,
      () => this.reload()
    );
  }

  reload(): void {
    const generation = ++this.generation;

    this.stopProfile?.();
    this.stopResidents?.();

    this.residents.set([]);
    this.error.set('');
    this.loading.set(true);

    const user = this.auth.currentUser;

    if (!user) {
      this.loading.set(false);
      return;
    }

    this.stopProfile = onSnapshot(
      doc(this.db, 'users', user.uid),

      snapshot => {
        if (generation !== this.generation) return;

        const profileGeneration =
          ++this.profileGeneration;

        this.stopResidents?.();
        this.residents.set([]);

        const profile = snapshot.data();

        if (
          profile?.['role'] !== 'personnel' ||
          profile?.['accountStatus'] !== 'approved'
        ) {
          this.error.set(
            'An approved personnel account is required.'
          );

          this.loading.set(false);
          return;
        }

        this.loading.set(true);

        const residentsQuery = query(
          collection(this.db, 'users'),
          where('role', '==', 'resident')
        );

        this.stopResidents = onSnapshot(
          residentsQuery,

          result => {
            if (
              generation !== this.generation ||
              profileGeneration !== this.profileGeneration
            ) {
              return;
            }

            const residents = result.docs.map(item => {
              const data = item.data();

              const text = (key: string): string =>
                typeof data[key] === 'string'
                  ? data[key]
                  : '';

              const verifiedAt = data['verifiedAt'];

              return {
                uid: item.id,
                residentId: text('residentId') || item.id,
                firstName: text('firstName'),
                middleName: text('middleName'),
                lastName: text('lastName'),
                name: text('name'),
                email: text('email'),
                contactNumber: text('contactNumber'),
                address: text('address'),
                purok: text('purok'),
                accountStatus: text('accountStatus'),

                residencyVerified:
                  data['residencyVerified'] === true,

                verifiedAt:
                  verifiedAt instanceof Timestamp
                    ? verifiedAt.toDate().toISOString()
                    : null,

                createdBy: text('createdBy'),

                registrationRequestId:
                  text('registrationRequestId'),

                registrationState:
                  text('registrationState')
              };
            });

            residents.sort((a, b) =>
              a.name.localeCompare(b.name)
            );

            this.residents.set(residents);
            this.error.set('');
            this.loading.set(false);
          },

          () => {
            if (
              generation !== this.generation ||
              profileGeneration !== this.profileGeneration
            ) {
              return;
            }

            this.residents.set([]);

            this.error.set(
              'Unable to load residents. Check your connection and the users read rule.'
            );

            this.loading.set(false);
          }
        );
      },

      () => {
        if (generation !== this.generation) return;

        ++this.profileGeneration;

        this.stopResidents?.();
        this.residents.set([]);
        this.loading.set(false);

        this.error.set(
          'Unable to verify personnel access.'
        );
      }
    );
  }

  canResume(resident: ResidentRecord): boolean {
    return (
      resident.registrationState === 'incomplete' &&
      resident.createdBy === this.auth.currentUser?.uid
    );
  }

  create(
    input: ResidentInput,
    requestId: string
  ): Promise<string> {
    return this.request({
      ...input,
      action: 'create',
      requestId
    });
  }

  edit(
    uid: string,
    input: ResidentInput
  ): Promise<string> {
    // Credentials are excluded from ordinary profile edits.
    const {
      email: _email,
      password: _password,
      ...details
    } = input;

    return this.request({
      ...details,
      action: 'edit',
      uid
    });
  }

  private async request(
    body: object
  ): Promise<string> {
    await this.auth.authStateReady();

    const user = this.auth.currentUser;

    if (!user) {
      throw new Error('Please sign in.');
    }

    const token = await user.getIdToken();

    if (this.auth.currentUser?.uid !== user.uid) {
      throw new Error(
        'Your login changed. Sign in again.'
      );
    }

    let response: Response;

    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',

        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },

        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      });
    } catch {
      throw new Error(
        'Account setup could not be confirmed. Keep this form open and retry with the same details.'
      );
    }

    const result = await response
      .json()
      .catch(() => null);

    if (!response.ok) {
      throw new Error(
        result?.error || 'Unable to save this resident.'
      );
    }

    if (this.auth.currentUser?.uid !== user.uid) {
      throw new Error(
        'Your login changed. Sign in again.'
      );
    }

    return result?.message || 'Resident saved.';
  }

  ngOnDestroy(): void {
    ++this.generation;

    this.stopAuth();
    this.stopProfile?.();
    this.stopResidents?.();

    this.residents.set([]);
  }
}