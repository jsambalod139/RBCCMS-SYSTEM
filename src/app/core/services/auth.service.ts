import { Injectable } from '@angular/core';

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail
} from 'firebase/auth';

import {
  doc,
  getDoc,
  getFirestore
} from 'firebase/firestore';

import { firebaseApp } from '../firebase.config';

export type UserRole = 'resident' | 'personnel' | 'admin';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  accountStatus:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'suspended';
  officeId: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  async getApprovedProfile(): Promise<UserProfile | null> {
    await this.auth.authStateReady();

    const user = this.auth.currentUser;

    if (!user) return null;

    const snapshot = await getDoc(
      doc(this.db, 'users', user.uid)
    );

    if (!snapshot.exists()) {
      throw new Error('account/profile-missing');
    }

    const data = snapshot.data();

    if (data['accountStatus'] !== 'approved') {
      throw new Error('account/not-approved');
    }

    const role = data['role'];

    if (
      role !== 'resident' &&
      role !== 'personnel' &&
      role !== 'admin'
    ) {
      throw new Error('account/invalid-role');
    }

    return {
      uid: user.uid,
      name:
        typeof data['name'] === 'string'
          ? data['name']
          : '',
      email: user.email ?? '',
      role,
      accountStatus: 'approved',
      officeId:
        typeof data['officeId'] === 'string'
          ? data['officeId']
          : null
    };
  }

  async login(
    email: string,
    password: string
  ): Promise<UserProfile> {
    try {
      await signInWithEmailAndPassword(
        this.auth,
        email.trim(),
        password
      );

      const profile = await this.getApprovedProfile();

      if (!profile) {
        throw new Error('account/profile-missing');
      }

      return profile;
    } catch (error) {
      await signOut(this.auth).catch(() => undefined);
      throw error;
    }
  }

  async sendResetLink(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(
        this.auth,
        email.trim()
      );
    } catch (error: unknown) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error
          ? String(error.code)
          : '';

      // Keep the response generic for unregistered addresses.
      if (code !== 'auth/user-not-found') {
        throw error;
      }
    }
  }

  logout(): Promise<void> {
    return signOut(this.auth);
  }
}