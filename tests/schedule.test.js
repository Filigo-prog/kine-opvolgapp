import { normalizePatient, validatePatient } from '../js/domain/patient.js';
import { validateProtocol } from '../js/domain/protocol.js';
import { groupedReferences, referenceForTest, referenceText } from '../js/domain/references.js';
import { STATES, scheduleStatus, weekLabel } from '../js/domain/schedule.js';
import { equal, ok } from './assert.js';

const load = async () => (await fetch('../data/protocol-vkb.json')).json();

export const tests = {
  'Weeklabel: een periode of één week': () => {
    equal(weekLabel({ week: 3, weekTo: 4 }), 'Week 3-4');
    equal(weekLabel({ week: 12 }), 'Week 12');
  },
  'Testschema: datums, gedaan, niet gemeten, volgende en gepland': () => {
    const schedule = {
      toleranceWeeks: 1,
      moments: [{ week: 3, weekTo: 4, label: 'a' }, { week: 8, weekTo: 10, label: 'b' }, { week: 12, label: 'c' }, { week: 16, label: 'd' }, { week: 20, label: 'e' }],
    };
    // operatie 15 juli 2026; vandaag 24 oktober (week 14)
    const rows = scheduleStatus(schedule, '2026-07-15', [{ date: '2026-08-10' }, { date: '2026-10-06' }], '2026-10-24');
    equal(rows.map((r) => [r.from, r.to]), [['2026-08-05', '2026-08-12'], ['2026-09-09', '2026-09-23'], ['2026-10-07', '2026-10-07'], ['2026-11-04', '2026-11-04'], ['2026-12-02', '2026-12-02']]);
    equal(rows.map((r) => r.state), [STATES.DONE, STATES.MISSED, STATES.DONE, STATES.NEXT, STATES.PLANNED]);
    equal(rows.map((r) => r.sessionDate), ['2026-08-10', null, '2026-10-06', null, null]);
  },
  'Testschema: speling van een week ervoor en erna, niet meer': () => {
    const schedule = { toleranceWeeks: 1, moments: [{ week: 12, label: 'c' }] }; // 7 oktober
    const state = (date) => scheduleStatus(schedule, '2026-07-15', [{ date }], '2026-10-24')[0].state;
    equal(state('2026-09-30'), STATES.DONE); // precies een week ervoor
    equal(state('2026-10-14'), STATES.DONE); // precies een week erna
    equal(state('2026-09-29'), STATES.MISSED);
    equal(state('2026-10-15'), STATES.MISSED);
  },
  'Testschema: zonder testmomenten is het eerstvolgende moment "volgende"': () => {
    const schedule = { toleranceWeeks: 1, moments: [{ week: 3, label: 'a' }, { week: 8, label: 'b' }] };
    const rows = scheduleStatus(schedule, '2026-10-20', [], '2026-10-24');
    equal(rows.map((r) => r.state), [STATES.NEXT, STATES.PLANNED]);
  },
  'Referentie: het geslacht kiest de tekst, zonder geslacht staan beide naast elkaar': () => {
    const row = { men: '17-25 cm', women: '10-18 cm' };
    equal(referenceText(row, 'M'), '17-25 cm');
    equal(referenceText(row, 'V'), '10-18 cm');
    equal(referenceText(row, ''), 'Mannen: 17-25 cm · Vrouwen: 10-18 cm');
    equal(referenceText({ text: '>15' }, 'V'), '>15');
    equal(referenceText({ men: 'x' }, 'V'), null); // geen referentie voor vrouwen
    equal(referenceText({}, 'M'), null);
  },
  'Protocol: testschema en referenties zijn geldig en hebben inhoud': async () => {
    const protocol = validateProtocol(await load(), 'vkb');
    const weeks = protocol.testSchedule.moments.map((m) => m.week);
    ok(weeks.length >= 1, 'minstens één testmoment');
    equal(weeks, [...weeks].sort((a, b) => a - b), 'weken lopen op');
    ok(protocol.testSchedule.moments.every((m) => m.label), 'elk testmoment heeft een omschrijving');
    ok(protocol.references.length >= 1, 'referenties');
    ok(new Set(protocol.references.map((r) => r.id)).size === protocol.references.length, 'unieke id\'s');
  },
  'Referenties: het geslacht kiest de waarde die in het protocol staat': async () => {
    const protocol = await load();
    let checked = 0;
    for (const row of protocol.references) {
      if (row.men) { equal(referenceText(row, 'M'), row.men, row.id); checked += 1; }
      if (row.women) { equal(referenceText(row, 'V'), row.women, row.id); checked += 1; }
      if (row.men && row.women && !row.text) {
        equal(referenceText(row, ''), `Mannen: ${row.men} · Vrouwen: ${row.women}`, row.id);
      }
      if (row.text && !row.men && !row.women) {
        for (const sex of ['M', 'V', '']) equal(referenceText(row, sex), row.text, row.id);
      }
    }
    ok(checked >= 2, 'er is minstens één referentie voor mannen en vrouwen');
    const shown = groupedReferences(protocol, 'M').flatMap((g) => g.rows);
    ok(shown.every((entry) => entry.text), 'enkel rijen met een waarde');
    ok(shown.length < protocol.references.length, 'rijen zonder referentie worden niet getoond');
    ok(groupedReferences(protocol, 'M').every((g) => g.rows.length > 0), 'geen lege groepen');
  },
  'Referentie bij een test in het invoerformulier': async () => {
    const protocol = await load();
    const linked = protocol.references.filter((row) => row.testId);
    ok(linked.length >= 1, 'minstens één referentie gekoppeld aan een test');
    for (const row of linked) {
      for (const sex of ['M', 'V', '']) equal(referenceForTest(protocol, row.testId, sex), referenceText(row, sex), `${row.id} ${sex}`);
    }
    equal(referenceForTest(protocol, 'bestaat-niet', 'M'), null);
  },
  'Protocol: een schema met weken in de verkeerde volgorde of een onbekende test wordt geweigerd': async () => {
    const wrongOrder = await load();
    wrongOrder.testSchedule.moments[2].week = 5;
    let message = '';
    try { validateProtocol(wrongOrder, 'vkb'); } catch (error) { message = error.message; }
    ok(message.includes('moeten oplopen'), message);

    const badTest = await load();
    badTest.references[1].testId = 'bestaat-niet';
    message = '';
    try { validateProtocol(badTest, 'vkb'); } catch (error) { message = error.message; }
    ok(message.includes('bestaat niet'), message);
  },
  'Patiënt: geslacht is optioneel en enkel man of vrouw': async () => {
    const protocol = await load();
    const base = { code: 'VKB-001', injury: 'vkb', side: 'L', injuryDate: '2026-07-15', graft: 'HT', associatedInjuries: [] };
    const check = (sex) => validatePatient(normalizePatient({ ...base, sex }), { protocol, existingCodes: [], isNew: true, today: '2026-10-24' });
    equal(check(''), {});
    equal(check('M'), {});
    equal(check('V'), {});
    ok(check('X').sex, 'onbekende waarde');
    equal(normalizePatient({ ...base }).sex, '');
  },
};
