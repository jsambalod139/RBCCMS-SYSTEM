
import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';

interface ResidentProfile {
  resident_id: string;
  profile_picture: string;
  full_name: string;
  birthday: string;
  place_of_birth: string;
  birth_certificate_number: string;
  blood_type: string;
  gender: string;
  civil_status: string;
  nationality: string;
  contact_number: string;
  email: string;
  address: string;
  purok: string;
}

@Component({
  selector: 'app-resident-myprofile',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './resident-myprofile.html',
  styleUrl: './resident-myprofile.scss'
})
export class ResidentMyprofile {
  readonly isEditing = signal(false);

  // Empty until real resident information is connected.
  readonly profile = signal<ResidentProfile>({
    resident_id: '',
    profile_picture: '',
    full_name: '',
    birthday: '',
    place_of_birth: '',
    birth_certificate_number: '',
    blood_type: '',
    gender: '',
    civil_status: '',
    nationality: '',
    contact_number: '',
    email: '',
    address: '',
    purok: ''
  });

  toggleEdit(): void {
    this.isEditing.update(value => !value);
  }

  getInitials(): string {
    const name = this.profile().full_name.trim();

    if (!name) {
      return 'R';
    }

    return name
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join('');
  }

  formatBirthday(value: string): string {
    if (!value) {
      return 'Not provided';
    }

    const date = new Date(`${value}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
}
