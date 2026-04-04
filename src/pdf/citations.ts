import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export type PaperNodeId = string;

type ExtractReferencesOptions = {
  maxHeadingScanLines?: number;
  minReferenceSignalsAfterHeading?: number;
};

const DEFAULT_OPTIONS: Required<ExtractReferencesOptions> = {
  maxHeadingScanLines: 400,
  minReferenceSignalsAfterHeading: 2,
};

const REFERENCE_HEADING_PATTERNS: RegExp[] = [
  /^\s*references\s*$/i,
  /^\s*bibliography\s*$/i,
  /^\s*works cited\s*$/i,
  /^\s*\d+\.?\s*references\s*$/i,
  /^\s*\d+\.?\s*bibliography\s*$/i,
];

const NEXT_SECTION_HEADING_PATTERNS: RegExp[] = [
  /^\s*appendix\s*$/i,
  /^\s*appendices\s*$/i,
  /^\s*acknowledg(?:e)?ments?\s*$/i,
  /^\s*author contributions?\s*$/i,
  /^\s*funding\s*$/i,
  /^\s*conflicts? of interest\s*$/i,
  /^\s*supplementary materials?\s*$/i,
  /^\s*supplemental materials?\s*$/i,
  /^\s*additional results\s*$/i,
  /^\s*implementation details\s*$/i,
  /^\s*\d+\.?\s*appendix\s*$/i,
];

export async function extractReferencesTextFromPdfFile(
  file: File,
  options: ExtractReferencesOptions = {},
): Promise<string | null> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");

    pages.push(pageText);
  }

  const fullText = normalizePdfText(pages.join("\n\n"));
  return extractReferencesTextFromDocumentText(fullText, options);
}

export function extractReferencesTextFromDocumentText(
  fullText: string,
  options: ExtractReferencesOptions = {},
): string | null {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const normalized = normalizePdfText(fullText);
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""));

  const headingIndex = findReferencesHeadingTopDown(lines, mergedOptions);
  if (headingIndex === -1) return null;

  const endIndex = findReferencesEnd(lines, headingIndex);
  const referencesLines = lines.slice(headingIndex + 1, endIndex);
  const cleaned = cleanupReferencesText(referencesLines.join("\n"));

  return cleaned.length > 0 ? cleaned : null;
}

function findReferencesHeadingTopDown(
  lines: string[],
  options: Required<ExtractReferencesOptions>,
): number {
  const limit = Math.min(lines.length, options.maxHeadingScanLines);

  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (!looksLikeReferenceHeading(line)) continue;
    if (
      !hasReferenceLikeContentAfter(
        lines,
        i,
        options.minReferenceSignalsAfterHeading,
      )
    ) {
      continue;
    }
    return i;
  }

  return -1;
}

function looksLikeReferenceHeading(line: string): boolean {
  if (!line) return false;

  if (!matchesAny(line, REFERENCE_HEADING_PATTERNS)) {
    return false;
  }

  if (line.length > 40) {
    return false;
  }

  return true;
}

function hasReferenceLikeContentAfter(
  lines: string[],
  headingIndex: number,
  minSignals: number,
): boolean {
  const sampleLines = lines
    .slice(headingIndex + 1, headingIndex + 18)
    .filter((line) => line.length > 0);

  if (sampleLines.length === 0) return false;

  let signals = 0;

  for (const line of sampleLines) {
    if (looksLikeReferenceEntryFragment(line)) {
      signals++;
    }
  }

  return signals >= minSignals;
}

function looksLikeReferenceEntryFragment(line: string): boolean {
  let score = 0;

  if (/\b(19|20)\d{2}\b/.test(line)) score++;
  if (/\bdoi\b/i.test(line)) score++;
  if (/\barxiv\b/i.test(line)) score++;
  if (/https?:\/\//i.test(line)) score++;
  if (/\bet al\./i.test(line)) score++;
  if (/\bpp?\.\s*\d+/i.test(line)) score++;
  if (/\bvol\.\s*\d+/i.test(line)) score++;
  if (/\bno\.\s*\d+/i.test(line)) score++;
  if (/\bjournal\b/i.test(line)) score++;
  if (/\bproceedings\b/i.test(line)) score++;
  if (/\bconference\b/i.test(line)) score++;
  if (/^[A-Z][A-Za-z'`-]+,\s+[A-Z]\./.test(line)) score++;
  if (/^[A-Z][A-Za-z'`-]+,\s+[A-Z][a-z]+/.test(line)) score++;

  return score >= 1;
}

function findReferencesEnd(lines: string[], headingIndex: number): number {
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    if (!line) continue;

    if (matchesAny(line, NEXT_SECTION_HEADING_PATTERNS)) {
      return i;
    }
  }

  return lines.length;
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function normalizePdfText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanupReferencesText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n")
    .trim();
}
