// LSI-grafiek per test over de tijd, met een gekleurde doelzone (bv. ≥ 90 %).
// Chart.js staat lokaal in vendor/ en wordt pas geladen als er een grafiek nodig is.

import { formatDate } from '../domain/dates.js';
import { unitOf } from '../domain/test-session.js';
import { h } from './dom.js';
import { formatNumber, withUnit } from './format.js';

let loading = null;
let activeCharts = [];

function loadChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './vendor/chart.umd.js';
      script.onload = () => resolve(window.Chart);
      script.onerror = () => {
        loading = null;
        reject(new Error('De grafieken konden niet geladen worden.'));
      };
      document.head.append(script);
    });
  }
  return loading;
}

/** Wacht tot het element in de pagina staat (de router voegt een scherm pas toe nadat het klaar is). */
function whenConnected(element, maxTries = 100) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      if (element.isConnected) resolve();
      else if (++tries > maxTries) reject(new Error('Scherm niet getoond.'));
      else setTimeout(check, 30);
    };
    check();
  });
}

/** Ruim grafieken van het vorige scherm op (Chart.js houdt anders resize-observers vast). */
export function destroyCharts() {
  for (const chart of activeCharts) chart.destroy();
  activeCharts = [];
}

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Tekent de doelzone (target tot de bovenkant van de grafiek) als een gekleurde band. */
const targetZonePlugin = {
  id: 'targetZone',
  beforeDatasetsDraw(chart, _args, options) {
    if (!Number.isFinite(options?.from)) return;
    const { ctx, chartArea, scales } = chart;
    const top = scales.y.getPixelForValue(scales.y.max);
    const bottom = scales.y.getPixelForValue(options.from);
    ctx.save();
    ctx.fillStyle = options.color;
    ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
    ctx.restore();
  },
};

/**
 * Bouwt een kaart met titel, feedbackzin, grafiek en een tabel met de absolute waarden.
 * series: [{ date, lsi, measurement }], oudste eerst.
 */
export function lsiChartCard({ test, series, target, feedback, sideLabels }) {
  const canvas = h('canvas', {
    role: 'img',
    'aria-label': `${test.patientLabel ?? test.label}: ${series.map((p) => `${formatDate(p.date)} ${formatNumber(p.lsi)} procent`).join(', ')}`,
  });
  const status = h('p', { class: 'chart-status muted', hidden: true });

  const card = h('div', { class: 'card chart-card' },
    h('h3', {}, test.patientLabel ?? test.label),
    feedback ? h('p', { class: 'chart-feedback' }, feedback) : null,
    h('div', { class: 'chart-wrap' }, canvas),
    status,
    h('p', { class: 'chart-legend muted' }, h('span', { class: 'legend-zone', 'aria-hidden': 'true' }), `Doelzone: vanaf ${formatNumber(target)} %`),
    valuesTable(test, series, sideLabels),
  );

  Promise.all([loadChartJs(), whenConnected(canvas)]).then(([Chart]) => {
    const primary = cssColor('--color-primary');
    const text = cssColor('--color-text-muted');
    const grid = cssColor('--color-border');
    const maxValue = Math.max(target + 10, ...series.map((p) => p.lsi + 5));

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: series.map((p) => formatDate(p.date)),
        datasets: [{
          data: series.map((p) => p.lsi),
          borderColor: primary,
          backgroundColor: primary,
          pointRadius: 6,
          pointHoverRadius: 8,
          borderWidth: 3,
          tension: 0.2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        scales: {
          y: { min: 0, max: Math.ceil(maxValue / 10) * 10, ticks: { color: text, stepSize: 20, callback: (v) => `${v} %` }, grid: { color: grid } },
          x: { ticks: { color: text }, grid: { display: false } },
        },
        plugins: {
          legend: { display: false },
          targetZone: { from: target, color: `${cssColor('--color-success')}33` },
          tooltip: {
            callbacks: {
              label: (item) => {
                const point = series[item.dataIndex];
                const m = point.measurement;
                const values = `${sideLabels.injured} ${withUnit(formatNumber(sideValue(m, 'injured', sideLabels.side), test.decimals), unitOf(test, m))}, ${sideLabels.healthy} ${withUnit(formatNumber(sideValue(m, 'healthy', sideLabels.side), test.decimals), unitOf(test, m))}`;
                return [`${formatNumber(point.lsi)} %`, values];
              },
            },
          },
        },
      },
      plugins: [targetZonePlugin],
    });
    activeCharts.push(chart);
  }).catch((error) => {
    if (!canvas.isConnected) return; // het scherm is al weggenavigeerd
    status.hidden = false;
    status.textContent = error.message;
  });

  return card;
}

function sideValue(measurement, which, side) {
  const injured = side === 'L' ? measurement.left : measurement.right;
  const healthy = side === 'L' ? measurement.right : measurement.left;
  return which === 'injured' ? injured : healthy;
}

/** Toegankelijk alternatief én de absolute waarden: een LSI van 100 % kan ook twee zwakke zijden betekenen. */
function valuesTable(test, series, sideLabels) {
  return h('details', { class: 'chart-table' },
    h('summary', {}, 'Toon de cijfers'),
    h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Datum'),
        h('th', { scope: 'col' }, sideLabels.injured),
        h('th', { scope: 'col' }, sideLabels.healthy),
        h('th', { scope: 'col' }, 'Verhouding'))),
      h('tbody', {}, [...series].reverse().map((point) => h('tr', {},
        h('td', {}, formatDate(point.date)),
        h('td', {}, withUnit(formatNumber(sideValue(point.measurement, 'injured', sideLabels.side), test.decimals), unitOf(test, point.measurement))),
        h('td', {}, withUnit(formatNumber(sideValue(point.measurement, 'healthy', sideLabels.side), test.decimals), unitOf(test, point.measurement))),
        h('td', {}, `${formatNumber(point.lsi)} %`))))),
  );
}
