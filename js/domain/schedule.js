// Testschema: wanneer is de volgende meting gepland? Pure functies, geen DOM.
//
// Het schema staat in het protocol (testSchedule.moments, in weken na de operatie of het letsel).
// De datum van een moment is de operatiedatum + het aantal weken. Een moment geldt als gedaan als er
// een testmoment is binnen die periode, met `toleranceWeeks` weken speling ervoor en erna.
// Wie een moment mist, krijgt geen verwijt: het blijft gewoon "niet gemeten" staan.

import { addDays } from './dates.js';

export const STATES = { DONE: 'gedaan', NEXT: 'volgende', PLANNED: 'gepland', MISSED: 'niet-gemeten' };

export function weekLabel(moment) {
  return moment.weekTo && moment.weekTo > moment.week ? `Week ${moment.week}-${moment.weekTo}` : `Week ${moment.week}`;
}

/**
 * Status van elk moment: [{ moment, from, to, state, sessionDate }].
 * sessions: testmomenten van de patiënt (elk met een datum).
 */
export function scheduleStatus(schedule, injuryDate, sessions, today) {
  const tolerance = (schedule.toleranceWeeks ?? 0) * 7;
  const dates = sessions.map((session) => session.date).sort();

  const rows = schedule.moments.map((moment) => {
    const from = addDays(injuryDate, moment.week * 7);
    const to = addDays(injuryDate, (moment.weekTo ?? moment.week) * 7);
    const sessionDate = dates.find((date) => date >= addDays(from, -tolerance) && date <= addDays(to, tolerance)) ?? null;
    return { moment, from, to, sessionDate, state: STATES.PLANNED };
  });

  let nextFound = false;
  for (const row of rows) {
    if (row.sessionDate) {
      row.state = STATES.DONE;
    } else if (addDays(row.to, tolerance) < today) {
      row.state = STATES.MISSED;
    } else if (!nextFound) {
      row.state = STATES.NEXT;
      nextFound = true;
    }
  }
  return rows;
}
