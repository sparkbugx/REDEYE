import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LEVELS, Note, SOURCES, Severity, Source } from '../models/note';
import { CurrentDateService } from '../services/current-date.service';

@Component({
  selector: 'app-note-form',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="form" novalidate (ngSubmit)="submit()">
      <div class="bar"><span class="src">New note</span><span>Saved in this browser only</span></div>
      <div class="form-grid">
        <div class="field">
          <label for="fSource">Source portal</label>
          <select id="fSource" name="source" [(ngModel)]="source">
            @for (s of sources; track s) {
              <option [value]="s">{{ s }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="fSev">Severity</label>
          <select id="fSev" name="sev" [(ngModel)]="sev">
            @for (l of levels; track l) {
              <option [value]="l">{{ l }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="fId">Advisory ID</label>
          <input id="fId" name="id" [(ngModel)]="id" placeholder="CVE-2026-12345 or USN-7000-1" autocomplete="off" />
        </div>
        <div class="field">
          <label for="fPkg">Package or component</label>
          <input id="fPkg" name="pkg" [(ngModel)]="pkg" placeholder="openssl, V8, lodash" autocomplete="off" />
        </div>
        <div class="field wide">
          <label for="fTitle">Title</label>
          <input id="fTitle" name="title" [(ngModel)]="title" placeholder="One line: what the bug is" autocomplete="off" />
        </div>
        <div class="field wide">
          <label for="fNote">Note</label>
          <textarea id="fNote" name="note" [(ngModel)]="note" placeholder="Who is affected and how bad it is"></textarea>
        </div>
        <div class="field wide">
          <label for="fFix">Fix</label>
          <input id="fFix" name="fix" [(ngModel)]="fix" placeholder="Version to install or mitigation" autocomplete="off" />
        </div>
        <div class="field wide">
          <label for="fLink">Original advisory link</label>
          <input id="fLink" name="link" type="url" [(ngModel)]="link" placeholder="https://" autocomplete="off" />
        </div>
        <div class="form-foot">
          <button class="btn" type="submit">Publish note</button>
          <button class="btn ghost" type="button" (click)="dismiss.emit()">Cancel</button>
          @if (error(); as message) {
            <p class="err" role="alert">{{ message }}</p>
          }
        </div>
      </div>
    </form>
  `,
})
export class NoteFormComponent {
  private readonly dates = inject(CurrentDateService);

  readonly publish = output<Note>();
  readonly dismiss = output<void>();

  protected readonly sources = SOURCES;
  protected readonly levels = LEVELS;
  protected readonly error = signal('');

  protected source: Source = 'Ubuntu';
  protected sev: Severity = 'high';
  protected id = '';
  protected pkg = '';
  protected title = '';
  protected note = '';
  protected fix = '';
  protected link = '';

  protected submit(): void {
    const title = this.title.trim();
    const link = this.link.trim();
    if (!title) {
      this.error.set('Add a title so the note can be found later.');
      return;
    }
    if (link && !/^https?:\/\//i.test(link)) {
      this.error.set('The link must start with http:// or https://');
      return;
    }
    this.error.set('');
    this.publish.emit({
      id: this.id.trim(),
      source: this.source,
      pkg: this.pkg.trim(),
      sev: this.sev,
      score: '',
      date: this.dates.today(), // new notes are always dated with the current date
      title,
      note: this.note.trim(),
      fix: this.fix.trim(),
      link,
    });
  }
}
