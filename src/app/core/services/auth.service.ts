import { Injectable, signal } from '@angular/core';

import {
  User,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from 'firebase/auth';

import {
  doc,
  getDoc,
  getFirestore,
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

  private readonly auditEndpoint =
    'https://nlwjwvhjojnjrmlaykym.supabase.co/functions/v1/auth-audit';

  private readonly auditFailure = signal('');

  readonly auditWarning = this.auditFailure.asReadonly();

  async getApprovedProfile(): Promise<UserProfile | null> {
    await this.auth.authStateReady();

    const user = this.auth.currentUser;

    if (!user) return null;

    const snapshot = await getDoc(
      doc(this.db, 'users', user.uid)
    );

    if (this.auth.currentUser?.uid !== user.uid) {
      throw new Error('account/session-changed');
    }

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
          ? data['name'].trim()
          : '',
      email: user.email ?? '',
      role,
      accountStatus: 'approved',
      officeId:
        typeof data['officeId'] === 'string'
          ? data['officeId']
          : null,
    };
  }

  async login(
    email: string,
    password: string
  ): Promise<UserProfile> {
    this.auditFailure.set('');

    let signedInUser: User | null = null;

    try {
      const credential = await signInWithEmailAndPassword(
        this.auth,
        email.trim(),
        password
      );

      signedInUser = credential.user;

      const profile = await this.getApprovedProfile();

      if (!profile) {
        throw new Error('account/profile-missing');
      }

      await this.recordAuthEvent('login', signedInUser);

      if (this.auth.currentUser?.uid !== profile.uid) {
        throw new Error('account/session-changed');
      }

      return profile;
    } catch (error) {
      // Avoid signing out a different account after an account switch.
      if (
        signedInUser &&
        this.auth.currentUser?.uid === signedInUser.uid
      ) {
        await signOut(this.auth).catch(() => undefined);
      }

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

      if (code !== 'auth/user-not-found') {
        throw error;
      }
    }
  }

  async logout(): Promise<void> {
    const user = this.auth.currentUser;

    this.auditFailure.set('');

    if (!user) {
      await signOut(this.auth);
      return;
    }

    // Logging is best effort. It must not block sign-out.
    await this.recordAuthEvent('logout', user);

    if (this.auth.currentUser?.uid === user.uid) {
      await signOut(this.auth);
    }
  }

  private async recordAuthEvent(
    action: 'login' | 'logout',
    user: User
  ): Promise<void> {
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      8000
    );

    try {
      if (this.auth.currentUser?.uid !== user.uid) {
        return;
      }

      const token = await user.getIdToken();

      if (
        controller.signal.aborted ||
        this.auth.currentUser?.uid !== user.uid
      ) {
        return;
      }

      const response = await fetch(this.auditEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('audit/unavailable');
      }
    } catch {
      if (this.auth.currentUser?.uid === user.uid) {
        this.auditFailure.set(
          'The authentication activity could not be recorded.'
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}