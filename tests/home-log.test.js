import { streakFeedback } from '../js/domain/feedback.js';
import { earnedMilestones } from '../js/domain/milestones.js';
import { normalizeLogEntry, streakFrom, streakInfo, weekStart, weeklyRun } from '../js/domain/home-log.js';
import { validateProtocol } from '../js/domain/protocol.js';
import { equal, ok } from './assert.js';

// 2026-10-26 is een maandag; 2026-10-24 (vandaag in de app) is een zaterdag.
const log = (...dates) => new Map(dates.map((date) => [date, { done: true, pain: null, swelling: null }]));
const today = '2026-10-24';

export const tests = {
  'weekStart: maandag als eerste dag van de week': () => {
    equal(weekStart('2026-10-24'), '2026-10-19'); // zaterdag
    equal(weekStart('2026-10-19'), '2026-10-19'); // maandag
    equal(weekStart('2026-10-25'), '2026-10-19'); // zondag
    equal(weekStart('2026-10-26'), '2026-10-26');
  },
  'Streak: opeenvolgende dagen tellen, vandaag nog niet geoefend telt niet als gemist': () => {
    equal(streakInfo(log('2026-10-21', '2026-10-22', '2026-10-23'), today).current, 3);
    equal(streakInfo(log('2026-10-22', '2026-10-23', '2026-10-24'), today).current, 3);
  },
  'Streak: zonder oefeningen is de reeks 0 en is er geen "hasAny"': () => {
    const info = streakInfo(new Map(), today);
    equal([info.current, info.longest, info.hasAny], [0, 0, false]);
  },
  'Streak: één gemiste dag per week wordt vergeven door de rustdag-joker': () => {
    // di, wo, (do gemist), vr, za → reeks van 4 dagen, joker gebruikt
    const info = streakInfo(log('2026-10-20', '2026-10-21', '2026-10-23', '2026-10-24'), today);
    equal(info.current, 4);
    ok(info.jokerUsedThisWeek, 'joker gebruikt');
    ok(!info.jokerAvailable, 'joker niet meer beschikbaar');
  },
  'Streak: twee gemiste dagen in dezelfde week breken de reeks': () => {
    // ma, (di gemist), wo, (do gemist), vr, za → enkel de recentste gemiste dag wordt vergeven
    const info = streakInfo(log('2026-10-19', '2026-10-21', '2026-10-23', '2026-10-24'), today);
    equal(info.current, 3); // za, vr, wo (do vergeven); di breekt
  },
  'Streak: twee gemiste dagen na elkaar breken de reeks, ook met joker': () => {
    equal(streakInfo(log('2026-10-20', '2026-10-21', '2026-10-24'), today).current, 1);
  },
  'Streak: een nieuwe week geeft een nieuwe joker': () => {
    // Zondag 18 okt hoort bij de week van maandag 12 okt, dus die week heeft nog een joker voor die gemiste zondag.
    const l = log('2026-10-16', '2026-10-17', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24');
    const info = streakInfo(l, today);
    equal(info.current, 8);
  },
  'Streak: de langste reeks blijft bewaard na een onderbreking': () => {
    const l = log('2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-24');
    const info = streakInfo(l, today);
    equal([info.current, info.longest], [1, 5]);
  },
  'Streak: zonder jokers (0 per week) breekt elke gemiste dag': () => {
    equal(streakFrom(log('2026-10-20', '2026-10-22'), '2026-10-22', { jokersPerWeek: 0 }).count, 1);
    equal(streakFrom(log('2026-10-20', '2026-10-22'), '2026-10-22', { jokersPerWeek: 1 }).count, 2);
  },
  'Wekenreeks: opeenvolgende weken met minstens 2 oefendagen': () => {
    // weken van 5, 12, 19 oktober
    const l = log('2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22');
    equal(weeklyRun(l, { perWeek: 2, weeks: 3 }), { bestRun: 3, earnedOn: '2026-10-22' });
    equal(weeklyRun(l, { perWeek: 2, weeks: 4 }).earnedOn, null);
  },
  'Wekenreeks: een zwakke week onderbreekt de reeks': () => {
    const l = log('2026-10-06', '2026-10-08', '2026-10-13', '2026-10-20', '2026-10-22');
    equal(weeklyRun(l, { perWeek: 2, weeks: 2 }).bestRun, 1);
  },
  'Wekenreeks: enkel dagen vanaf de return to sport tellen': () => {
    const l = log('2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22');
    equal(weeklyRun(l, { perWeek: 2, weeks: 2, from: '2026-10-13' }), { bestRun: 2, earnedOn: '2026-10-22' });
    equal(weeklyRun(l, { perWeek: 2, weeks: 3, from: '2026-10-13' }).earnedOn, null);
  },
  'normalizeLogEntry: pijn 0 tot 10, zwelling enkel als de knie dat bijhoudt': () => {
    equal(normalizeLogEntry({ done: true, pain: '3' }), { done: true, pain: 3, swelling: null });
    equal(normalizeLogEntry({ done: false, pain: 0 }), { done: false, pain: 0, swelling: null });
    equal(normalizeLogEntry({ done: false, pain: 11 }), null);
    equal(normalizeLogEntry({ done: false, swelling: 'licht' }, { tracksSwelling: true }), { done: false, pain: null, swelling: 'licht' });
    equal(normalizeLogEntry({ done: false, swelling: 'licht' }, { tracksSwelling: false }), null);
    equal(normalizeLogEntry({ done: false }), null);
  },
  'Streakzin: positief en zonder druk, ook na een pauze': () => {
    equal(streakFeedback({ current: 0, longest: 0, hasAny: false }), 'Zodra je thuis oefent, zie je hier je reeks.');
    equal(streakFeedback({ current: 1, longest: 1, hasAny: true, jokerUsedThisWeek: false }), 'Je oefende 1 dag na elkaar.');
    equal(streakFeedback({ current: 4, longest: 6, hasAny: true, jokerUsedThisWeek: true }), 'Je oefende 4 dagen na elkaar. Je rustdag-joker van deze week is gebruikt.');
    const paused = streakFeedback({ current: 0, longest: 6, hasAny: true });
    ok(paused.includes('beste reeks is 6 dagen'), paused);
    ok(!/mist|gemist|reset|verloren|achter|faal/i.test(paused), `geen schuldgevoel: ${paused}`);
  },
  'Preventiekampioen: pas na de return to sport en 6 weken met 2 oefendagen': () => {
    const protocol = {
      levels: [{}],
      milestones: [{ id: 'p', label: 'Preventiekampioen', trigger: { type: 'homeLogWeeks', weeks: 2, perWeek: 2, from: 'completion' } }],
    };
    const base = { protocol, sessions: [], statuses: new Map(), manual: new Map() };
    const l = log('2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22');
    const notDone = [{ level: 1, date: '2026-10-01' }];
    equal(earnedMilestones({ ...base, history: notDone, homeLog: l }), []);
    const done = [{ level: 1, date: '2026-10-01' }, { level: 2, date: '2026-10-12' }];
    equal(earnedMilestones({ ...base, history: done, homeLog: l }), [{ id: 'p', date: '2026-10-22' }]);
  },
  'Protocollen: thuislog, preventie en mijlpaal zijn geldig': async () => {
    const enkel = validateProtocol(await (await fetch('../data/protocol-enkel.json')).json(), 'enkel');
    equal(enkel.homeLog.tracksSwelling, false);
    ok(Number.isInteger(enkel.prevention.weeks) && enkel.prevention.weeks > 0, 'aantal weken');
    ok(Number.isInteger(enkel.prevention.perWeek) && enkel.prevention.perWeek >= 1 && enkel.prevention.perWeek <= 7, 'dagen per week');
    ok(enkel.milestones.some((m) => m.trigger.type === 'homeLogWeeks'), 'Preventiekampioen');
    const vkb = validateProtocol(await (await fetch('../data/protocol-vkb.json')).json(), 'vkb');
    equal(vkb.homeLog.tracksSwelling, true);
  },
  'Protocol: ongeldige wekenreeks-trigger wordt geweigerd': async () => {
    const enkel = await (await fetch('../data/protocol-enkel.json')).json();
    enkel.milestones.at(-1).trigger.perWeek = 9;
    let message = '';
    try { validateProtocol(enkel, 'enkel'); } catch (error) { message = error.message; }
    ok(message.includes('perWeek'), message);
  },
};
