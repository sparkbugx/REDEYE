import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { currentDate } from '../utils/current-date';

/**
 * Holds the current date as a signal and refreshes it every minute,
 * so "today" counts roll over at midnight without a page reload.
 */
@Injectable({ providedIn: 'root' })
export class CurrentDateService implements OnDestroy {
  private readonly now = signal(new Date());
  private readonly timer = setInterval(() => this.now.set(new Date()), 60_000);

  /** Today's date as YYYY-MM-DD in the viewer's time zone. */
  readonly today = computed(() => currentDate(this.now()));

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
}
