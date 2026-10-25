// Patiëntoverzicht als PDF: inhoud (geen naam, juiste cijfers) en een geldig PDF-bestand.

import { buildOverview, overviewFileName } from '../js/domain/overview.js';
import { buildPdf, textWidth, wrapText } from '../js/domain/pdf.js';
import { validateProtocol } from '../js/domain/protocol.js';
import { equal, ok } from './assert.js';

const protocolPromise = async () => validateProtocol(await (await fetch('../data/protocol-vkb.json')).json(), 'vkb');
const patient = { code: 'VKB-024', injury: 'vkb', side: 'L', injuryDate: '2026-02-10' };
const today = '2026-10-25';
const history = [{ level: 1, date: '2026-02-10' }];
const session = (date, entries) => ({ date, measurements: entries });
const text = (blocks) => blocks.map((b) => [b.text, ...(b.items ?? []).map((i) => i.text ?? i)].join(' ')).join('\n');

export const tests = {
  'Overzicht: code, level en voortgang staan erin, geen naam': async () => {
    const protocol = await protocolPromise();
    const first = protocol.levels[0].criteria[0].id;
    const blocks = buildOverview({ patient, protocol, statuses: { [first]: { status: 'voldaan' } }, history, sessions: [], dates: new Map(), today });
    const all = text(blocks);
    ok(all.includes('VKB-024'), 'code');
    ok(all.includes(protocol.levels[0].title), 'leveltitel');
    ok(blocks.some((b) => b.type === 'progress'), 'voortgangsbalk');
    ok(!/naam|geboorte/i.test(all.replace('Dit overzicht', '')), 'geen naam of geboortedatum');
  },
  'Overzicht: behaalde stappen staan afgevinkt, n.v.t. blijft weg': async () => {
    const protocol = await protocolPromise();
    const [a, b, c] = protocol.levels[0].criteria.filter((x) => x.patientLabel);
    const statuses = new Map([[a.id, { status: 'voldaan' }], [b.id, { status: 'nvt' }]]);
    const blocks = buildOverview({ patient, protocol, statuses, history, sessions: [], dates: new Map(), today });
    const list = blocks.find((x) => x.type === 'checklist').items;
    equal(list.find((i) => i.done)?.text.length > 0, true);
    equal(list.filter((i) => i.done).length, 1);
    ok(list.length === protocol.levels[0].criteria.filter((x) => x.patientLabel).length - 1, 'n.v.t. weggelaten');
    ok(c, 'derde criterium bestaat');
  },
  'Overzicht: laatste meting met beide zijden en een grafiek met alle punten': async () => {
    const protocol = await protocolPromise();
    const sessions = [
      session('2026-10-20', { 'quad-iso': { left: 240, right: 300, unit: 'Nm', lsi: 80 } }),
      session('2026-09-20', { 'quad-iso': { left: 200, right: 300, unit: 'Nm', lsi: 66.7 } }),
    ];
    const blocks = buildOverview({ patient, protocol, statuses: new Map(), history, sessions, dates: new Map(), today });
    const chart = blocks.find((b) => b.type === 'chart');
    equal(chart.points.map((p) => Math.round(p.value)), [67, 80], 'oudste eerst');
    const at = blocks.indexOf(chart);
    ok(blocks.slice(0, at).some((b) => b.type === 'ensure'), 'titel en grafiek blijven samen op één pagina');
    ok(text(blocks).includes('240 Nm') && text(blocks).includes('300 Nm'), 'absolute waarden naast de LSI');
  },
  'Overzicht: zonder metingen geen grafieken; asymmetrie-tests komen niet in de grafiek': async () => {
    const protocol = await protocolPromise();
    equal(buildOverview({ patient, protocol, statuses: new Map(), history, sessions: [], dates: new Map(), today }).some((b) => b.type === 'chart'), false);
    const sessions = [session('2026-10-20', { 'sl-landing-pfa': { left: 900, right: 1000, asymmetry: 10 } })];
    equal(buildOverview({ patient, protocol, statuses: new Map(), history, sessions, dates: new Map(), today }).some((b) => b.type === 'chart'), false);
  },
  'Overzicht: behaalde mijlpalen met datum': async () => {
    const protocol = await protocolPromise();
    const id = protocol.milestones[0].id;
    const blocks = buildOverview({ patient, protocol, statuses: new Map(), history, sessions: [], dates: new Map([[id, '2026-09-01']]), today });
    ok(text(blocks).includes('1 van de'), 'telling');
    ok(text(blocks).includes('1 sep 2026'), 'datum');
  },
  'Bestandsnaam bevat de code en de datum': () => {
    equal(overviewFileName(patient, today), 'overzicht-VKB-024-2026-10-25.pdf');
  },
  'PDF: geldige structuur, offsets kloppen, enkel ASCII': async () => {
    const protocol = await protocolPromise();
    const pdf = buildPdf(buildOverview({ patient, protocol, statuses: new Map(), history, sessions: [session('2026-10-20', { 'quad-iso': { left: 240, right: 300, unit: 'Nm', lsi: 80 } })], dates: new Map(), today }), { footer: 'VKB-024' });
    ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'), 'kop en einde');
    ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(pdf), 'enkel ASCII');
    const start = Number(pdf.match(/startxref\n(\d+)/)[1]);
    ok(pdf.slice(start).startsWith('xref'), 'startxref wijst naar xref');
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => ok(pdf.slice(offset).startsWith(`${i + 1} 0 obj`), `object ${i + 1} staat op zijn offset`));
    for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const from = m.index + m[0].length;
      equal(pdf.slice(from + Number(m[1]), from + Number(m[1]) + 10), '\nendstream', 'streamlengte');
    }
  },
  'PDF: accenten en bijzondere tekens worden veilig weggeschreven, haakjes ontsnapt': () => {
    const pdf = buildPdf([{ type: 'text', text: 'Café (één) \\ ≥ 90 % – “test”' }], { footer: 'x' });
    ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(pdf), 'ASCII');
    ok(pdf.includes('Caf\\351'), 'é als octaal');
    ok(pdf.includes('\\(\\351\\351n\\)') || pdf.includes('\\('), 'haakjes ontsnapt');
    ok(pdf.includes('>= 90'), '≥ vervangen');
  },
  'PDF: lange teksten breken af en lopen door op een tweede pagina': () => {
    const blocks = Array.from({ length: 120 }, (_, i) => ({ type: 'text', text: `Regel ${i} met wat tekst om de pagina te vullen.` }));
    const pdf = buildPdf(blocks, { footer: 'x' });
    ok(Number(pdf.match(/\/Count (\d+)/)[1]) >= 3, 'meerdere pagina’s');
    const lines = wrapText('woord '.repeat(60), 11, 200);
    ok(lines.length > 5 && lines.every((l) => textWidth(l, 11) <= 200), 'elke regel past');
  },
};
