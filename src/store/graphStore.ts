import { del, get, set } from 'idb-keyval'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GraphState, PaperNode, PaperNodeId } from '../types/graph'
import { addLinksDeduped, makeEmptyGraphState, upsertNode } from '../types/graph'

const DB_KEY = 'citation-graph:v1'

async function loadGraphState(): Promise<GraphState | null> {
  const v = await get<GraphState>(DB_KEY)
  if (!v) return null
  if (!v.nodes || !v.links) return null
  return v
}

async function saveGraphState(state: GraphState): Promise<void> {
  await set(DB_KEY, state)
}

export type GraphActions = {
  upsert: (node: PaperNode) => void
  /** Replace graph state (used after folding parsed PDFs so title-merge is consistent). */
  replaceGraphState: (next: GraphState) => void
  setRead: (id: PaperNodeId, read: boolean) => void
  setNotes: (id: PaperNodeId, notes: string) => void
  addLinks: (links: { source: PaperNodeId; target: PaperNodeId }[]) => void
  reset: () => void
  exportJson: () => string
}

export function useGraphStore(): { state: GraphState; actions: GraphActions; loading: boolean } {
  const [state, setState] = useState<GraphState>(makeEmptyGraphState)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await loadGraphState()
        if (cancelled) return
        if (loaded) setState(loaded)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (loading) return
    void saveGraphState(state)
  }, [state, loading])

  const upsert = useCallback((node: PaperNode) => {
    setState((s) => upsertNode(s, node))
  }, [])

  const replaceGraphState = useCallback((next: GraphState) => {
    setState(next)
  }, [])

  const setRead = useCallback((id: PaperNodeId, read: boolean) => {
    setState((s) => {
      const n = s.nodes[id]
      if (!n) return s
      return {
        ...s,
        nodes: { ...s.nodes, [id]: { ...n, read } },
        updatedAtMs: Date.now(),
      }
    })
  }, [])

  const setNotes = useCallback((id: PaperNodeId, notes: string) => {
    setState((s) => {
      const n = s.nodes[id]
      if (!n) return s
      return {
        ...s,
        nodes: { ...s.nodes, [id]: { ...n, notes } },
        updatedAtMs: Date.now(),
      }
    })
  }, [])

  const addLinks = useCallback((links: { source: PaperNodeId; target: PaperNodeId }[]) => {
    setState((s) => addLinksDeduped(s, links))
  }, [])

  const reset = useCallback(() => {
    setState(makeEmptyGraphState())
    void del(DB_KEY)
  }, [])

  const exportJson = useCallback(() => JSON.stringify(state, null, 2), [state])

  const actions = useMemo<GraphActions>(
    () => ({
      upsert,
      replaceGraphState,
      setRead,
      setNotes,
      addLinks,
      reset,
      exportJson,
    }),
    [addLinks, exportJson, replaceGraphState, reset, setNotes, setRead, upsert]
  )

  return { state, actions, loading }
}
