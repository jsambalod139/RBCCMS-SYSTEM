import { Component, HostListener, signal } from '@angular/core';
import { Contents } from '../../contents/contents';
import { PersonnelSidebar } from '../personnel-sidebar/personnel-sidebar';
import { PersonnelTopbar } from '../personnel-topbar/personnel-topbar';

@Component({
  selector: 'app-persop-dashboard',
  imports: [Contents, PersonnelSidebar, PersonnelTopbar],
  templateUrl: './perso-dashboard.html',
  styleUrl: './perso-dashboard.scss',
})
export class PersoDashboard {
  readonly sidebarOpen = signal(false);
  private menuButton: HTMLButtonElement | null = null;

private previousZoom = window.devicePixelRatio;
private wasDesktop = window.matchMedia(
  '(min-width: 1440px)'
).matches;
private resizeRequest = 0;



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
  const isDesktop = window.matchMedia(
    '(min-width: 1440px)'
  ).matches;

  const currentZoom = window.devicePixelRatio;

  const zoomChanged =
    Math.abs(currentZoom - this.previousZoom) > 0.01;

  const enteredMobile =
    this.wasDesktop && !isDesktop;

  this.previousZoom = currentZoom;
  this.wasDesktop = isDesktop;

  // Desktop sidebar opens through CSS
  if (isDesktop) {
    this.resizeRequest++;
    this.sidebarOpen.set(false);
    this.menuButton = null;
    return;
  }

  // Automatically open mobile sidebar on zoom
  if (
    (zoomChanged || enteredMobile) &&
    !this.sidebarOpen()
  ) {
    const request = ++this.resizeRequest;

    // Render closed position before sliding open
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {

        if (
          request !== this.resizeRequest ||
          window.matchMedia(
            '(min-width: 1440px)'
          ).matches
        ) {
          return;
        }

        this.menuButton =
          document.querySelector<HTMLButtonElement>(
            '.drawer-toggle'
          );

        this.sidebarOpen.set(true);

        requestAnimationFrame(() => {
          document.querySelector<HTMLButtonElement>(
            '#personnel-navigation .drawer-close'
          )?.focus({ preventScroll: true });
        });
      });
    });
  }
}
}