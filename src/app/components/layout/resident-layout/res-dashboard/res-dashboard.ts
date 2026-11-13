
import {
  Component,
  HostListener,
  signal
} from '@angular/core';

import { Contents } from '../../contents/contents';

import { ResidentSidebar } from
  '../resident-sidebar/resident-sidebar';

import { ResidentTopbar } from
  '../resident-topbar/resident-topbar';

@Component({
  selector: 'app-res-dashboard',
  imports: [
    Contents,
    ResidentSidebar,
    ResidentTopbar
  ],
  templateUrl: './res-dashboard.html',
  styleUrl: './res-dashboard.scss',
})
export class ResDashboard {

  readonly sidebarOpen = signal(false);

  private menuButton: HTMLButtonElement | null = null;

  private previousZoom = window.devicePixelRatio;

  private wasDesktop = window.matchMedia(
    '(min-width: 1440px)'
  ).matches;

  private autoOpenSequence = 0;

  /* Open sidebar manually */
  openSidebar(
    menu: HTMLButtonElement,
    close: HTMLButtonElement
  ): void {

    ++this.autoOpenSequence;

    this.menuButton = menu;
    this.sidebarOpen.set(true);

    requestAnimationFrame(() => {
      if (this.sidebarOpen()) {
        close.focus({ preventScroll: true });
      }
    });
  }

  /* Close sidebar manually */
  closeSidebar(restoreFocus = true): void {

    ++this.autoOpenSequence;

    if (!this.sidebarOpen()) return;

    this.sidebarOpen.set(false);

    const menu = this.menuButton;
    this.menuButton = null;

    if (restoreFocus) {
      requestAnimationFrame(() => {
        if (!this.sidebarOpen()) {
          menu?.focus({ preventScroll: true });
        }
      });
    }
  }

  /* Close sidebar after navigation */
  onSidebarClick(event: MouseEvent): void {

    if (
      event.target instanceof Element &&
      event.target.closest('a[href]')
    ) {
      this.closeSidebar();
    }
  }

  /* Escape key closes sidebar */
  @HostListener('keydown.escape', ['$event'])
  onEscape(event: Event): void {

    if (!this.sidebarOpen()) return;

    event.preventDefault();
    this.closeSidebar();
  }

  /* =====================================
     AUTOMATIC SIDEBAR ON BROWSER ZOOM
     ===================================== */

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

    /* Desktop sidebar is shown by CSS */
    if (isDesktop) {
      ++this.autoOpenSequence;

      this.sidebarOpen.set(false);
      this.menuButton = null;
      return;
    }

    /* Automatically open mobile sidebar
       after zooming or entering mobile mode */
    if (
      (zoomChanged || enteredMobile) &&
      !this.sidebarOpen()
    ) {

      const request = ++this.autoOpenSequence;

      requestAnimationFrame(() => {

        requestAnimationFrame(() => {

          if (
            request !== this.autoOpenSequence ||
            window.matchMedia(
              '(min-width: 1440px)'
            ).matches
          ) {
            return;
          }

          const menu =
            document.querySelector<HTMLButtonElement>(
              '.drawer-toggle'
            );

          const close =
            document.querySelector<HTMLButtonElement>(
              '#resident-navigation .drawer-close'
            );

          if (!menu || !close) return;

          this.menuButton = menu;
          this.sidebarOpen.set(true);

          requestAnimationFrame(() => {
            if (this.sidebarOpen()) {
              close.focus({ preventScroll: true });
            }
          });
        });
      });
    }
  }
}
