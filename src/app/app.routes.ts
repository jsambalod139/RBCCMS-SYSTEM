import { Routes } from '@angular/router';
// For Log 
import { LoginComponents } from './components/auth/login-components/login-components';
// For Resident
import { ResDashboard } from './components/layout/resident-layout/res-dashboard/res-dashboard';
import { ResidentDashboard } from './components/pages/resident-dashboard/resident-dashboard';
import { ResidentMyprofile } from './components/pages/resident-myprofile/resident-myprofile';
import { ResidentSubmitConcern } from './components/pages/resident-submit-concern/resident-submit-concern';
import { ResidentMyConcern } from './components/pages/resident-my-concern/resident-my-concern';
// For Personnel
import { PersoDashboard } from './components/layout/personnel-layout/perso-dashboard/perso-dashboard';
import { PersonnelConcern } from './components/pages/personnel-concern/personnel-concern';
import { PersonnelDashboard } from './components/pages/personnel-dashboard/personnel-dashboard';
import { PersonnelMyprofile } from './components/pages/personnel-myprofile/personnel-myprofile';
import { PersonnelReports } from './components/pages/personnel-reports/personnel-reports';
import { PersonnelResidents } from './components/pages/personnel-residents/personnel-residents';


export const routes: Routes = [

    {path: '', redirectTo: 'login-components', pathMatch: 'full'},
    {path: 'login-components', component: LoginComponents},

    {path: 'res-dashboard', 
    component: ResDashboard, 
    children: [
        {path: '', redirectTo: 'resident-dashboard', pathMatch: 'full'},
        {path: 'resident-dashboard', component: ResidentDashboard},
        {path: 'resident-myprofile', component: ResidentMyprofile},
        {path: 'resident-my-concern', component: ResidentMyConcern},
        {path: 'resident-submit-concern', component: ResidentSubmitConcern},
    ],
},

    {path: 'perso-dashboard', 
    component: PersoDashboard, 
    children: [
        {path: '', redirectTo: 'personnel-dashboard', pathMatch: 'full'},
        {path: 'personnel-dashboard', component: PersonnelDashboard},
        {path: 'personnel-myprofile', component: PersonnelMyprofile},
        {path: 'personnel-concern', component: PersonnelConcern},
        {path: 'personnel-reports', component: PersonnelReports},
        {path: 'personnel-residents', component: PersonnelResidents},
    ]
}

];
