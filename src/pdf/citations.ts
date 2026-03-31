import type { PaperNode } from '../types/graph'
import { arxivAbsUrlFromId, normalizeArxivId } from '../types/graph'

export type ReferenceParseResult = {
  referencesText: string
  referenceEntries: string[]
  arxivIds: string[]
  arxivIdsByRef: Array<{ ref: string; arxivIds: string[] }>
}

/** Prefer newline/start before heading; PDF.js often concatenates "...text.References" with no newline */
const REFERENCE_HEADING_RE = /(^|\n)\s*(references|bibliography)\s*(:|\n)/gi

/** Last-resort: heading as a word (handles inline "References [1]") */
const REF_HEADING_INLINE_RE = /\b(references|bibliography|works\s+cited|literature\s+cited)\b/gi

const REF_ITEM_START_RE = /^\s*(\[\d+\]|\d+\.|\d+\))\s+/

const ARXIV_URL_RE = /arxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/gi
const ARXIV_TAG_RE = /\barxiv\s*:\s*(\d{4}\.\d{4,5}(?:v\d+)?)\b/gi
const ARXIV_PLAIN_ID_RE = /\b(\d{4}\.\d{4,5}(?:v\d+)?)\b/g

export function findReferencesSection(fullText: string): string {
  const m = [...fullText.matchAll(REFERENCE_HEADING_RE)].pop()
  if (m && m.index != null) return fullText.slice(m.index).trim()

  // Inline "…conclusion.References [1]" — no newline before the heading
  let lastIdx = -1
  for (const match of fullText.matchAll(REF_HEADING_INLINE_RE)) {
    if (match.index != null) lastIdx = match.index
  }
  if (lastIdx >= 0) return fullText.slice(lastIdx).trim()

  // No heading found: use tail of document where numbered refs often appear
  const tailStart = Math.max(0, fullText.length - 120_000)
  const tail = fullText.slice(tailStart)
  const lines = tail.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (REF_ITEM_START_RE.test(line)) {
      return lines.slice(i).join('\n').trim()
    }
  }
  return ''
}

export function splitReferenceEntries(referencesText: string): string[] {
  const lines = referencesText
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)

  const entries: string[] = []
  let current: string[] = []

  for (const line of lines) {
    const isStart = REF_ITEM_START_RE.test(line)
    if (isStart && current.length > 0) {
      entries.push(current.join(' ').replace(/\s+/g, ' ').trim())
      current = []
    }
    current.push(line.trim())
  }
  if (current.length > 0) entries.push(current.join(' ').replace(/\s+/g, ' ').trim())

  // Drop the heading line if it got included as the first entry.
  if (entries.length > 0 && /^(references|bibliography)\b/i.test(entries[0])) {
    entries.shift()
  }

  if (entries.length === 0) {
    const t = referencesText.trim()
    if (!t) return []
    const byBracket = t.split(/\n(?=\s*\[\d+\])/).map((s) => s.trim()).filter(Boolean)
    if (byBracket.length > 1) return byBracket
    const byNumber = t.split(/\n(?=\s*\d+\.\s)/).map((s) => s.trim()).filter(Boolean)
    if (byNumber.length > 1) return byNumber
    const paras = t.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean)
    if (paras.length > 1) return paras
    if (t.length > 0) return [t]
  }

  // One giant block (PDF sometimes merges refs): split on [2] [3] … mid-line
  if (entries.length === 1 && entries[0].length > 400) {
    const byInlineNum = entries[0].split(/\s+(?=\[\d+\])/).map((s) => s.trim()).filter(Boolean)
    if (byInlineNum.length > 1) return byInlineNum
  }

  return entries
}

export function extractArxivIdsFromReference(ref: string): string[] {
  const out = new Set<string>()
  const add = (id: string) => out.add(normalizeArxivId(id))

  for (const m of ref.matchAll(ARXIV_URL_RE)) add(m[1])
  for (const m of ref.matchAll(ARXIV_TAG_RE)) add(m[1])

  // Heuristic: only accept bare IDs if the ref mentions arXiv/preprint.
  if (/\barxiv\b/i.test(ref) || /\bpreprint\b/i.test(ref)) {
    for (const m of ref.matchAll(ARXIV_PLAIN_ID_RE)) add(m[1])
  }

  return [...out]
}

/**
 * Only accept citations that contain an explicit arXiv link/tag.
 * (User requested: "Only extract citations that have arxiv links.")
 */
export function extractArxivIdsFromReferenceLinkOnly(ref: string): string[] {
  const out = new Set<string>()
  const add = (id: string) => out.add(normalizeArxivId(id))

  for (const m of ref.matchAll(ARXIV_URL_RE)) add(m[1])
  // Some references include "arXiv:XXXX.XXXXX" without a URL; treat it as acceptable.
  for (const m of ref.matchAll(ARXIV_TAG_RE)) add(m[1])

  return [...out]
}

export function parseReferencesAndArxiv(fullText: string): ReferenceParseResult {
  const referencesText = findReferencesSection(fullText)
  const referenceEntries = referencesText ? splitReferenceEntries(referencesText) : []
  const arxivIdsByRef = referenceEntries.map((ref) => ({ ref, arxivIds: extractArxivIdsFromReference(ref) }))
  const arxivIds = [...new Set(arxivIdsByRef.flatMap((x) => x.arxivIds))]
  return { referencesText, referenceEntries, arxivIds, arxivIdsByRef }
}

export function tryExtractArxivIdFromPaperText(fullText: string): string | null {
  const head = fullText.slice(0, 40_000)
  const urlMatch = head.match(ARXIV_URL_RE)
  if (urlMatch && urlMatch[0]) {
    const m = urlMatch[0].match(/(\d{4}\.\d{4,5}(?:v\d+)?)/)
    if (m?.[1]) return normalizeArxivId(m[1])
  }
  const tagMatch = head.match(/\barxiv\s*:\s*(\d{4}\.\d{4,5}(?:v\d+)?)\b/i)
  if (tagMatch?.[1]) return normalizeArxivId(tagMatch[1])
  return null
}

export function makeArxivNodeFields(arxivId: string): { arxivId: string; arxivUrl: string } {
  const id = normalizeArxivId(arxivId)
  return { arxivId: id, arxivUrl: arxivAbsUrlFromId(id) }
}

/** Short human-readable title/snippet from a raw reference line */
export function titleSnippetFromReference(ref: string): string {
  const stripped = ref.replace(/^\s*(\[\d+\]|\d+\.|\d+\))\s+/, '').trim()
  const t = stripped.slice(0, 220)
  return t.length < stripped.length ? `${t}…` : t
}

/**
 * Return 0+ cited-paper nodes from one reference entry.
 * - If multiple arXiv ids exist in one ref, emit one node per id.
 * - Else fall back to DOI.
 * - Else fall back to deterministic hash of the reference text.
 */
export function buildExtractedPaperNodesFromReference(ref: string): PaperNode[] {
  const trimmed = ref.trim()
  if (!trimmed) return []

  const title = titleSnippetFromReference(trimmed)
  // Identifier rule: only arXiv ids are used for cited-paper nodes.
  const arxivIds = extractArxivIdsFromReferenceLinkOnly(trimmed)
  if (arxivIds.length > 0) {
    return arxivIds.map((raw) => {
      const id = normalizeArxivId(raw)
      return {
        id,
        source: 'extracted',
        read: false,
        notes: '',
        arxivId: id,
        arxivUrl: arxivAbsUrlFromId(id),
        title,
      }
    })
  }

  return []
}

