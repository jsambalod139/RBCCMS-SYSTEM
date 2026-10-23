import { CommonModule } from '@angular/common';
import { Component, OnDestroy, signal } from '@angular/core';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import {
  Timestamp,
  doc,
  getFirestore,
  onSnapshot,
} from 'firebase/firestore';

import { firebaseApp } from '../../../core/firebase.config';

interface ResidentProfile {
  residentId: string;
  name: string;
  email: string;
  contactNumber: string;
  address: string;
  purok: string;
  accountStatus: string;
  verificationStatus: string;
  verifiedAt: string | null;
}

@Component({
  selector: 'app-resident-myprofile',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './resident-myprofile.html',
  styleUrl: './resident-myprofile.scss',
})
export class ResidentMyprofile implements OnDestroy {
  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  private stopAuth?: () => void;
  private stopProfile?: () => void;
  private generation = 0;

  readonly profile = signal<ResidentProfile | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal('');

  constructor() {
    this.stopAuth = onAuthStateChanged(this.auth, () => {
      this.loadProfile();
    });
  }

  loadProfile(): void {
    const generation = ++this.generation;

    this.stopProfile?.();
    this.profile.set(null);
    this.errorMessage.set('');
    this.loading.set(true);

    const user = this.auth.currentUser;

    if (!user) {
      this.loading.set(false);
      this.errorMessage.set('Please sign in to view your profile.');
      return;
    }

    this.stopProfile = onSnapshot(
      doc(this.db, 'users', user.uid),
      snapshot => {
        if (generation !== this.generation) {
          return;
        }

        this.loading.set(false);

        const data = snapshot.data();

        if (!data || data['role'] !== 'resident') {
          this.profile.set(null);
          this.errorMessage.set(
            'Your resident profile is unavailable. Contact the barangay.'
          );
          return;
        }

        this.errorMessage.set('');

        this.profile.set({
          residentId: this.text(data['residentId']),
          name: this.text(data['name']),
          email: user.email ?? '',
          contactNumber: this.text(data['contactNumber']),
          address: this.text(data['address']),
          purok: this.text(data['purok']),
          accountStatus:
            this.text(data['accountStatus']) || 'Not recorded',
          verificationStatus:
            data['residencyVerified'] === true
              ? 'Verified'
              : data['residencyVerified'] === false
                ? 'Not verified'
                : 'Not recorded',
          verifiedAt:
            data['verifiedAt'] instanceof Timestamp
              ? data['verifiedAt'].toDate().toISOString()
              : null,
        });
      },
      () => {
        if (generation !== this.generation) {
          return;
        }

        this.profile.set(null);
        this.loading.set(false);
        this.errorMessage.set(
          'Unable to load your profile. Check your connection and try again.'
        );
      }
    );
  }

  getInitials(): string {
    const name = this.profile()?.name.trim();

    if (!name) {
      return 'R';
    }

    return name
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('');
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  ngOnDestroy(): void {
    ++this.generation;
    this.stopAuth?.();
    this.stopProfile?.();
  }
}