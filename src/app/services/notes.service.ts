import { Injectable, computed, signal } from '@angular/core';
import { STARTER_NOTES } from '../data/starter-notes';
import { LEVELS, Note } from '../models/note';

const STORAGE_KEY = 'redeye-notes-v1';

@Injectable({ providedIn: 'root' })
export class NotesService {
  /** Notes the viewer added. They are kept in this browser only. */
  readonly mine = signal<Note[]>(this.load());

  /** Every note in priority order: severity first, then newest, then score. */
  readonly ranked = computed(() =>
    [...this.mine(), ...STARTER_NOTES].sort(
      (a, b) =>
        LEVELS.indexOf(a.sev) - LEVELS.indexOf(b.sev) ||
        b.date.localeCompare(a.date) ||
        (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0),
    ),
  );

  add(note: Note): void {
    this.mine.update((list) => [note, ...list]);
    this.save();
  }

  remove(note: Note): void {
    this.mine.update((list) => list.filter((n) => n !== note));
    this.save();
  }

  isMine(note: Note): boolean {
    return this.mine().includes(note);
  }

  private load(): Note[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(parsed) ? (parsed as Note[]) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.mine()));
    } catch {
      // Storage can be blocked (private window); the notes still work for this visit.
    }
  }
}
