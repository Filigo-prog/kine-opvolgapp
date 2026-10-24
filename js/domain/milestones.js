// Mijlpalen: wanneer is er een behaald? Pure functies, geen DOM en geen opslag.
//
// Mijlpalen belonen behaalde criteria en consistentie, nooit snelheid: de datum waarop iets
// behaald werd, is enkel informatie en wordt nergens vergeleken.
//
// Triggers in het protocol:
//   criterion:  het criterium is door de therapeut als voldaan afgevinkt
//   lsi:        een meting van `test` haalde minstens `threshold` % LSI
//   manual:     de therapeut registreert het zelf (bv. "Eerste loopsessie")
//   completion: de therapeut bevestigde de return to sport

import { STATUS } from './criteria.js';
import { currentStage, isCompleted } from './progression.js';

export const TRIGGER_TYPES = ['criterion', 'lsi', 'manual', 'completion'];

/**
 * Behaalde mijlpalen: [{ id, date }].
 * data = { protocol, sessions, statuses (Map), history, manual (Map milestoneId → { date }) }
 */
export function earnedMilestones({ protocol, sessions, statuses, history, manual }) {
  const earned = [];
  const byDate = [...sessions].sort((a, b) => a.date.localeCompare(b.date));

  for (const milestone of protocol.milestones ?? []) {
    const date = earnedDate(milestone.trigger, { protocol, byDate, statuses, history, manual, id: milestone.id });
    if (date) earned.push({ id: milestone.id, date });
  }
  return earned;
}

function earnedDate(trigger, { protocol, byDate, statuses, history, manual, id }) {
  switch (trigger.type) {
    case 'criterion': {
      const record = statuses.get(trigger.criterion);
      return record?.status === STATUS.MET ? record.date : null;
    }
    case 'lsi': {
      const first = byDate.find((session) => session.measurements?.[trigger.test]?.lsi >= trigger.threshold);
      return first ? first.date : null;
    }
    case 'manual':
      return manual.get(id)?.date ?? null;
    case 'completion':
      return isCompleted(currentStage(history), protocol) ? (history.at(-1)?.date ?? null) : null;
    default:
      return null;
  }
}

/** Alle mijlpalen van het protocol met hun datum (of null): [{ milestone, date }]. dates = Map id → datum. */
export function milestoneOverview(protocol, dates) {
  return (protocol.milestones ?? []).map((milestone) => ({ milestone, date: dates.get(milestone.id) ?? null }));
}
