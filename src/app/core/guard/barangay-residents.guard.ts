import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { firebaseApp } from '../firebase.config';
export const barangayResidentsGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const auth = getAuth(firebaseApp);
  const denied = () => router.createUrlTree(['/perso-dashboard/personnel-dashboard']);
  try {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return router.createUrlTree(['/login-components']);
    const profile = (await getDoc(doc(getFirestore(firebaseApp), 'users', user.uid))).data();
    return auth.currentUser?.uid === user.uid && profile?.['role'] === 'personnel' &&
      profile?.['accountStatus'] === 'approved' && profile?.['officeId'] === 'barangay-office'
      ? true : denied();
  } catch { return denied(); }
};
