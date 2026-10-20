import { Component } from '@angular/core';
import { Contents } from '../../contents/contents';
import { PersonnelSidebar } from '../personnel-sidebar/personnel-sidebar';
import { PersonnelTopbar } from '../personnel-topbar/personnel-topbar';

@Component({
  selector: 'app-persop-dashboard',
  imports: [Contents, PersonnelSidebar, PersonnelTopbar],
  templateUrl: './perso-dashboard.html',
  styleUrl: './perso-dashboard.scss',
})
export class PersoDashboard {}
