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
//   level:      de therapeut gaf level `level` vrij (de criteria van dat level zijn gehaald)
//   homeLogWeeks: `weeks` opeenvolgende weken met minstens `perWeek` oefendagen, vanaf de return to sport

import { STATUS } from './criteria.js';
import { weeklyRun } from './home-log.js';
import { milestoneText } from './text.js';
import { currentStage, isCompleted } from './progression.js';

export const TRIGGER_TYPES = ['criterion', 'lsi', 'manual', 'completion', 'homeLogWeeks', 'level'];

/**
 * Behaalde mijlpalen: [{ id, date }].
 * data = { protocol, sessions, statuses (Map), history, manual (Map milestoneId → { date }), homeLog (Map) }
 */
export function earnedMilestones({ protocol, sessions, statuses, history, manual, homeLog = new Map() }) {
  const earned = [];
  const byDate = [...sessions].sort((a, b) => a.date.localeCompare(b.date));

  for (const milestone of protocol.milestones ?? []) {
    const date = earnedDate(milestone.trigger, { protocol, byDate, statuses, history, manual, homeLog, id: milestone.id });
    if (date) earned.push({ id: milestone.id, date });
  }
  return earned;
}

function earnedDate(trigger, { protocol, byDate, statuses, history, manual, homeLog, id }) {
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
    case 'level': {
      const reached = history.find((entry) => entry.level === trigger.level + 1);
      return reached ? reached.date : null;
    }
    case 'completion':
      return isCompleted(currentStage(history), protocol) ? (history.at(-1)?.date ?? null) : null;
    case 'homeLogWeeks': {
      const completedOn = isCompleted(currentStage(history), protocol) ? history.at(-1)?.date : null;
      if (trigger.from === 'completion' && !completedOn) return null;
      return weeklyRun(homeLog, {
        weeks: trigger.weeks,
        perWeek: trigger.perWeek,
        from: trigger.from === 'completion' ? completedOn : null,
      }).earnedOn;
    }
    default:
      return null;
  }
}

/** Alle mijlpalen van het protocol met hun datum (of null): [{ milestone, date }]. dates = Map id → datum. */
export function milestoneOverview(protocol, dates) {
  return (protocol.milestones ?? []).map((milestone) => ({ milestone, date: dates.get(milestone.id) ?? null }));
}

/** Namen van mijlpalen bij een lijst id's, bv. voor een melding. */
export function feedbackNames(protocol, ids) {
  return (protocol.milestones ?? []).filter((milestone) => ids.includes(milestone.id)).map((milestone) => milestoneText(milestone, 'label')).join(', ');
}
