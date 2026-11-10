import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CoverComponent } from './components/cover.component';
import { NoteCardComponent } from './components/note-card.component';
import { NoteFormComponent } from './components/note-form.component';
import { LEVELS, LevelFilter, Note, Severity, SortMode } from './models/note';
import { CurrentDateService } from './services/current-date.service';
import { NotesService } from './services/notes.service';

interface Chip {
  key: LevelFilter;
  label: string;
  count: number;
}

interface Group {
  level: Severity;
  notes: Note[];
}

@Component({
  selector: 'app-root',
  imports: [CoverComponent, NoteCardComponent, NoteFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
})
export class AppComponent {
  protected readonly notes = inject(NotesService);
  private readonly dates = inject(CurrentDateService);

  protected readonly today = this.dates.today;
  protected readonly level = signal<LevelFilter>('all');
  protected readonly sort = signal<SortMode>('priority');
  protected readonly query = signal('');
  protected readonly formOpen = signal(false);

  protected readonly sortModes: readonly { key: SortMode; label: string }[] = [
    { key: 'priority', label: 'Priority' },
    { key: 'newest', label: 'Newest' },
  ];

  protected readonly criticalToday = computed(() => this.countToday('critical'));
  protected readonly highToday = computed(() => this.countToday('high'));

  protected readonly chips = computed<Chip[]>(() => {
    const all = this.notes.ranked();
    const today = this.today();
    return [
      { key: 'all', label: 'All', count: all.length },
      ...LEVELS.map((l): Chip => ({ key: l, label: l, count: all.filter((n) => n.sev === l).length })),
      { key: 'today', label: 'Today', count: all.filter((n) => n.date === today).length },
    ];
  });

  /** Notes that pass the level filter and the search box, still in priority order. */
  protected readonly shown = computed(() => {
    const level = this.level();
    const today = this.today();
    const q = this.query().trim().toLowerCase();
    return this.notes.ranked().filter((n) => {
      if (level === 'today' ? n.date !== today : level !== 'all' && n.sev !== level) return false;
      if (!q) return true;
      return [n.id, n.pkg, n.title, n.note, n.fix, n.source].join(' ').toLowerCase().includes(q);
    });
  });

  /** Priority view: one group per severity level, critical first. */
  protected readonly groups = computed<Group[]>(() =>
    LEVELS.map((level) => ({ level, notes: this.shown().filter((n) => n.sev === level) })).filter(
      (g) => g.notes.length > 0,
    ),
  );

  /** Newest view: one flat list by date. */
  protected readonly newest = computed(() =>
    [...this.shown()].sort(
      (a, b) => b.date.localeCompare(a.date) || LEVELS.indexOf(a.sev) - LEVELS.indexOf(b.sev),
    ),
  );

  protected rankOf(note: Note): number {
    return this.notes.ranked().indexOf(note) + 1;
  }

  protected onPublish(note: Note): void {
    this.notes.add(note);
    this.level.set('all');
    this.query.set('');
    this.formOpen.set(false);
  }

  private countToday(level: Severity): number {
    const today = this.today();
    return this.notes.ranked().filter((n) => n.date === today && n.sev === level).length;
  }
}
