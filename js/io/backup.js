// Het back-upbestand bewaren (deel-venster of download) en een gekozen bestand inlezen.

import { todayIso } from '../domain/dates.js';

/**
 * Bewaart het bestand. Op de iPad verschijnt het deel-venster (Bewaar in Bestanden, iCloud, AirDrop, …).
 * Is dat er niet, dan wordt het bestand gedownload.
 * Geeft 'shared', 'downloaded' of 'cancelled' terug; enkel de eerste twee tellen als back-up.
 */
export async function saveBackupFile(backup, now = new Date()) {
  const name = `kine-back-up-${todayIso(now)}.json`;
  const file = new File([JSON.stringify(backup, null, 2)], name, { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Back-up kine-opvolging' });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      // Delen mislukt om een andere reden: val terug op downloaden.
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

export function readFileText(file) {
  if (file.text) return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
