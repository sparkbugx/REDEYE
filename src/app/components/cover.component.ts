import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BarcodeComponent } from './barcode.component';

@Component({
  selector: 'app-cover',
  imports: [BarcodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'cover', 'aria-label': 'Cover art', role: 'complementary' },
  template: `
    <img
      src="art.jpg"
      alt="Illustration: a figure in bone-white armour with a single red eye, set against a red sun"
    />
    <div class="cover-name"><b>REDEYE</b><span>Vulnerability notes</span></div>
    <div class="cover-tag">
      <dl>
        <dt>Today</dt>
        <dd>{{ today() }}</dd>
        <dt>Critical today</dt>
        <dd>{{ criticalToday() }}</dd>
        <dt>High today</dt>
        <dd>{{ highToday() }}</dd>
        <dt>All on file</dt>
        <dd>{{ total() }}</dd>
      </dl>
      <app-barcode [reference]="today()" />
    </div>
  `,
})
export class CoverComponent {
  readonly today = input.required<string>();
  readonly criticalToday = input.required<number>();
  readonly highToday = input.required<number>();
  readonly total = input.required<number>();
}
