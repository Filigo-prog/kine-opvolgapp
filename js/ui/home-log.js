// Thuisoefenlog: weekraster, streak en een invulpaneel per dag.
// Gebruikt door de patiënt (patiëntmodus) en de therapeut: dezelfde gegevens, dezelfde knoppen.

import { addDays, formatDate } from '../domain/dates.js';
import { streakFeedback } from '../domain/feedback.js';
import { PAIN_MAX, SWELLING_OPTIONS, doneInWeek, streakInfo, weekDays, weekStart } from '../domain/home-log.js';
import { saveHomeLogEntry } from '../repo/home-log.js';
import { h } from './dom.js';

const WEEKDAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const longDay = new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return longDay.format(new Date(y, m - 1, d));
}

/**
 * log: Map (wordt bijgewerkt bij elke wijziging).
 * config: protocol.homeLog; onSaved(): wordt na elke bewaarde wijziging aangeroepen.
 */
export function homeLogCard({ patient, log, config, today, title, intro, onSaved }) {
  const jokersPerWeek = config.jokersPerWeek ?? 1;
  const tracksSwelling = Boolean(config.tracksSwelling);
  const firstDay = patient.injuryDate;
  const firstWeek = weekStart(firstDay);
  const currentWeek = weekStart(today);

  let shownWeek = currentWeek;
  let selected = today;
  const card = h('div', { class: 'card home-log' });

  async function save(date, changes) {
    const entry = { ...(log.get(date) ?? { done: false, pain: null, swelling: null }), ...changes };
    const saved = await saveHomeLogEntry(patient.code, date, entry, { tracksSwelling });
    if (saved) log.set(date, saved);
    else log.delete(date);
    draw();
    await onSaved?.();
  }

  function canEdit(date) {
    return date <= today && date >= firstDay;
  }

  function draw() {
    const info = streakInfo(log, today, { jokersPerWeek });
    card.replaceChildren(
      h('h2', {}, title ?? config.title ?? 'Thuisoefeningen'),
      intro ? h('p', { class: 'muted' }, intro) : null,
      streakBlock(info),
      weekNav(),
      h('div', { class: 'week-grid', role: 'group', 'aria-label': 'Dagen van de week' }, weekDays(shownWeek).map(dayCell)),
      canEdit(selected) && weekDays(shownWeek).includes(selected) ? dayEditor(selected) : h('p', { class: 'muted' }, 'Tik op een dag om in te vullen.'),
    );
  }

  function streakBlock(info) {
    return h('div', { class: 'streak' },
      h('div', { class: 'streak-number', 'aria-hidden': 'true' }, String(info.current)),
      h('div', { class: 'streak-text' },
        h('p', { class: 'streak-feedback' }, streakFeedback(info)),
        h('p', { class: 'muted streak-meta' },
          `Deze week: ${info.doneThisWeek} van 7 dagen`,
          info.longest > 0 ? ` · Beste reeks: ${info.longest} ${info.longest === 1 ? 'dag' : 'dagen'}` : '',
          jokersPerWeek > 0 ? ` · Rustdag-joker: ${info.jokerAvailable ? 'beschikbaar' : 'gebruikt'}` : ''),
      ),
    );
  }

  function weekNav() {
    const days = weekDays(shownWeek);
    const label = `Week van ${formatDate(days[0])}`;
    return h('div', { class: 'week-nav' },
      h('button', {
        type: 'button', class: 'btn btn-secondary', disabled: shownWeek <= firstWeek, 'aria-label': 'Vorige week',
        onclick: () => { shownWeek = addDays(shownWeek, -7); selected = addDays(shownWeek, 6); draw(); },
      }, '‹'),
      h('span', { class: 'week-label' }, label, h('span', { class: 'muted' }, ` · ${doneInWeek(log, shownWeek)} van 7`)),
      h('button', {
        type: 'button', class: 'btn btn-secondary', disabled: shownWeek >= currentWeek, 'aria-label': 'Volgende week',
        onclick: () => { shownWeek = addDays(shownWeek, 7); selected = shownWeek === currentWeek ? today : addDays(shownWeek, 6); draw(); },
      }, '›'),
    );
  }

  function dayCell(date, index) {
    const entry = log.get(date);
    const editable = canEdit(date);
    const state = entry?.done ? 'done' : (entry ? 'partial' : 'empty');
    return h('button', {
      type: 'button',
      class: `day-cell day-${state}${date === selected ? ' day-selected' : ''}${date === today ? ' day-today' : ''}`,
      disabled: !editable,
      'aria-pressed': String(date === selected),
      'aria-label': `${longDate(date)}: ${entry?.done ? 'geoefend' : 'niet geoefend'}${entry?.pain != null ? `, pijn ${entry.pain}` : ''}`,
      onclick: () => { selected = date; draw(); },
    },
      h('span', { class: 'day-name' }, WEEKDAYS[index]),
      h('span', { class: 'day-number' }, String(Number(date.slice(8)))),
      h('span', { class: 'day-mark', 'aria-hidden': 'true' }, entry?.done ? '✓' : ''),
      h('span', { class: 'day-pain', 'aria-hidden': 'true' }, entry?.pain != null ? `p${entry.pain}` : ''),
    );
  }

  function dayEditor(date) {
    const entry = log.get(date) ?? { done: false, pain: null, swelling: null };
    const choice = (name, options, current, onPick, extra = '') => h('div', { class: `segmented ${extra}` },
      options.map((option) => h('label', { class: 'segment' },
        h('input', { type: 'radio', name, value: String(option.value), checked: String(current ?? '') === String(option.value), onchange: () => onPick(option.value) }),
        h('span', {}, option.label),
      )));

    return h('div', { class: 'day-editor' },
      h('h3', {}, longDate(date)),
      h('fieldset', { class: 'field' },
        h('legend', { class: 'field-label' }, config.question ?? 'Heb je geoefend?'),
        choice('done', [{ value: 'ja', label: 'Ja, geoefend' }, { value: 'nee', label: 'Niet geoefend' }],
          log.has(date) ? (entry.done ? 'ja' : 'nee') : '', (value) => save(date, { done: value === 'ja' })),
      ),
      h('fieldset', { class: 'field' },
        h('legend', { class: 'field-label' }, `Pijn (0 = geen pijn, ${PAIN_MAX} = ergste pijn)`),
        choice('pain',
          [{ value: '', label: '–' }, ...Array.from({ length: PAIN_MAX + 1 }, (_, i) => ({ value: i, label: String(i) }))],
          entry.pain, (value) => save(date, { pain: value === '' ? null : Number(value) }), 'segmented-compact'),
      ),
      tracksSwelling
        ? h('fieldset', { class: 'field' },
          h('legend', { class: 'field-label' }, 'Zwelling van je knie'),
          choice('swelling', [{ value: '', label: 'Niet ingevuld' }, ...SWELLING_OPTIONS], entry.swelling,
            (value) => save(date, { swelling: value || null })),
        )
        : null,
    );
  }

  draw();
  return card;
}
