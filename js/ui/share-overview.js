// Overzicht als PDF delen: via het deelmenu van het toestel (Mail, Berichten, AirDrop), of als download.
// De app verstuurt zelf niets; de therapeut kiest in het deelmenu naar wie het bestand gaat.

import { buildOverview, overviewFileName } from '../domain/overview.js';
import { buildPdf } from '../domain/pdf.js';

export function overviewPdf(context) {
  const pdf = buildPdf(buildOverview(context), { footer: context.patient.code });
  return new File([pdf], overviewFileName(context.patient, context.today), { type: 'application/pdf' });
}

/** Geeft 'gedeeld', 'gedownload' of 'geannuleerd' terug. */
export async function shareOverview(context) {
  const file = overviewPdf(context);
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Overzicht ${context.patient.code}` });
      return 'gedeeld';
    } catch (error) {
      if (error?.name === 'AbortError') return 'geannuleerd';
      // andere fout: val terug op downloaden
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'gedownload';
}
