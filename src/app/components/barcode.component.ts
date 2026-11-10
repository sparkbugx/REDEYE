import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { encodeBarcode } from '../utils/barcode';

@Component({
  selector: 'app-barcode',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (code().width) {
      <svg
        class="bars"
        role="img"
        preserveAspectRatio="none"
        shape-rendering="crispEdges"
        fill="currentColor"
        [attr.viewBox]="'0 0 ' + code().width + ' 10'"
        [attr.aria-label]="'Barcode for ' + code().text"
        [style.width.px]="code().width * 1.15"
      >
        @for (bar of code().bars; track bar.x) {
          <rect y="0" height="10" [attr.x]="bar.x" [attr.width]="bar.width" />
        }
      </svg>
    }
  `,
})
export class BarcodeComponent {
  /** The reference number to encode, for example a CVE ID. */
  readonly reference = input.required<string>();
  protected readonly code = computed(() => encodeBarcode(this.reference()));
}
