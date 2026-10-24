// Teksten in het protocol mogen de grenswaarde van hun criterium overnemen: schrijf {threshold},
// {weeks}, {months} of {perWeek} in plaats van het getal zelf. Pas je de grens aan (bv. in Excel),
// dan klopt de omschrijving automatisch. Pure functies, geen DOM.

const PLACEHOLDER = /\{(threshold|weeks|months|perWeek)\}/g;

const plain = (value) => String(value).replace('.', ',');

/** Vervangt de placeholders door de getallen in `values`; onbekende placeholders blijven staan. */
export function fillPlaceholders(text, values = {}) {
  return String(text ?? '').replace(PLACEHOLDER, (match, name) => (Number.isFinite(values[name]) ? plain(values[name]) : match));
}

/** Welke placeholders staan er in deze tekst? */
export function placeholdersIn(text) {
  return [...String(text ?? '').matchAll(PLACEHOLDER)].map((match) => match[1]);
}

export function criterionValues(criterion) {
  return { threshold: criterion.threshold, weeks: criterion.weeks, months: criterion.months };
}

export function milestoneValues(milestone) {
  const trigger = milestone.trigger ?? {};
  return { threshold: trigger.threshold, weeks: trigger.weeks, perWeek: trigger.perWeek };
}

/** criterionText(c, 'label' | 'patientLabel' | 'note') */
export function criterionText(criterion, field) {
  return fillPlaceholders(criterion[field], criterionValues(criterion));
}

/** milestoneText(m, 'label' | 'description') */
export function milestoneText(milestone, field) {
  return fillPlaceholders(milestone[field], milestoneValues(milestone));
}
