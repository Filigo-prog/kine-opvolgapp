import { compareSides, parseNumber, perKg, ratioPercent } from '../js/domain/lsi.js';
import { equal, ok } from './assert.js';

const quad = { id: 'quad-iso', compare: 'lsi', unit: 'Nm', decimals: 0 };
const timed = { id: 'timed-hop', compare: 'lsi-inverse', unit: 's', decimals: 2 };
const lunge = { id: 'wblt', compare: 'difference', unit: 'cm', decimals: 1 };
const extension = { id: 'extensie', compare: 'difference', unit: '°', decimals: 0 };

export const tests = {
  'parseNumber aanvaardt komma en punt': () => {
    equal(parseNumber('12,5'), 12.5);
    equal(parseNumber(' 12.5 '), 12.5);
    equal(parseNumber('-5'), -5);
    equal(parseNumber(''), null);
    ok(Number.isNaN(parseNumber('12,5,1')), 'twee komma’s');
    ok(Number.isNaN(parseNumber('abc')), 'tekst');
  },
  'LSI = aangedaan ÷ gezond × 100 (aangedaan links)': () => {
    equal(compareSides(quad, 145, 179, 'L'), { lsi: 81, difference: null });
  },
  'LSI = aangedaan ÷ gezond × 100 (aangedaan rechts)': () => {
    equal(compareSides(quad, 179, 145, 'R'), { lsi: 81, difference: null });
  },
  'LSI wordt afgerond op 1 decimaal': () => {
    equal(ratioPercent(2, 3), 66.7);
  },
  'Tijdtest: LSI = gezond ÷ aangedaan × 100': () => {
    // Aangedane zijde trager (2,50 s) dan gezonde (2,10 s) → LSI 84 %.
    equal(compareSides(timed, 2.5, 2.1, 'L').lsi, 84);
  },
  'LSI kan boven 100 % gaan': () => {
    equal(compareSides(quad, 200, 180, 'L').lsi, 111.1);
  },
  'LSI is null bij een gezonde zijde van 0': () => {
    equal(compareSides(quad, 50, 0, 'L').lsi, null);
    equal(compareSides(timed, 0, 2, 'L').lsi, null);
  },
  'Verschil = gezond − aangedaan': () => {
    equal(compareSides(lunge, 8.5, 12, 'L'), { lsi: null, difference: 3.5 });
    equal(compareSides(lunge, 12, 8.5, 'L').difference, -3.5);
  },
  'Verschil bij extensie met hyperextensie en deficit': () => {
    // Aangedaan −5° (deficit), gezond +3° (hyperextensie) → 8° minder.
    equal(compareSides(extension, -5, 3, 'L').difference, 8);
  },
  'Verschil zonder afrondingsfouten': () => {
    equal(compareSides(lunge, 10.1, 12.3, 'L').difference, 2.2);
  },
  'Relatieve kracht per kg': () => {
    equal(perKg(145, 72.5), 2);
    equal(perKg(145, null), null);
  },
};
