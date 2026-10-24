import { parseCsv, toRecords } from '../js/domain/csv.js';
import { validateProtocol } from '../js/domain/protocol.js';
import {
  buildImportSessions, detectDateOrder, matchPerson, metricUnit, parseValdExport, suggestMapping, toIsoDate,
} from '../js/domain/vald.js';
import { buildSession } from '../js/domain/test-session.js';
import { equal, ok } from './assert.js';

let fixture = null;
async function sample() {
  fixture ??= await (await fetch('./fixtures/vald-dynamo-sample.csv')).text();
  return fixture;
}

export const tests = {
  'CSV: aanhalingstekens, komma\'s in velden, nieuwe regels en CRLF': () => {
    const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,2,3');
    equal(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', 'line1\nline2'], ['1', '2', '3']]);
  },
  'CSV: BOM, puntkomma als scheidingsteken en lege regels': () => {
    equal(parseCsv('﻿a;b\n\n1;2\n'), [['a', 'b'], ['1', '2']]);
    equal(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  },
  'CSV: een puntkomma in een veld telt niet mee voor het scheidingsteken': () => {
    equal(parseCsv('"a;b;c",d\n1,2'), [['a;b;c', 'd'], ['1', '2']]);
  },
  'toRecords: rijen worden objecten, ontbrekende cellen leeg': () => {
    equal(toRecords([['a', 'b'], ['1']]).records, [{ a: '1', b: '' }]);
  },
  'Datumvolgorde: een getal boven 12 verraadt dag/maand of maand/dag': () => {
    equal(detectDateOrder(['02/09/2026', '15/10/2026']), { order: 'dmy', ambiguous: false });
    equal(detectDateOrder(['02/09/2026', '10/15/2026']), { order: 'mdy', ambiguous: false });
    equal(detectDateOrder(['02/09/2026']), { order: 'dmy', ambiguous: true });
    equal(detectDateOrder(['2026-09-02']), { order: 'dmy', ambiguous: false });
  },
  'Datum omzetten volgens de gekozen volgorde': () => {
    equal(toIsoDate('02/09/2026', 'dmy'), '2026-09-02');
    equal(toIsoDate('02/09/2026', 'mdy'), '2026-02-09');
    equal(toIsoDate('2026-09-02', 'dmy'), '2026-09-02');
    equal(toIsoDate('31/02/2026', 'dmy'), null);
    equal(toIsoDate('geen datum', 'dmy'), null);
  },
  'Eenheid uit de kolomnaam': () => {
    equal(metricUnit('Max Force (N)'), 'N');
    equal(metricUnit('RFD - 150ms (N/s)'), 'N/s');
    equal(metricUnit('Reps'), null);
  },
  'VALD-bestand: rijen, personen en metrics worden herkend': async () => {
    const result = parseValdExport(await sample());
    equal(result.errors, undefined);
    equal(result.rows.length, 5);
    equal(result.people.length, 2);
    ok(result.metrics.includes('Max Force (N)'), 'Max Force');
    equal(result.dateOrder, 'dmy');
    equal(result.datesAmbiguous, false);
    const first = result.rows[0];
    equal([first.date, first.region, first.movement, first.position], ['2026-10-15', 'Knee', 'Extension', 'Seated']);
    equal(first.values['Max Force (N)'], { left: 520, right: 480 });
  },
  'Privacy: de naam komt nergens in het resultaat, enkel initialen en External Id': async () => {
    const result = parseValdExport(await sample());
    const json = JSON.stringify(result);
    ok(!json.includes('Test Persoon') && !json.includes('Andere Persoon'), 'geen namen');
    ok(!/Persoon/i.test(json), 'ook geen delen van de naam');
    equal(result.people.map((p) => [p.initials, p.externalId]), [['T. P.', 'VKB-001'], ['A. P.', '']]);
  },
  'Personen zonder External Id worden op naam uit elkaar gehouden': () => {
    const csv = 'Name,External Id,Date,Movement,L Max Force (N),R Max Force (N)\nAnn Peeters,,15/10/2026,Extension,10,11\nBob Janssens,,15/10/2026,Extension,20,21\nAnn Peeters,,16/10/2026,Extension,12,13';
    const result = parseValdExport(csv);
    equal(result.people.map((p) => [p.id, p.initials, p.rows]), [['p1', 'A. P.', 2], ['p2', 'B. J.', 1]]);
    equal(result.rows.map((r) => r.personId), ['p1', 'p2', 'p1']);
  },
  'Rijen zonder waarden voor beide zijden worden overgeslagen, komma als decimaalteken werkt': () => {
    const csv = 'Name;External Id;Date;Movement;L Max Force (N);R Max Force (N)\nAnn;;15/10/2026;Extension;10,5;11,5\nAnn;;15/10/2026;Flexion;10;';
    const result = parseValdExport(csv);
    equal(result.rows.length, 1);
    equal(result.rows[0].values['Max Force (N)'], { left: 10.5, right: 11.5 });
  },
  'Geen VALD-bestand: duidelijke foutmelding': () => {
    ok(parseValdExport('a,b\n1,2').errors[0].includes('geen VALD Hub-export'), 'kolommen ontbreken');
    ok(parseValdExport('Date,Movement,Name\n15/10/2026,Extension,X').errors[0].includes('per zijde'), 'geen zijdekolommen');
    ok(parseValdExport('Date,Movement,L Max Force (N),R Max Force (N)\n15/10/2026,Extension,,').errors[0].includes('geen metingen'), 'geen waarden');
  },
  'Koppeling: eerst een bewaarde keuze, dan het protocol, anders niets': async () => {
    const { rows } = parseValdExport(await sample());
    const protocolMapping = [
      { match: { region: 'Knee', movement: 'Extension' }, test: 'quad-iso', metric: 'Max Force (N)' },
      { match: { region: 'Knee', movement: 'Flexion' }, test: 'ham-iso', metric: 'Max Force (N)' },
    ];
    equal(suggestMapping(rows[0], { protocolMapping }), { test: 'quad-iso', metric: 'Max Force (N)' });
    equal(suggestMapping(rows[1], { protocolMapping }), { test: 'ham-iso', metric: 'Max Force (N)' });
    equal(suggestMapping(rows[3], { protocolMapping }), null); // heupabductie: niet gekoppeld
    const saved = { [rows[0].testKey]: { test: 'ham-iso', metric: 'Avg Force (N)' } };
    equal(suggestMapping(rows[0], { saved, protocolMapping }), { test: 'ham-iso', metric: 'Avg Force (N)' });
  },
  'Persoon kiezen: External Id = patiëntcode, anders de enige persoon': async () => {
    const { people } = parseValdExport(await sample());
    equal(matchPerson(people, 'VKB-001'), 'p1');
    equal(matchPerson(people, 'vkb-001'), 'p1');
    equal(matchPerson(people, 'VKB-777'), null); // twee personen en geen match: laat kiezen
    equal(matchPerson([people[1]], 'VKB-777'), 'p2'); // één persoon: die is het
  },
  'Testmomenten: één per datum, enkel de aangevinkte rijen': async () => {
    const { rows } = parseValdExport(await sample());
    const mine = rows.filter((r) => r.personId === 'p1');
    const choose = (row, test) => ({ row, include: true, date: row.date, test, metric: 'Max Force (N)' });
    const result = buildImportSessions([choose(mine[0], 'quad-iso'), choose(mine[1], 'ham-iso'), choose(mine[2], 'quad-iso'), { ...choose(mine[3], null), include: false }]);
    equal(result.problems, []);
    equal(result.sessions, [
      { date: '2026-10-01', entries: { 'quad-iso': { left: '480', right: '470' } } },
      { date: '2026-10-15', entries: { 'quad-iso': { left: '520', right: '480' }, 'ham-iso': { left: '300', right: '280' } } },
    ]);
  },
  'Testmomenten: problemen worden gemeld in plaats van stil genegeerd': async () => {
    const { rows } = parseValdExport(await sample());
    const base = { include: true, metric: 'Max Force (N)' };
    const twice = buildImportSessions([{ ...base, row: rows[0], date: '2026-10-15', test: 'quad-iso' }, { ...base, row: rows[4], date: '2026-10-15', test: 'quad-iso' }]);
    ok(twice.problems[0].includes('dezelfde test op dezelfde dag'), 'dubbel');
    ok(buildImportSessions([{ ...base, row: rows[0], date: '2026-10-15', test: null }]).problems[0].includes('kies een test'), 'geen test');
    ok(buildImportSessions([{ ...base, row: rows[0], date: '', test: 'quad-iso' }]).problems[0].includes('datum'), 'geen datum');
    ok(buildImportSessions([{ ...base, row: rows[0], date: '2026-10-15', test: 'quad-iso', metric: 'Bestaat niet' }]).problems[0].includes('geen waarde'), 'geen waarde');
  },
  'Import levert dezelfde LSI op als handmatig ingeven (aangedaan links en rechts)': async () => {
    const protocol = validateProtocol(await (await fetch('../data/protocol-vkb.json')).json(), 'vkb');
    const entries = { 'quad-iso': { left: '520', right: '480' } };
    const today = '2026-10-24';
    const left = buildSession({ date: '2026-10-15', entries }, { protocol, patient: { side: 'L' }, today });
    const right = buildSession({ date: '2026-10-15', entries }, { protocol, patient: { side: 'R' }, today });
    equal(left.errors, {});
    equal(left.session.measurements['quad-iso'].lsi, 108.3); // aangedaan links: 520 ÷ 480
    equal(right.session.measurements['quad-iso'].lsi, 92.3); // aangedaan rechts: 480 ÷ 520
  },
  'Protocol: kracht heeft Nm als standaard en N als tweede keuze; de koppeling verwijst naar bestaande tests': async () => {
    const protocol = validateProtocol(await (await fetch('../data/protocol-vkb.json')).json(), 'vkb');
    const strength = protocol.testGroups.flatMap((g) => g.tests).filter((t) => ['quad-iso', 'ham-iso'].includes(t.id));
    equal(strength.map((t) => t.unit), ['Nm', 'Nm']);
    equal(strength.map((t) => t.units.map((u) => u.unit)), [['Nm', 'N'], ['Nm', 'N']]);
    equal(protocol.valdMapping.map((m) => m.test), ['quad-iso', 'ham-iso']);
  },
  'Import van een N-meting: de eenheid gaat mee naar het testmoment': async () => {
    const protocol = validateProtocol(await (await fetch('../data/protocol-vkb.json')).json(), 'vkb');
    const { rows } = parseValdExport(await sample());
    const row = rows[0];
    const { sessions } = buildImportSessions([{ row, include: true, date: row.date, test: 'quad-iso', metric: 'Max Force (N)', unit: metricUnit('Max Force (N)') }]);
    equal(sessions[0].entries['quad-iso'], { left: '520', right: '480', unit: 'N' });
    const built = buildSession({ date: row.date, entries: sessions[0].entries }, { protocol, patient: { side: 'L' }, today: '2026-10-24' });
    equal(built.errors, {});
    equal(built.session.measurements['quad-iso'].unit, 'N');
    equal(built.session.measurements['quad-iso'].lsi, 108.3);
  },
  'Protocol: een koppeling naar een onbekende test wordt geweigerd': async () => {
    const protocol = await (await fetch('../data/protocol-vkb.json')).json();
    protocol.valdMapping[0].test = 'bestaat-niet';
    let message = '';
    try { validateProtocol(protocol, 'vkb'); } catch (error) { message = error.message; }
    ok(message.includes('valdMapping'), message);
  },
};
