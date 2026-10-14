
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-login-components',
  imports: [FormsModule, CommonModule],
  templateUrl: './login-components.html',
  styleUrl: './login-components.scss',
})
export class LoginComponents {
  email = '';
  password = '';

  constructor(private router: Router) {}

  login() {
    if (!this.email || !this.password) {
      Swal.fire({
        icon: 'warning',
        title: 'Missing Fields',
        text: 'Please fill all fields',
      });
      return;
    }

    if (this.email === 'admin@gmail.com' && this.password === 'admin123') {
      Swal.fire({
        icon: 'success',
        title: 'Welcome Admin!',
        timer: 1500,
        showConfirmButton: false
      }).then(() => {
        this.router.navigate(['/ad-dashboard']);
      });
      return;
    }

    if (this.email === 'staff@gmail.com' && this.password === 'staff123') {
      Swal.fire({
        icon: 'success',
        title: 'Welcome Staff!',
        timer: 1500,
        showConfirmButton: false
      }).then(() => {
        this.router.navigate(['/sta-dashboard']);
      });
      return;
    }

    if (this.email === 'resident@gmail.com' && this.password === 'res123') {
      Swal.fire({
        icon: 'success',
        title: 'Welcome Resident!',
        timer: 1500,
        showConfirmButton: false
      }).then(() => {
        this.router.navigate(['/res-dashboard']);
      });
      return;
    }

    Swal.fire({
      icon: 'error',
      title: 'Login Failed',
      text: 'Invalid email or password',
    });  
  }
    showPassword: boolean = false;
    togglePassword() {
      this.showPassword = !this.showPassword;
    }
    }