import { Component, HostListener, signal } from '@angular/core';
import { Contents } from '../../contents/contents';
import { AdminSidebar } from '../admin-sidebar/admin-sidebar';
import { AdminTopbar } from '../admin-topbar/admin-topbar';

@Component({
  selector: 'app-ad-dashboard',
  imports: [Contents, AdminSidebar, AdminTopbar],
  templateUrl: './ad-dashboard.html',
  styleUrl: './ad-dashboard.scss',
})
export class AdDashboard {
  readonly sidebarOpen = signal(false);
  private menuButton: HTMLButtonElement | null = null;

  openSidebar(menu: HTMLButtonElement, close: HTMLButtonElement): void {
  this.menuButton = menu;
  this.sidebarOpen.set(true);

  requestAnimationFrame(() => {
    if (this.sidebarOpen()) {
      close.focus({ preventScroll: true });
    }
  });
}

  closeSidebar(restoreFocus = true): void {
    if (!this.sidebarOpen()) return;

    this.sidebarOpen.set(false);
    const menu = this.menuButton;
    this.menuButton = null;
    if (restoreFocus) {
      requestAnimationFrame(() => {
        if (!this.sidebarOpen()) menu?.focus();
      });
    }
  }

  onSidebarClick(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest('a[href]')) {
      this.closeSidebar();
    }
  }

  @HostListener('keydown.escape', ['$event'])
onEscape(event: Event): void {
  if (!this.sidebarOpen()) return;

  event.preventDefault();
  this.closeSidebar();
}

  @HostListener('window:resize')
onResize(): void {
  if (
    this.sidebarOpen() &&
    window.matchMedia('(min-width: 1440px)').matches
  ) {
    this.sidebarOpen.set(false);
    this.menuButton = null;
  }
}
}
