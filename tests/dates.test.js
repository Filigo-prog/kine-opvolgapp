import { daysBetween, describeTimeSince, isIsoDate, todayIso } from '../js/domain/dates.js';
import { equal, ok } from './assert.js';

export const tests = {
  'todayIso gebruikt de lokale kalenderdag': () => {
    equal(todayIso(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
  },
  'isIsoDate weigert onbestaande datums': () => {
    ok(isIsoDate('2024-02-29'), '29 feb 2024 bestaat');
    ok(!isIsoDate('2026-02-29'), '29 feb 2026 bestaat niet');
    ok(!isIsoDate('24-10-2026'), 'verkeerde vorm');
    ok(!isIsoDate(''), 'leeg');
  },
  'daysBetween telt kalenderdagen, ook over zomertijd heen': () => {
    equal(daysBetween('2026-03-28', '2026-03-30'), 2);
    equal(daysBetween('2026-10-24', '2026-10-24'), 0);
  },
  'describeTimeSince: dagen tot 2 weken, daarna weken': () => {
    equal(describeTimeSince('2026-10-23', '2026-10-24'), '1 dag');
    equal(describeTimeSince('2026-10-14', '2026-10-24'), '10 dagen');
    equal(describeTimeSince('2026-10-10', '2026-10-24'), '2 weken');
    equal(describeTimeSince('2026-08-01', '2026-10-24'), '12 weken');
  },
};
