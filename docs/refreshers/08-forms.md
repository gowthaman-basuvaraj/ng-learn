# Forms refresher

Repo references: `features/markets/instrument-detail/order-ticket.ts|html`, `features/auth/login-page.ts`.

## Three flavours
| | Template-driven | Reactive (typed) | Signal Forms |
|---|---|---|---|
| Module | `FormsModule` (`ngModel`) | `ReactiveFormsModule` | `@angular/forms/signals` |
| Model lives in | the template | the class (`FormGroup`) | a signal |
| Status | stable | **stable, what most codebases use** | experimental in v21 |
| Good for | tiny forms | anything real | the future |

## Reactive forms essentials
```ts
private fb = inject(NonNullableFormBuilder);        // values never become null on reset()
form = this.fb.group({
  side: this.fb.control<Side>('BUY'),
  qty: this.fb.control<number | null>(10, [Validators.required, Validators.min(1)]),
  limitPrice: this.fb.control<number | null>({ value: null, disabled: true }, Validators.required),
}, { validators: sellWithinPosition(() => this.held()) });   // cross-field validator on the GROUP
```
```html
<form [formGroup]="form" (ngSubmit)="submit()">
  <input formControlName="qty" type="number" />
</form>
```

| Need | API |
|---|---|
| Value incl. disabled controls | `form.getRawValue()` (`.value` **omits disabled controls**) |
| Typed control access | `form.controls.qty` |
| Conditional field | `ctrl.enable()` / `ctrl.disable()` (disabled = skips validation and is excluded from value) |
| Dynamic validators | `ctrl.setValidators([...]); ctrl.updateValueAndValidity()` |
| Server errors | `ctrl.setErrors({ server: msg })` |
| Touch everything on submit | `form.markAllAsTouched()` |
| Reset to clean | `form.reset(values)`, `markAsPristine()` |
| Streams | `valueChanges`, `statusChanges`, `events` (unified, v18+: `PristineChangeEvent`, `TouchedChangeEvent`, …) |
| Arrays of rows | `FormArray` / `fb.array([...])` |
| Async validation | `AsyncValidatorFn` returning an Observable (debounce it!) |

Custom validator:
```ts
const integer: ValidatorFn = c => c.value == null || Number.isInteger(c.value) ? null : { integer: true };
```

CSS state classes are added automatically: `ng-valid/ng-invalid`, `ng-touched/ng-untouched`, `ng-dirty/ng-pristine`.

## Patterns shown in the order ticket
- Validator that reads a signal (position size), plus an `effect` that re-validates when that signal changes.
- 422 `fieldErrors` from the server mapped onto controls, rendered by the same `errorFor()` as client errors.
- `form.events` → dirty flag in the page store → `canDeactivate` guard ("discard draft?").
- Zoneless: template binds `status()` (from `toSignal(statusChanges)`) for the submit button.
- Bridge to signals: `toSignal(form.valueChanges.pipe(map(() => form.getRawValue())), { initialValue })` →
  `computed` estimate.

## Custom form controls
Implement `ControlValueAccessor` (`writeValue`, `registerOnChange`, `registerOnTouched`, `setDisabledState`) and provide
`NG_VALUE_ACCESSOR`, so `formControlName` works on your own component (date pickers, etc.). Common interview question.
