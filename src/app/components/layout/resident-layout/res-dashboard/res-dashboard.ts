import { Component } from '@angular/core';
import { Contents } from '../../contents/contents';
import { ResidentSidebar } from '../resident-sidebar/resident-sidebar';
import { ResidentTopbar } from '../resident-topbar/resident-topbar';

@Component({
  selector: 'app-res-dashboard',
  imports: [Contents, ResidentSidebar, ResidentTopbar],
  templateUrl: './res-dashboard.html',
  styleUrl: './res-dashboard.scss',
})
export class ResDashboard {}
