import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, PristineChangeEvent, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { filter, map } from 'rxjs';
import { ApiError } from '../../../core/http/api-error';
import { ToastService } from '../../../core/notifications/toast.service';
import { OrderType, Side } from '../../../domain/models';
import { OrdersStore } from '../../../state/orders.store';
import { InstrumentDetailStore } from './instrument-detail.store';

const integer: ValidatorFn = (c) => (c.value == null || Number.isInteger(c.value) ? null : { integer: true });

/**
 * Cross-field validator (lives on the GROUP, reads two controls), and it reads a signal for the
 * position size. Validators aren't reactive, so the component re-runs validation when that
 * signal changes (see the effect in the constructor).
 */
const sellWithinPosition =
  (held: () => number): ValidatorFn =>
  (group: AbstractControl): ValidationErrors | null => {
    const { side, qty } = group.getRawValue() as { side: Side; qty: number | null };
    return side === 'SELL' && (qty ?? 0) > held() ? { exceedsPosition: { held: held() } } : null;
  };

/** Consumer #5 of live ticks: the estimated cost follows the live price. */
@Component({
  selector: 'app-order-ticket',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, CurrencyPipe],
  templateUrl: './order-ticket.html',
  styleUrl: './order-ticket.scss',
})
export class OrderTicket {
  protected readonly store = inject(InstrumentDetailStore);
  protected readonly orders = inject(OrdersStore);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly formError = signal<string | null>(null);

  /** Strongly typed: form.getRawValue() is { side: Side; type: OrderType; qty: number | null; limitPrice: number | null } */
  protected readonly form = this.fb.group(
    {
      side: this.fb.control<Side>('BUY'),
      type: this.fb.control<OrderType>('MARKET'),
      qty: this.fb.control<number | null>(10, [Validators.required, Validators.min(1), integer]),
      limitPrice: this.fb.control<number | null>({ value: null, disabled: true }, [Validators.required, Validators.min(0.01)]),
    },
    { validators: sellWithinPosition(() => this.store.position()?.qty ?? 0) },
  );

  /**
   * Reactive Forms aren't signal-based (Signal Forms are experimental in v21), so we bridge them.
   * In a zoneless app this matters: binding the template to signals guarantees it re-renders
   * when validity changes for reasons other than a DOM event.
   */
  private readonly value = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue())), { initialValue: this.form.getRawValue() });
  protected readonly status = toSignal(this.form.statusChanges, { initialValue: this.form.status });

  protected readonly estimate = computed(() => {
    const v = this.value();
    const px = v.type === 'LIMIT' ? v.limitPrice : this.store.quote()?.price;
    return px && v.qty ? px * v.qty : null;
  });

  constructor() {
    const { type, limitPrice } = this.form.controls;

    // Conditional field: limit price exists only for LIMIT orders. Disabled controls are skipped
    // by validation and by .value, which is exactly the semantics we want.
    type.valueChanges.pipe(takeUntilDestroyed()).subscribe((t) => {
      if (t === 'LIMIT') {
        limitPrice.enable();
        if (limitPrice.value == null) limitPrice.setValue(this.store.quote()?.price ?? null);
      } else {
        limitPrice.disable();
      }
    });

    // Tell the page-level store about unsaved changes (used by the canDeactivate guard).
    // form.events is the unified control-event stream (Angular 18+).
    this.form.events
      .pipe(
        filter((e): e is PristineChangeEvent => e instanceof PristineChangeEvent),
        takeUntilDestroyed(),
      )
      .subscribe((e) => this.store.setTicketDirty(!e.pristine));

    // Re-validate when the position changes (e.g. a fill arrives over SSE).
    effect(() => {
      this.store.position();
      untracked(() => this.form.updateValueAndValidity());
    });

    // Navigating AAPL -> MSFT reuses this component, so reset the draft per symbol.
    effect(() => {
      this.store.symbol();
      untracked(() => this.resetForm());
    });
  }

  protected async submit() {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    try {
      const order = await this.orders.place({
        symbol: this.store.symbol(),
        side: v.side,
        type: v.type,
        qty: v.qty!,
        limitPrice: v.type === 'LIMIT' ? v.limitPrice : null,
      });
      this.toasts.info(`${order.side} ${order.qty} ${order.symbol} accepted (${order.status})`, { title: 'Order sent' });
      this.form.markAsPristine();
    } catch (e) {
      // Map server-side 422 field errors onto the matching controls, so they render inline.
      const err = ApiError.from(e);
      const fields = Object.entries(err.fieldErrors);
      for (const [name, message] of fields) this.form.get(name)?.setErrors({ server: message });
      if (!fields.length) this.formError.set(err.message);
      this.form.markAllAsTouched();
    }
  }

  protected errorFor(name: 'qty' | 'limitPrice'): string | null {
    const c = this.form.controls[name];
    if (!c.errors || !(c.touched || c.dirty)) return null;
    if (c.errors['server']) return c.errors['server'];
    if (c.errors['required']) return 'Required';
    if (c.errors['min']) return `Must be at least ${c.errors['min'].min}`;
    if (c.errors['integer']) return 'Whole shares only';
    return 'Invalid';
  }

  private resetForm() {
    this.form.reset({ side: 'BUY', type: 'MARKET', qty: 10, limitPrice: null });
    this.form.controls.limitPrice.disable();
    this.formError.set(null);
  }
}
