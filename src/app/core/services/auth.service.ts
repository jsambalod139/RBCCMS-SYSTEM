import { Injectable } from '@angular/core';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { firebaseApp } from '../firebase.config';

export type UserRole = 'resident' | 'personnel' | 'admin';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  accountStatus: 'pending' | 'approved' | 'rejected' | 'suspended';
  officeId: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = getAuth(firebaseApp);
  private readonly db = getFirestore(firebaseApp);

  async getApprovedProfile(): Promise<UserProfile | null> {
    // Wait for Firebase to restore an existing login after a page refresh.
    await this.auth.authStateReady();

    const user = this.auth.currentUser;

    if (!user) {
      return null;
    }

    const snapshot = await getDoc(doc(this.db, 'users', user.uid));

    if (!snapshot.exists()) {
      throw new Error('account/profile-missing');
    }

    const data = snapshot.data();

    if (data['accountStatus'] !== 'approved') {
      throw new Error('account/not-approved');
    }

    const role = data['role'];

    if (role !== 'resident' && role !== 'personnel' && role !== 'admin') {
      throw new Error('account/invalid-role');
    }

    return {
      uid: user.uid,
      name: typeof data['name'] === 'string' ? data['name'] : '',
      email: user.email ?? '',
      role,
      accountStatus: 'approved',
      officeId:
        typeof data['officeId'] === 'string' ? data['officeId'] : null,
    };
  }

  async login(email: string, password: string): Promise<UserProfile> {
    try {
      await signInWithEmailAndPassword(this.auth, email.trim(), password);

      const profile = await this.getApprovedProfile();

      if (!profile) {
        throw new Error('account/profile-missing');
      }

      return profile;
    } catch (error) {
      // Do not leave a rejected login signed in.
      await signOut(this.auth).catch(() => undefined);
      throw error;
    }
  }

  logout(): Promise<void> {
    return signOut(this.auth);
  }
}