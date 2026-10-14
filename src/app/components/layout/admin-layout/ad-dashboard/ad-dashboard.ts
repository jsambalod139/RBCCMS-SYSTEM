import { Component } from '@angular/core';
import { Contents } from '../../contents/contents';
import { AdminSidebar } from '../admin-sidebar/admin-sidebar';
import { AdminTopbar } from '../admin-topbar/admin-topbar';

@Component({
  selector: 'app-ad-dashboard',
  imports: [Contents, AdminSidebar, AdminTopbar],
  templateUrl: './ad-dashboard.html',
  styleUrl: './ad-dashboard.scss',
})
export class AdDashboard {}
