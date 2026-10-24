// Levels en voortgang. Een level gaat enkel open na bevestiging door de therapeut,
// en enkel als alle criteria van het huidige level door de therapeut als voldaan of n.v.t. zijn aangeduid.

import { STATUS } from './criteria.js';

/** Huidig stadium = hoogste vrijgegeven level (1 als er nog niets is). Eén meer dan het aantal levels = afgerond. */
export function currentStage(levelHistory) {
  return levelHistory.reduce((max, entry) => Math.max(max, entry.level), 1);
}

export function isCompleted(stage, protocol) {
  return protocol.levels.length > 0 && stage > protocol.levels.length;
}

export function levelByNumber(protocol, number) {
  return protocol.levels.find((level) => level.number === number) ?? null;
}

export function stageLabel(protocol, stage) {
  if (isCompleted(stage, protocol)) return protocol.completion?.title ?? 'Afgerond';
  return `Level ${stage}`;
}

/** statuses: Map of object criterionId → { status } */
export function statusOf(statuses, criterionId) {
  const record = statuses instanceof Map ? statuses.get(criterionId) : statuses[criterionId];
  return record?.status ?? STATUS.NOT_MET;
}

/** Voortgang binnen een level: aandeel criteria dat voldaan is (n.v.t. telt niet mee in het totaal). */
export function levelProgress(level, statuses) {
  let met = 0;
  let notApplicable = 0;
  for (const criterion of level.criteria) {
    const status = statusOf(statuses, criterion.id);
    if (status === STATUS.MET) met += 1;
    else if (status === STATUS.NOT_APPLICABLE) notApplicable += 1;
  }
  const total = level.criteria.length - notApplicable;
  return {
    met,
    total,
    notApplicable,
    canRelease: level.criteria.length > 0 && met === total,
  };
}

/** Label van de knop om het volgende level vrij te geven. */
export function releaseLabel(protocol, level) {
  const next = levelByNumber(protocol, level.number + 1);
  if (next) return `Level ${next.number} vrijgeven`;
  return protocol.completion?.releaseLabel ?? 'Afronden';
}
