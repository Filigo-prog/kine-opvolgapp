import { SUGGESTION, STATUS, evaluateCriterion } from '../js/domain/criteria.js';
import { addDays, addMonths } from '../js/domain/dates.js';
import { currentStage, isCompleted, levelProgress, stageLabel } from '../js/domain/progression.js';
import { validateProtocol } from '../js/domain/protocol.js';
import { equal, ok } from './assert.js';

const patient = { side: 'L', injuryDate: '2026-07-15' };
const today = '2026-10-24';
const session = (date, measurements) => ({ date, measurements });

const lsiCriterion = { id: 'c1', type: 'measurement', test: 'quad-iso', metric: 'lsi', operator: '>=', threshold: 80 };
const multi = { id: 'c2', type: 'measurement', tests: ['single-hop', 'triple-hop'], metric: 'lsi', operator: '>=', threshold: 85 };

export const tests = {
  'LSI-criterium: voldaan, niet voldaan en grenswaarde zelf': () => {
    const run = (lsi) => evaluateCriterion(lsiCriterion, { patient, today, sessions: [session('2026-10-20', { 'quad-iso': { lsi } })] }).suggestion;
    equal(run(81), SUGGESTION.MET);
    equal(run(80), SUGGESTION.MET);
    equal(run(79.9), SUGGESTION.NOT_MET);
  },
  'Zonder meting: "geen meting", nooit "voldaan"': () => {
    equal(evaluateCriterion(lsiCriterion, { patient, today, sessions: [] }).suggestion, SUGGESTION.NO_DATA);
  },
  'Gebruikt de meest recente meting, ook als die in een ouder testmoment zit': () => {
    const sessions = [
      session('2026-10-20', { 'single-hop': { lsi: 90 } }),
      session('2026-09-01', { 'quad-iso': { lsi: 60 } }),
    ];
    const result = evaluateCriterion(lsiCriterion, { patient, today, sessions });
    equal(result.suggestion, SUGGESTION.NOT_MET);
    equal(result.details[0].date, '2026-09-01');
  },
  'Criterium met meerdere tests: alle moeten slagen, een ontbrekende test geeft "geen meting"': () => {
    const both = [session('2026-10-20', { 'single-hop': { lsi: 90 }, 'triple-hop': { lsi: 88 } })];
    equal(evaluateCriterion(multi, { patient, today, sessions: both }).suggestion, SUGGESTION.MET);
    const one = [session('2026-10-20', { 'single-hop': { lsi: 90 }, 'triple-hop': { lsi: 80 } })];
    equal(evaluateCriterion(multi, { patient, today, sessions: one }).suggestion, SUGGESTION.NOT_MET);
    const missing = [session('2026-10-20', { 'single-hop': { lsi: 90 } })];
    equal(evaluateCriterion(multi, { patient, today, sessions: missing }).suggestion, SUGGESTION.NO_DATA);
  },
  'Metric "injured": waarde van de aangedane zijde (links of rechts)': () => {
    const flexion = { id: 'f', type: 'measurement', test: 'flexie', metric: 'injured', operator: '>=', threshold: 120 };
    const m = { flexie: { left: 125, right: 110 } };
    equal(evaluateCriterion(flexion, { patient: { ...patient, side: 'L' }, today, sessions: [session('2026-10-20', m)] }).suggestion, SUGGESTION.MET);
    equal(evaluateCriterion(flexion, { patient: { ...patient, side: 'R' }, today, sessions: [session('2026-10-20', m)] }).suggestion, SUGGESTION.NOT_MET);
  },
  'Operator "in": stroke test 0, spoor of 1+': () => {
    const stroke = { id: 's', type: 'measurement', test: 'stroke-test', metric: 'value', operator: 'in', values: ['0', 'spoor', '1+'] };
    const run = (value) => evaluateCriterion(stroke, { patient, today, sessions: [session('2026-10-20', { 'stroke-test': { value } })] }).suggestion;
    equal(run('spoor'), SUGGESTION.MET);
    equal(run('2+'), SUGGESTION.NOT_MET);
  },
  'Verschil-criterium: ≤ 0 betekent symmetrisch of beter': () => {
    const ext = { id: 'e', type: 'measurement', test: 'extensie', metric: 'difference', operator: '<=', threshold: 0 };
    const run = (difference) => evaluateCriterion(ext, { patient, today, sessions: [session('2026-10-20', { extensie: { difference } })] }).suggestion;
    equal(run(0), SUGGESTION.MET);
    equal(run(3), SUGGESTION.NOT_MET);
  },
  'Minimumtermijn in weken: 12 weken na 15 juli = 7 oktober': () => {
    const criterion = { id: 't', type: 'minTime', weeks: 12 };
    const result = evaluateCriterion(criterion, { patient, today, sessions: [] });
    equal(result.suggestion, SUGGESTION.MET);
    equal(result.details.reachedOn, '2026-10-07');
    const early = evaluateCriterion(criterion, { patient, today: '2026-10-01', sessions: [] });
    equal(early.suggestion, SUGGESTION.NOT_MET);
    equal(early.details.daysLeft, 6);
  },
  'Minimumtermijn in maanden, ook bij einde van de maand': () => {
    equal(addMonths('2026-01-31', 1), '2026-02-28');
    equal(addMonths('2026-07-15', 9), '2027-04-15');
    equal(addDays('2026-10-24', 7), '2026-10-31');
  },
  'Oordeel-criteria krijgen nooit een automatische suggestie': () => {
    equal(evaluateCriterion({ id: 'j', type: 'judgement' }, { patient, today, sessions: [] }).suggestion, SUGGESTION.JUDGEMENT);
  },
  'Voortgang: n.v.t. telt niet mee, volledig = vrij te geven': () => {
    const level = { criteria: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] };
    let progress = levelProgress(level, new Map([['a', { status: STATUS.MET }], ['b', { status: STATUS.MET }]]));
    equal([progress.met, progress.total, progress.canRelease], [2, 4, false]);
    progress = levelProgress(level, new Map([
      ['a', { status: STATUS.MET }], ['b', { status: STATUS.MET }], ['c', { status: STATUS.MET }], ['d', { status: STATUS.NOT_APPLICABLE }],
    ]));
    equal([progress.met, progress.total, progress.canRelease], [3, 3, true]);
  },
  'Een "lijkt voldaan"-suggestie vinkt nooit zelf iets af': () => {
    const level = { criteria: [lsiCriterion] };
    const sessions = [session('2026-10-20', { 'quad-iso': { lsi: 95 } })];
    equal(evaluateCriterion(lsiCriterion, { patient, today, sessions }).suggestion, SUGGESTION.MET);
    equal(levelProgress(level, new Map()).canRelease, false);
  },
  'Stadium: hoogste vrijgegeven level, afgerond na het laatste level': () => {
    const protocol = { levels: [{}, {}, {}, {}], completion: { title: 'Groen licht' } };
    equal(currentStage([{ level: 1 }]), 1);
    equal(currentStage([{ level: 1 }, { level: 2 }]), 2);
    ok(!isCompleted(4, protocol), 'level 4 is nog bezig');
    ok(isCompleted(5, protocol), 'na level 4 is afgerond');
    equal(stageLabel(protocol, 5), 'Groen licht');
    equal(stageLabel(protocol, 2), 'Level 2');
  },
  'VKB-protocol: 4 levels, criteria verwijzen naar bestaande tests': async () => {
    const protocol = validateProtocol(await (await fetch('../data/protocol-vkb.json')).json(), 'vkb');
    equal(protocol.levels.length, 4);
    ok(protocol.levels.every((level) => level.criteria.length > 0), 'elk level heeft criteria');
  },
  'validateProtocol weigert een criterium met een onbekende test': () => {
    const broken = {
      id: 'vkb', version: '1', name: 'x', codePrefix: 'VKB', dateLabel: 'd', sinceLabel: 's', patientFields: {},
      testGroups: [{ tests: [{ id: 't', label: 'T', type: 'single', min: 0, max: 1 }] }],
      levels: [{ number: 1, title: 'L', criteria: [{ id: 'c', label: 'C', type: 'measurement', test: 'bestaat-niet', metric: 'lsi', operator: '>=', threshold: 1 }] }],
    };
    let message = '';
    try { validateProtocol(broken, 'vkb'); } catch (error) { message = error.message; }
    ok(message.includes('bestaat niet'), message);
  },
};
