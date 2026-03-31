/**
 * Heuristic title from first page(s) before "Abstract" / section 1.
 * PDF text order varies; this is best-effort for arXiv-style PDFs.
 */
export function extractPaperTitleFromPdfText(pageTexts: string[]): string | undefined {
  const head = pageTexts.slice(0, 2).join('\n').slice(0, 12_000)
  const abstractIdx = head.search(/\babstract\b/i)
  const slice = abstractIdx > 0 ? head.slice(0, abstractIdx) : head.slice(0, 3500)
  const lines = slice
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const badStart = /^(arxiv|doi:|http|vol\.|pp\.|pages|proceedings|conference|journal)/i
  const candidates = lines
    .slice(0, 20)
    .filter((l) => l.length >= 28 && l.length <= 320)
    .filter((l) => !badStart.test(l))

  if (candidates.length === 0) return undefined
  return candidates.sort((a, b) => b.length - a.length)[0]
}

export function basenameWithoutPdf(name: string): string {
  return name.replace(/\.pdf$/i, '').trim()
}
