import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Pure presentational component: inputs in, SVG out, everything derived with computed(). */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + width() + ' ' + height()" [attr.width]="width()" [attr.height]="height()" role="img" [attr.aria-label]="label()">
      @if (fill()) {
        <path [attr.d]="areaPath()" [attr.fill]="color()" opacity="0.12" />
      }
      <path [attr.d]="linePath()" fill="none" [attr.stroke]="color()" stroke-width="1.5" stroke-linejoin="round" />
    </svg>
  `,
  styles: `:host { display: inline-block; line-height: 0; }`,
})
export class Sparkline {
  readonly points = input.required<readonly number[]>();
  readonly width = input(120);
  readonly height = input(32);
  readonly fill = input(false);

  private readonly scaled = computed(() => {
    const pts = this.points();
    if (pts.length < 2) return [] as [number, number][];
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    const w = this.width();
    const h = this.height() - 2;
    return pts.map((p, i) => [(i / (pts.length - 1)) * w, h - ((p - min) / range) * h + 1] as [number, number]);
  });

  protected readonly linePath = computed(() =>
    this.scaled()
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' '),
  );
  protected readonly areaPath = computed(() => {
    const line = this.linePath();
    return line ? `${line} L${this.width()},${this.height()} L0,${this.height()} Z` : '';
  });
  protected readonly color = computed(() => {
    const pts = this.points();
    return pts.length > 1 && pts[pts.length - 1] < pts[0] ? 'var(--down)' : 'var(--up)';
  });
  protected readonly label = computed(() => `Trend over ${this.points().length} points`);
}
