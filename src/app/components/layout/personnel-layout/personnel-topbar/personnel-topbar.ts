import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';


@Component({
  selector: 'app-personnel-topbar',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './personnel-topbar.html',
  styleUrl: './personnel-topbar.scss',
})
export class PersonnelTopbar {
  constructor(private router: Router) {}
  logout(): void {
    
    Swal.fire({
      title: 'Are you sure?',
      text: 'Do you want to log out?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, Logout',
      cancelButtonText: 'No',
      confirmButtonColor: '#3085d6',
      cancelButtonColor: '#d33'
    }).then((result) => {
      if (result.isConfirmed) {
        Swal.fire({
          icon: 'success',
          title: 'Logged out!',
          timer: 1200,
          showConfirmButton: false
        });
        this.router.navigate(['/login-components']);
      }
    });
  }

  isMenuOpen = false;

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }
}