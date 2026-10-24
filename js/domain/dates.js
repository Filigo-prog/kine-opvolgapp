// Datums worden bewaard als 'JJJJ-MM-DD' (lokale kalenderdag, zonder tijdzone).

export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Aantal kalenderdagen van 'from' tot 'to' (beide 'JJJJ-MM-DD'). */
export function daysBetween(from, to) {
  const toUtc = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86400000);
}

/** "3 dagen" de eerste twee weken, daarna "6 weken". */
export function describeTimeSince(fromIso, todayIsoValue = todayIso()) {
  const days = daysBetween(fromIso, todayIsoValue);
  if (days < 0) return 'in de toekomst';
  if (days < 14) return days === 1 ? '1 dag' : `${days} dagen`;
  const weeks = Math.floor(days / 7);
  return `${weeks} weken`;
}

const formatter = new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });

export function formatDate(iso) {
  if (!isIsoDate(iso)) return '–';
  const [y, m, d] = iso.split('-').map(Number);
  return formatter.format(new Date(y, m - 1, d));
}

/** 'JJJJ-MM-DD' + n kalenderdagen. */
export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** 'JJJJ-MM-DD' + n maanden; 31 jan + 1 maand → 28/29 feb. */
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
