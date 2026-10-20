import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { PersonnelProfile } from '../../../core/models/users.model';

@Component({
  selector: 'app-personnel-myprofile',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './personnel-myprofile.html',
  styleUrl: './personnel-myprofile.scss'
})
export class PersonnelMyprofile {
  // Empty until real personnel information is provided.
  profile: PersonnelProfile | null = null;

  get displayName(): string {
    return this.profile?.name?.trim() || 'Name not available';
  }

  get displayEmail(): string {
    return this.profile?.email?.trim() || 'Email not available';
  }

  get displayRole(): string {
    return this.profile?.role_name?.trim() || 'Role not available';
  }
}