import { Routes } from '@angular/router';
// For Log 
import { LoginComponents } from './components/auth/login-components/login-components';
// For Resident
import { ResDashboard } from './components/layout/resident-layout/res-dashboard/res-dashboard';
import { ResidentDashboard } from './components/pages/resident-dashboard/resident-dashboard';
import { ResidentMyprofile } from './components/pages/resident-myprofile/resident-myprofile';
import { ResidentSubmitConcern } from './components/pages/resident-submit-concern/resident-submit-concern';
import { ResidentMyConcern } from './components/pages/resident-my-concern/resident-my-concern';


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
        
           
    ]
}


];
