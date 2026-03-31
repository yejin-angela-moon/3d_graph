import type { PaperNode } from '../types/graph'
import { arxivAbsUrlFromId, normalizeArxivId } from '../types/graph'
import { buildExtractedPaperNodesFromReference, parseReferencesAndArxiv, tryExtractArxivIdFromPaperText } from './citations'
import { basenameWithoutPdf, extractPaperTitleFromPdfText } from './paperTitle'
import { extractPdfText } from './pdfText'

export type ParsePdfToCitationsResult = {
  userNode: PaperNode
  /** One node per parsed reference line (deduped by stable id) */
  citedNodes: PaperNode[]
  debug: {
    pagesExtracted: number
    referencesFound: boolean
    referenceEntries: number
    citedNodesAdded: number
    referencesSnippet: string
  }
}

export async function parsePdfToCitations(file: File): Promise<ParsePdfToCitationsResult> {
  const { fullText, pageTexts } = await extractPdfText(file)
  const paperArxiv = tryExtractArxivIdFromPaperText(fullText)

  const { referencesText, referenceEntries } = parseReferencesAndArxiv(fullText)

  const extractedTitle = extractPaperTitleFromPdfText(pageTexts)
  const title = extractedTitle ?? basenameWithoutPdf(file.name)

  // Identifier rule: only arXiv id is used for stable identity/merging.
  // If arXiv id isn't found, treat this PDF as a distinct node.
  const userId = paperArxiv ? normalizeArxivId(paperArxiv) : `pdf:${file.name}:${Date.now()}`
  const userNode: PaperNode = {
    id: userId,
    source: 'user',
    read: false,
    notes: '',
    fromPdfFilename: file.name,
    title,
    ...(paperArxiv
      ? { arxivId: normalizeArxivId(paperArxiv), arxivUrl: arxivAbsUrlFromId(normalizeArxivId(paperArxiv)) }
      : null),
  }

  const citedNodes: PaperNode[] = []
  const seen = new Set<string>()
  for (const ref of referenceEntries) {
    for (const n of buildExtractedPaperNodesFromReference(ref)) {
      if (n.id === userNode.id) continue
      if (seen.has(n.id)) continue
      seen.add(n.id)
      citedNodes.push(n)
    }
  }

  return {
    userNode,
    citedNodes,
    debug: {
      pagesExtracted: pageTexts.length,
      referencesFound: Boolean(referencesText),
      referenceEntries: referenceEntries.length,
      citedNodesAdded: citedNodes.length,
      referencesSnippet: referencesText.slice(0, 1200),
    },
  }
}
