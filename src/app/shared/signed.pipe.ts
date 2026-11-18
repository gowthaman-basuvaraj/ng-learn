import { Pipe, PipeTransform } from '@angular/core';

/**
 * `{{ change | signed }}` -> "+1.23" / "-0.45". Pure pipe: Angular memoises it and only
 * re-runs it when the input reference/value changes, so it's safe in hot templates.
 */
@Pipe({ name: 'signed' })
export class SignedPipe implements PipeTransform {
  transform(value: number | null | undefined, digits = 2, suffix = ''): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${sign}${Math.abs(value).toFixed(digits)}${suffix}`;
  }
}
