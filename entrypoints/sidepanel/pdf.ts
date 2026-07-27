import { extractText, getDocumentProxy } from 'unpdf';

type PdfPageInfo = {
  title: string;
  url: string;
  releaseDate: string;
  applicationDeadline: string;
  text: string;
  applicationMaterials: string[];
  contact: string[];
  applicationMethod: {
    descriptions: string[];
    emails: string[];
    links: Array<{ label: string; url: string }>;
  };
};

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function titleFromUrl(url: string, fallback: string) {
  try {
    const filename = decodeURIComponent(
      new URL(url).pathname.split('/').filter(Boolean).at(-1) || '',
    );
    return filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ') || fallback;
  } catch {
    return fallback;
  }
}

export function resolvePdfUrl(url: string) {
  if (/\.pdf(?:$|[?#])/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    const embeddedFile = parsed.searchParams.get('file');
    return embeddedFile && /^https?:/i.test(embeddedFile)
      ? embeddedFile
      : null;
  } catch {
    return null;
  }
}

export async function readPdfPage(
  url: string,
  noTitle: string,
  noBody: string,
): Promise<PdfPageInfo> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`PDF download failed (${response.status}).`);
  }
  const data = new Uint8Array(await response.arrayBuffer());
  const pdf = await getDocumentProxy(data);
  const extracted = await extractText(pdf, { mergePages: true });
  const text = String(extracted.text || '').trim();
  if (!text) {
    throw new Error(
      'This PDF has no readable text layer. OCR is required for scanned PDFs.',
    );
  }

  const emails = unique(
    text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) || [],
  );
  const datePattern =
    /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i;
  const deadlineLine = text
    .split(/\n+/)
    .find(
      (line) =>
        /deadline|apply by|application by|bewerbungsfrist|bis zum/i.test(line) &&
        datePattern.test(line),
    );
  const applicationLines = unique(
    text
      .split(/\n+/)
      .filter((line) =>
        /apply|application|submit|send|subject line|bewerb/i.test(line),
      ),
  ).slice(0, 8);
  const materialLines = unique(
    text
      .split(/\n+/)
      .filter((line) =>
        /cover letter|motivation letter|curriculum vitae|\bCV\b|résumé|resume|transcript|\breferences?\b|application documents?|anschreiben|motivationsschreiben|lebenslauf|zeugnis/i.test(
          line,
        ),
      ),
  ).slice(0, 8);

  return {
    title: titleFromUrl(url, noTitle),
    url,
    releaseDate: '',
    applicationDeadline: deadlineLine?.match(datePattern)?.[0] || '',
    text: text || noBody,
    applicationMaterials: materialLines,
    contact: emails,
    applicationMethod: {
      descriptions: applicationLines,
      emails,
      links: [],
    },
  };
}
