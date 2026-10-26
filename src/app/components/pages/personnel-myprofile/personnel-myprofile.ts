import { CommonModule } from '@angular/common';

import {
  Component,
  OnDestroy,
  signal
} from '@angular/core';

import {
  getAuth,
  onAuthStateChanged
} from 'firebase/auth';

import {
  doc,
  getFirestore,
  onSnapshot
} from 'firebase/firestore';

import {
  firebaseApp
} from '../../../core/firebase.config';

import {
  PersonnelProfile
} from '../../../core/models/users.model';

@Component({
  selector: 'app-personnel-myprofile',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './personnel-myprofile.html',
  styleUrl: './personnel-myprofile.scss'
})
export class PersonnelMyprofile implements OnDestroy {
  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  private stopAuth?: () => void;
  private stopProfile?: () => void;
  private generation = 0;

  private readonly profileState =
    signal<PersonnelProfile | null>(null);

  private readonly loadingState =
    signal(true);

  private readonly errorState =
    signal('');

  get profile(): PersonnelProfile | null {
    return this.profileState();
  }

  get loading(): boolean {
    return this.loadingState();
  }

  get errorMessage(): string {
    return this.errorState();
  }

  constructor() {
    this.stopAuth = onAuthStateChanged(
      this.auth,
      () => this.loadProfile()
    );
  }

  loadProfile(): void {
    const generation = ++this.generation;

    this.stopProfile?.();

    this.profileState.set(null);
    this.errorState.set('');
    this.loadingState.set(true);

    const user = this.auth.currentUser;

    if (!user) {
      this.loadingState.set(false);

      this.errorState.set(
        'Please sign in to view your profile.'
      );

      return;
    }

    this.stopProfile = onSnapshot(
      doc(this.db, 'users', user.uid),

      snapshot => {
        if (generation !== this.generation) {
          return;
        }

        const data = snapshot.data();

        if (
          !data ||
          data['role'] !== 'personnel' ||
          data['accountStatus'] !== 'approved'
        ) {
          this.profileState.set(null);

          this.errorState.set(
            'Your approved personnel profile is unavailable. Contact the administrator.'
          );

          this.loadingState.set(false);
          return;
        }

        const name =
          typeof data['name'] === 'string'
            ? data['name'].trim()
            : '';

        const storedEmail =
          typeof data['email'] === 'string'
            ? data['email'].trim()
            : '';

        this.profileState.set({
          user_id: user.uid,
          name: name || 'Personnel',
          email: user.email || storedEmail,
          role_name: 'Personnel',
          account_status: data['accountStatus']
        });

        this.errorState.set('');
        this.loadingState.set(false);
      },

      () => {
        if (generation !== this.generation) {
          return;
        }

        this.profileState.set(null);

        this.errorState.set(
          'Unable to load your profile. Check your connection and try again.'
        );

        this.loadingState.set(false);
      }
    );
  }

  get displayName(): string {
    return (
      this.profile?.name?.trim() ||
      'Personnel'
    );
  }

  get displayEmail(): string {
    return (
      this.profile?.email?.trim() ||
      'Email not recorded'
    );
  }

  get displayRole(): string {
    return (
      this.profile?.role_name?.trim() ||
      'Personnel'
    );
  }

  ngOnDestroy(): void {
    ++this.generation;

    this.stopAuth?.();
    this.stopProfile?.();
  }
}