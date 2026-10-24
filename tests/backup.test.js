import {
  APP_ID, FORMAT_VERSION, REMINDER_DAYS, backupReminder, backupReminderText, buildBackup, describeCount, describeLastBackup,
  parseBackup, planImport, summarizeBackup,
} from '../js/domain/backup.js';
import { equal, ok } from './assert.js';

const patient = (code, extra = {}) => ({
  code, injury: 'vkb', side: 'L', injuryDate: '2026-07-15', associatedInjuries: [], protocolVersion: '2026-10-24', ...extra,
});

const sample = () => ({
  patients: [patient('VKB-001'), patient('VKB-002'), patient('ENK-001', { injury: 'enkel', side: 'R' })],
  testSessions: [
    { id: 's1', patientCode: 'VKB-001', date: '2026-10-01', measurements: { 'quad-iso': { left: 1, right: 2, lsi: 50 } } },
    { id: 's2', patientCode: 'VKB-002', date: '2026-10-02', measurements: {} },
  ],
  criteriaStatus: [{ patientCode: 'VKB-001', criterionId: 'vkb-1-gang', status: 'voldaan', date: '2026-10-03' }],
  levelHistory: [
    { id: 'l1', patientCode: 'VKB-001', level: 1, date: '2026-07-15' },
    { id: 'l2', patientCode: 'VKB-002', level: 1, date: '2026-07-20' },
    { id: 'l3', patientCode: 'ENK-001', level: 1, date: '2026-10-21' },
  ],
  milestones: [{ patientCode: 'VKB-001', milestoneId: 'vkb-krukken', date: '2026-10-03', source: 'auto' }],
  homeLog: [{ patientCode: 'VKB-001', date: '2026-10-20', done: true, pain: 2, swelling: null }],
});

const roundtrip = (data) => parseBackup(JSON.stringify(buildBackup(data, new Date('2026-10-24T12:00:00Z'))));

