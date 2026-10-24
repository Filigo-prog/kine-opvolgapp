// Getallen en meetresultaten weergeven in Vlaamse notatie (komma als decimaalteken).

import { injuredAndHealthy, perKg } from '../domain/lsi.js';
import { unitOf } from '../domain/test-session.js';

export function formatNumber(value, decimals = 0, { fixed = false } = {}) {
  if (!Number.isFinite(value)) return '–';
  return value.toLocaleString('nl-BE', { minimumFractionDigits: fixed ? decimals : 0, maximumFractionDigits: decimals });
}

/** '8' + '°' → '8°', '1' + '/10' → '1/10', '145' + 'Nm' → '145 Nm'. */
export function withUnit(text, unit) {
  if (!unit) return text;
  return /^[°/]/.test(unit) ? `${text}${unit}` : `${text} ${unit}`;
}

/** Voor een invoerveld: 12.5 → '12,5'. */
export function toInputValue(value) {
  return Number.isFinite(value) ? String(value).replace('.', ',') : '';
}

export function formatLsi(lsi) {
  return Number.isFinite(lsi) ? `LSI ${formatNumber(lsi, 0)} %` : 'LSI –';
}

/** "8 ° minder aan de aangedane zijde" */
export function formatDifference(difference, test) {
  if (!Number.isFinite(difference)) return 'Verschil –';
  if (difference === 0) return 'Geen verschil';
  const amount = withUnit(formatNumber(Math.abs(difference), Math.max(test.decimals ?? 0, 1)), test.unit);
  return difference > 0 ? `${amount} minder aan de aangedane zijde` : `${amount} meer aan de aangedane zijde`;
}

/** Korte samenvatting van een bilaterale meting: LSI of verschil, plus de absolute waarden. */
export function describeBilateral(test, measurement) {
  const result = test.compare === 'difference'
    ? formatDifference(measurement.difference, test)
    : formatLsi(measurement.lsi);
  const unit = unitOf(test, measurement);
  const values = `L ${withUnit(formatNumber(measurement.left, test.decimals), unit)} / R ${withUnit(formatNumber(measurement.right, test.decimals), unit)}`;
  return { result, values };
}

/** "1,98 / 2,45 Nm/kg (aangedaan / gezond)" of null. */
export function describePerKg(test, left, right, side, bodyWeightKg, unit = test.unit) {
  if (!test.relativeToBodyWeight) return null;
  const { injured, healthy } = injuredAndHealthy(left, right, side);
  const a = perKg(injured, bodyWeightKg);
  const b = perKg(healthy, bodyWeightKg);
  if (a === null || b === null) return null;
  return `${formatNumber(a, 2, { fixed: true })} / ${formatNumber(b, 2, { fixed: true })} ${unit}/kg (aangedaan / gezond)`;
}

export function describeSingle(test, measurement) {
  if (test.type === 'choice') {
    return test.options.find((option) => option.value === measurement.value)?.label ?? measurement.value;
  }
  return withUnit(formatNumber(measurement.value, test.decimals), test.unit);
}
