import type { ParsePdfToCitationsResult } from '../pdf/parsePdfToCitations'
import type { GraphState, PaperNodeId } from '../types/graph'
import { addLinksDeduped, findNodeIdByIdentifiers, upsertNode } from '../types/graph'

/**
 * Add parsed PDF into the graph: merge user node by title if it matches an existing node,
 * upsert cited nodes, add citation edges from the (possibly merged) user id.
 */
export function applyOneParsedPdf(
  state: GraphState,
  res: ParsePdfToCitationsResult
): { next: GraphState; mergedUserId: PaperNodeId } {
  const existingId = findNodeIdByIdentifiers(state, res.userNode)
  const userNode = existingId ? { ...res.userNode, id: existingId } : res.userNode

  let next = upsertNode(state, userNode)
  for (const cited of res.citedNodes) {
    next = upsertNode(next, cited)
  }
  const links = res.citedNodes.map((c) => ({ source: userNode.id, target: c.id }))
  next = addLinksDeduped(next, links)
  return { next, mergedUserId: userNode.id }
}

export function foldIngestParsedPdfs(
  state: GraphState,
  results: ParsePdfToCitationsResult[]
): { next: GraphState; lastMergedUserId: PaperNodeId } {
  let cur = state
  let lastMerged = '' as PaperNodeId
  for (const r of results) {
    const out = applyOneParsedPdf(cur, r)
    cur = out.next
    lastMerged = out.mergedUserId
  }
  return { next: cur, lastMergedUserId: lastMerged }
}