export const tests = {
  'Back-up: bouwen en weer inlezen geeft dezelfde gegevens terug': () => {
    const { backup, errors } = roundtrip(sample());
    equal(errors, undefined);
    equal(backup.data, sample());
    equal([backup.app, backup.formatVersion], [APP_ID, FORMAT_VERSION]);
    equal(backup.counts, { patients: 3, testSessions: 2, criteriaStatus: 1, levelHistory: 3, milestones: 1, homeLog: 1 });
  },
  'Back-up bevat nooit instellingen zoals de pincode': () => {
    const backup = buildBackup({ ...sample(), settings: [{ key: 'pin', value: { hash: 'x' } }] });
    ok(!JSON.stringify(backup).includes('"pin"'), 'geen pincode in het bestand');
    equal(Object.keys(backup.data).sort(), ['criteriaStatus', 'homeLog', 'levelHistory', 'milestones', 'patients', 'testSessions']);
  },
  'Lege lijsten en ontbrekende stores worden aanvaard': () => {
    const { backup } = parseBackup(JSON.stringify({ app: APP_ID, formatVersion: 1, exportedAt: 'x', data: { patients: [] } }));
    equal(backup.data.patients, []);
    equal(backup.data.homeLog, []);
  },
  'Geweigerd: geen JSON, een ander bestand of een nieuwere versie': () => {
    ok(parseBackup('dit is geen json').errors[0].includes('geen JSON'), 'geen JSON');
    ok(parseBackup('{"a":1}').errors[0].includes('niet uit deze app'), 'andere app');
    ok(parseBackup('[]').errors[0].includes('niet uit deze app'), 'lijst');
    ok(parseBackup(JSON.stringify({ app: APP_ID, formatVersion: 99, data: {} })).errors[0].includes('nieuwere versie'), 'nieuwere versie');
    ok(parseBackup(JSON.stringify({ app: APP_ID, data: {} })).errors[0].includes('versie ontbreekt'), 'versie ontbreekt');
    ok(parseBackup(JSON.stringify({ app: APP_ID, formatVersion: 1 })).errors[0].includes('gegevens ontbreken'), 'data ontbreekt');
  },
  'Geweigerd: een naam of geboortedatum in plaats van een code': () => {
    const data = sample();
    data.patients[0].code = 'Jan Peeters';
    ok(roundtrip(data).errors.some((e) => e.includes('patients')), 'naam als code');
  },
  'Geweigerd: onbruikbare records, dubbele codes en verkeerde types': () => {
    const bad = sample();
    bad.testSessions[0].date = '2026-13-45';
    ok(roundtrip(bad).errors.some((e) => e.includes('testSessions')), 'ongeldige datum');

    const dup = sample();
    dup.patients.push(patient('VKB-001'));
    ok(roundtrip(dup).errors.some((e) => e.includes('meer dan één keer')), 'dubbele code');

    const status = sample();
    status.criteriaStatus[0].status = 'misschien';
    ok(roundtrip(status).errors.some((e) => e.includes('criteriaStatus')), 'onbekende status');

    const notList = sample();
    notList.homeLog = 'x';
    ok(roundtrip(notList).errors.some((e) => e.includes('homeLog')), 'geen lijst');
  },
  'Geweigerd: een deel kapot betekent het hele bestand weigeren (niets half terugzetten)': () => {
    const data = sample();
    data.levelHistory[1].level = 0;
    const result = roundtrip(data);
    ok(result.errors && !result.backup, 'geen backup teruggeven');
  },
  'Voorbeeld: wat is nieuw en wat bestaat al': () => {
    const { backup } = roundtrip(sample());
    const summary = summarizeBackup(backup, ['VKB-002', 'VKB-050']);
    equal(summary.codes, ['ENK-001', 'VKB-001', 'VKB-002']);
    equal(summary.newCodes, ['ENK-001', 'VKB-001']);
    equal(summary.existingCodes, ['VKB-002']);
  },
  'Importplan "aanvullen": enkel nieuwe patiënten, bestaande blijven onaangeroerd': () => {
    const { backup } = roundtrip(sample());
    const plan = planImport(backup, 'add', ['VKB-002']);
    equal(plan.records.patients.map((p) => p.code), ['VKB-001', 'ENK-001']);
    equal(plan.records.testSessions.map((s) => s.id), ['s1']);
    equal(plan.records.levelHistory.map((l) => l.id), ['l1', 'l3']);
    equal(plan.patientCount, 2);
    equal(plan.skipped, 3); // de bestaande patiënt VKB-002 zelf, zijn sessie s2 en zijn levelvrijgave l2
  },
  'Importplan "vervangen": alles uit de back-up': () => {
    const { backup } = roundtrip(sample());
    const plan = planImport(backup, 'replace', ['VKB-002', 'VKB-050']);
    equal(plan.counts, backup.counts);
    equal([plan.patientCount, plan.skipped], [3, 0]);
  },
  'Importplan negeert records zonder patiënt (wezen)': () => {
    const data = sample();
    data.homeLog.push({ patientCode: 'VKB-099', date: '2026-10-21', done: true });
    const { backup } = roundtrip(data);
    const plan = planImport(backup, 'replace', []);
    equal(plan.counts.homeLog, 1);
    equal(plan.skipped, 1);
  },
  'Importplan weigert een onbekende modus': () => {
    const { backup } = roundtrip(sample());
    let failed = false;
    try { planImport(backup, 'samenvoegen', []); } catch { failed = true; }
    ok(failed, 'moet falen');
  },
  'Herinnering: nooit, oud of in orde — en niets zonder gegevens': () => {
    const now = new Date('2026-10-24T12:00:00');
    equal(backupReminder({ lastBackupAt: null, hasData: false, now }), null);
    equal(backupReminder({ lastBackupAt: null, hasData: true, now }), { kind: 'never', days: null });
    equal(backupReminder({ lastBackupAt: '2026-10-20T10:00:00', hasData: true, now }), null);
    equal(backupReminder({ lastBackupAt: '2026-10-10T10:00:00', hasData: true, now }), { kind: 'old', days: 14 });
    equal(REMINDER_DAYS, 14);
    ok(backupReminderText({ kind: 'old', days: 20 }).includes('20 dagen'), 'tekst');
    ok(backupReminderText({ kind: 'never', days: null }).includes('nog geen back-up'), 'tekst nooit');
    equal(backupReminderText(null), null);
  },
  'Laatste back-up wordt leesbaar beschreven': () => {
    const now = new Date('2026-10-24T12:00:00');
    equal(describeLastBackup(null, now), 'Nog nooit een back-up gemaakt.');
    equal(describeLastBackup('2026-10-24T08:00:00', now), { date: '2026-10-24', when: 'vandaag' });
    equal(describeLastBackup('2026-10-23T08:00:00', now).when, 'gisteren');
    equal(describeLastBackup('2026-10-10T08:00:00', now).when, '14 dagen geleden');
  },
  'Enkelvoud en meervoud in het voorbeeld': () => {
    equal(describeCount('patients', 1), '1 patiënt');
    equal(describeCount('patients', 3), '3 patiënten');
    equal(describeCount('homeLog', 0), '0 oefendagen');
  },
};
