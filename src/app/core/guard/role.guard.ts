import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, UserRole } from '../services/auth.service';

export function roleGuard(...allowedRoles: UserRole[]): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    const loginPage = router.createUrlTree(['/login-components']);

    try {
      const profile = await auth.getApprovedProfile();

      if (!profile) {
        return loginPage;
      }

      if (allowedRoles.includes(profile.role)) {
        return true;
      }

      const destinations: Record<UserRole, string> = {
        resident: '/res-dashboard',
        personnel: '/perso-dashboard',
        admin: '/ad-dashboard',
      };

      return router.createUrlTree([destinations[profile.role]]);
    } catch {
      await auth.logout().catch(() => undefined);
      return loginPage;
    }
  };
}