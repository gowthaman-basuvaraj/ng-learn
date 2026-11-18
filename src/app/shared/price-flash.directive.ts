import { Directive, ElementRef, effect, inject, input } from '@angular/core';

/**
 * Flashes the host element green/red when the bound value goes up/down.
 *
 *   <td [appPriceFlash]="quote.price">{{ quote.price }}</td>
 *
 * A directive, not a component: it adds behaviour to ANY element without owning its markup.
 * (Closest React analogue is a custom hook plus a ref, but Angular attaches it declaratively.)
 * We use the Web Animations API rather than toggling classes, so rapid consecutive ticks restart
 * the animation cleanly.
 */
@Directive({
  selector: '[appPriceFlash]',
  host: { class: 'price-flash' },
})
export class PriceFlash {
  readonly value = input.required<number | undefined>({ alias: 'appPriceFlash' });
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private previous: number | undefined;

  constructor() {
    effect(() => {
      const next = this.value();
      const prev = this.previous;
      this.previous = next;
      if (prev === undefined || next === undefined || next === prev) return;
      const color = next > prev ? 'var(--up-bg)' : 'var(--down-bg)';
      this.el.nativeElement.animate([{ backgroundColor: color }, { backgroundColor: 'transparent' }], { duration: 700, easing: 'ease-out' });
    });
  }
}
