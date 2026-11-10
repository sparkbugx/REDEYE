import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Note } from '../models/note';
import { BarcodeComponent } from './barcode.component';

@Component({
  selector: 'app-note-card',
  imports: [BarcodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'label', role: 'listitem' },
  template: `
    <div class="label-main">
      <div class="bar">
        <span class="rank">#{{ rank() }}</span>
        <span class="src">{{ note().source }}</span>
        <span class="cve">{{ note().id || 'No ID' }}</span>
        @if (isToday()) {
          <span class="new">Today</span>
        }
        @if (note().date) {
          <time [attr.datetime]="note().date">{{ note().date }}</time>
        }
      </div>
      <div class="body">
        <h2>{{ note().title }}</h2>
        @if (note().pkg) {
          <div class="pkg">
            Affects <b>{{ note().pkg }}</b>
            @if (mine()) {
              · your note
            }
          </div>
        } @else if (mine()) {
          <div class="pkg">Your note</div>
        }
        @if (note().note) {
          <p>{{ note().note }}</p>
        }
        <app-barcode [reference]="note().id" />
        <details>
          <summary>Fix and source</summary>
          <div class="fix">
            <p>{{ note().fix || 'No fix recorded yet.' }}</p>
            <div class="fix-actions">
              @if (link(); as url) {
                <a [href]="url" target="_blank" rel="noopener noreferrer">
                  {{ note().via ? 'Read the report at ' + note().via : 'Open original advisory' }}
                </a>
              }
              <button type="button" class="mini" (click)="copy()">{{ copyLabel() }}</button>
              @if (mine()) {
                <button type="button" class="mini" (click)="remove.emit(note())">Delete</button>
              }
            </div>
          </div>
        </details>
      </div>
    </div>
    <div class="spine" [class]="note().sev">
      <span>{{ note().sev }}</span>
      @if (note().score) {
        <span>{{ note().score }}</span>
      }
    </div>
  `,
})
export class NoteCardComponent {
  readonly note = input.required<Note>();
  readonly rank = input.required<number>();
  readonly isToday = input(false);
  readonly mine = input(false);
  readonly remove = output<Note>();

  protected readonly copyLabel = signal('Copy note');

  /** The note's own link, or the NVD page when the ID is a CVE. */
  protected readonly link = computed(() => {
    const n = this.note();
    if (n.link && /^https?:\/\//i.test(n.link)) return n.link;
    if (/^CVE-\d{4}-\d+$/i.test(n.id)) return `https://nvd.nist.gov/vuln/detail/${n.id.toUpperCase()}`;
    return '';
  });

  protected async copy(): Promise<void> {
    const n = this.note();
    const text = [
      `[${n.source}] ${n.id} · ${n.title}`,
      n.pkg ? `Affects: ${n.pkg}` : '',
      `Severity: ${n.sev}${n.score ? ` (${n.score})` : ''}`,
      n.note,
      n.fix ? `Fix: ${n.fix}` : '',
      this.link(),
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.copyLabel.set('Copied');
    } catch {
      this.copyLabel.set('Copy blocked');
    }
    setTimeout(() => this.copyLabel.set('Copy note'), 1600);
  }
}
