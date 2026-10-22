import { Routes } from '@angular/router';
import { roleGuard } from './core/guard/role.guard';

// Login
import { LoginComponents } from './components/auth/login-components/login-components';

// Resident
import { ResDashboard } from './components/layout/resident-layout/res-dashboard/res-dashboard';
import { ResidentDashboard } from './components/pages/resident-dashboard/resident-dashboard';
import { ResidentMyprofile } from './components/pages/resident-myprofile/resident-myprofile';
import { ResidentSubmitConcern } from './components/pages/resident-submit-concern/resident-submit-concern';
import { ResidentMyConcern } from './components/pages/resident-my-concern/resident-my-concern';

// Personnel
import { PersoDashboard } from './components/layout/personnel-layout/perso-dashboard/perso-dashboard';
import { PersonnelDashboard } from './components/pages/personnel-dashboard/personnel-dashboard';
import { PersonnelMyprofile } from './components/pages/personnel-myprofile/personnel-myprofile';
import { PersonnelConcerns } from './components/pages/personnel-concern/personnel-concern';
import { PersonnelReports } from './components/pages/personnel-reports/personnel-reports';
import { PersonnelResidents } from './components/pages/personnel-residents/personnel-residents';

// Administrator
import { AdDashboard } from './components/layout/admin-layout/ad-dashboard/ad-dashboard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login-components',
    pathMatch: 'full',
  },
  {
    path: 'login-components',
    component: LoginComponents,
  },

  {
    path: 'res-dashboard',
    component: ResDashboard,
    canActivate: [roleGuard('resident')],
    canActivateChild: [roleGuard('resident')],
    children: [
      {
        path: '',
        redirectTo: 'resident-dashboard',
        pathMatch: 'full',
      },
      {
        path: 'resident-dashboard',
        component: ResidentDashboard,
      },
      {
        path: 'resident-myprofile',
        component: ResidentMyprofile,
      },
      {
        path: 'resident-my-concern',
        component: ResidentMyConcern,
      },
      {
        path: 'resident-submit-concern',
        component: ResidentSubmitConcern,
      },
    ],
  },

  {
    path: 'perso-dashboard',
    component: PersoDashboard,
    canActivate: [roleGuard('personnel')],
    canActivateChild: [roleGuard('personnel')],
    children: [
      {
        path: '',
        redirectTo: 'personnel-dashboard',
        pathMatch: 'full',
      },
      {
        path: 'personnel-dashboard',
        component: PersonnelDashboard,
      },
      {
        path: 'personnel-myprofile',
        component: PersonnelMyprofile,
      },
      {
        path: 'personnel-concern',
        component: PersonnelConcerns,
      },
      {
        path: 'personnel-reports',
        component: PersonnelReports,
      },
      {
        path: 'personnel-residents',
        component: PersonnelResidents,
      },
    ],
  },

  {
    path: 'ad-dashboard',
    component: AdDashboard,
    canActivate: [roleGuard('admin')],
    canActivateChild: [roleGuard('admin')],
  },

  {
    path: '**',
    redirectTo: 'login-components',
  },
];