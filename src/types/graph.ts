export type NodeSource = 'user' | 'extracted'

export type PaperNodeId = string

export type PaperNode = {
  id: PaperNodeId
  title?: string
  arxivId?: string
  arxivUrl?: string
  /** https://doi.org/… identifier without URL prefix */
  doi?: string
  source: NodeSource
  read: boolean
  notes: string
  fromPdfFilename?: string
}

export type CitationLink = {
  source: PaperNodeId
  target: PaperNodeId
}

export type GraphState = {
  nodes: Record<PaperNodeId, PaperNode>
  links: CitationLink[]
  updatedAtMs: number
}

export function makeEmptyGraphState(): GraphState {
  return { nodes: {}, links: [], updatedAtMs: Date.now() }
}

/** Canonical arXiv id: base id only (v1, v2, … are ignored for identity). */
export function normalizeArxivId(raw: string): string {
  const s = raw.trim()
  const mNew = s.match(/^(\d{4}\.\d{4,5})(v\d+)?$/i)
  if (mNew) return mNew[1]
  return s
}

export function arxivAbsUrlFromId(arxivId: string): string {
  return `https://arxiv.org/abs/${encodeURIComponent(arxivId)}`
}

export function computeInDegree(links: CitationLink[]): Record<PaperNodeId, number> {
  const counts: Record<PaperNodeId, number> = {}
  for (const l of links) counts[l.target] = (counts[l.target] ?? 0) + 1
  return counts
}

/** Normalize for title equality (exact match after normalization; compare case-insensitively). */
export function normalizePaperTitleForMatch(title: string): string {
  return title.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Find an existing node id that matches a paper by strong identifiers.
 * Rule: only arXiv id is used for stable identity/merging.
 */
export function findNodeIdByIdentifiers(
  state: GraphState,
  node: Pick<PaperNode, 'id' | 'arxivId'>
): PaperNodeId | null {
  if (node.arxivId) {
    const id = normalizeArxivId(node.arxivId)
    if (state.nodes[id]) return id
    for (const n of Object.values(state.nodes)) {
      if (n.arxivId && normalizeArxivId(n.arxivId) === id) return n.id
    }
  }
  return null
}

// (Title matching intentionally not used for identity/merging.)

export function upsertNode(
  state: GraphState,
  node: PaperNode
): GraphState {
  const existing = state.nodes[node.id]
  const merged: PaperNode = existing
    ? (() => {
        const promotedSource: NodeSource =
          existing.source === 'user' || node.source === 'user' ? 'user' : 'extracted'

        return {
          // Prefer keeping any existing metadata the user may have edited.
          ...existing,
          // Bring in new scraped fields (title/arXiv/DOI/fromPdfFilename) if present.
          ...node,
          source: promotedSource,
          // Preserve user metadata on merge.
          read: existing.read,
          notes: existing.notes,
          // Prefer the more informative title if we have one.
          title:
            (existing.title && existing.title.length >= (node.title?.length ?? 0) ? existing.title : node.title) ??
            existing.title,
          // Prefer existing identifiers if already known, otherwise accept new ones.
          arxivId: existing.arxivId ?? node.arxivId,
          arxivUrl: existing.arxivUrl ?? node.arxivUrl,
          doi: existing.doi ?? node.doi,
          // Keep the latest filename if user-added.
          fromPdfFilename: node.source === 'user' ? node.fromPdfFilename ?? existing.fromPdfFilename : existing.fromPdfFilename,
        }
      })()
    : node

  return {
    ...state,
    nodes: { ...state.nodes, [node.id]: merged },
    updatedAtMs: Date.now(),
  }
}

export function addLinksDeduped(state: GraphState, links: CitationLink[]): GraphState {
  const key = (l: CitationLink) => `${l.source}→${l.target}`
  const existing = new Set(state.links.map(key))
  const next = [...state.links]
  for (const l of links) {
    const k = key(l)
    if (existing.has(k)) continue
    existing.add(k)
    next.push(l)
  }
  return { ...state, links: next, updatedAtMs: Date.now() }
}
