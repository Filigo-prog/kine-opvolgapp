// Thuisoefenlog: streak met rustdag-joker en wekenreeks voor de preventie. Pure functies, geen DOM.
//
// Gamification beloont consistentie, nooit snelheid: er is geen vergelijking tussen patiënten
// en een gemiste dag reset de streak niet volledig.
//
// log = Map 'JJJJ-MM-DD' → { done, pain, swelling }

import { addDays } from './dates.js';

export const PAIN_MAX = 10;

export const SWELLING_OPTIONS = [
  { value: 'geen', label: 'Geen zwelling' },
  { value: 'licht', label: 'Lichte zwelling' },
  { value: 'duidelijk', label: 'Duidelijke zwelling' },
];

/** De maandag van de week waarin deze datum valt. */
export function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const daysSinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(iso, -daysSinceMonday);
}

export function weekDays(startIso) {
  return Array.from({ length: 7 }, (_, i) => addDays(startIso, i));
}

const isDone = (log, date) => log.get(date)?.done === true;

/** Aantal dagen waarop geoefend werd in de week die op deze maandag begint. */
export function doneInWeek(log, startIso) {
  return weekDays(startIso).filter((date) => isDone(log, date)).length;
}

/**
 * Reeks die eindigt op `start` (een dag waarop geoefend werd, of gisteren als vandaag nog niet geteld is).
 * Een rustdag-joker vergeeft één losse gemiste dag per week, mits de dag ervoor wel geoefend werd:
 * twee gemiste dagen na elkaar breken de reeks altijd. De joker-dag zelf telt niet mee in de reeks.
 */
export function streakFrom(log, start, { jokersPerWeek = 1 } = {}) {
  let count = 0;
  const used = new Map();
  let current = start;
  for (;;) {
    if (isDone(log, current)) {
      count += 1;
      current = addDays(current, -1);
      continue;
    }
    const week = weekStart(current);
    const jokersLeft = jokersPerWeek - (used.get(week) ?? 0);
    if (jokersLeft > 0 && isDone(log, addDays(current, -1))) {
      used.set(week, (used.get(week) ?? 0) + 1);
      current = addDays(current, -1);
      continue;
    }
    return { count, used };
  }
}

/** Huidige en langste reeks, plus de stand van deze week. */
export function streakInfo(log, today, options = {}) {
  const jokersPerWeek = options.jokersPerWeek ?? 1;
  const doneToday = isDone(log, today);
  // Vandaag nog niet geoefend is geen gemiste dag: de reeks loopt door tot gisteren.
  const { count: current, used } = streakFrom(log, doneToday ? today : addDays(today, -1), { jokersPerWeek });

  let longest = current;
  for (const [date, entry] of log) {
    if (entry.done) longest = Math.max(longest, streakFrom(log, date, { jokersPerWeek }).count);
  }

  const thisWeek = weekStart(today);
  const jokersUsed = used.get(thisWeek) ?? 0;
  return {
    current,
    longest,
    doneToday,
    hasAny: [...log.values()].some((entry) => entry.done),
    doneThisWeek: doneInWeek(log, thisWeek),
    jokerUsedThisWeek: jokersUsed > 0,
    jokerAvailable: jokersUsed < jokersPerWeek,
  };
}

/**
 * Opeenvolgende weken met minstens `perWeek` oefendagen (week = maandag t.e.m. zondag).
 * from = enkel dagen vanaf deze datum tellen mee (bv. de datum van de return to sport).
 * Geeft de langste reeks terug en de datum waarop `weeks` weken bereikt werden.
 */
export function weeklyRun(log, { perWeek, weeks, from = null }) {
  const dates = [...log]
    .filter(([date, entry]) => entry.done && (!from || date >= from))
    .map(([date]) => date)
    .sort();
  if (!dates.length) return { bestRun: 0, earnedOn: null };

  const byWeek = new Map();
  for (const date of dates) {
    const key = weekStart(date);
    byWeek.set(key, [...(byWeek.get(key) ?? []), date]);
  }

  let run = 0;
  let bestRun = 0;
  let earnedOn = null;
  const last = weekStart(dates.at(-1));
  for (let week = weekStart(dates[0]); week <= last; week = addDays(week, 7)) {
    const days = byWeek.get(week) ?? [];
    if (days.length >= perWeek) {
      run += 1;
      bestRun = Math.max(bestRun, run);
      if (run >= weeks && !earnedOn) earnedOn = days[perWeek - 1];
    } else {
      run = 0;
    }
  }
  return { bestRun, earnedOn };
}

/** Ruwe invoer → opgeschoond logitem, of null als er niets is om te bewaren. */
export function normalizeLogEntry(raw, { tracksSwelling = false } = {}) {
  const pain = raw.pain === null || raw.pain === undefined || raw.pain === '' ? null : Number(raw.pain);
  const swelling = tracksSwelling && SWELLING_OPTIONS.some((option) => option.value === raw.swelling) ? raw.swelling : null;
  const entry = {
    done: raw.done === true,
    pain: Number.isInteger(pain) && pain >= 0 && pain <= PAIN_MAX ? pain : null,
    swelling,
  };
  return entry.done || entry.pain !== null || entry.swelling !== null ? entry : null;
}
