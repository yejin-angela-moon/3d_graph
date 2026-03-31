import type { PaperNodeId } from '../types/graph'

export type GraphViewNode = {
  id: PaperNodeId
  label: string
  source: 'user' | 'extracted'
  read: boolean
  notes: string
  arxivUrl?: string
  doi?: string
  val: number
  /** Set by force simulation at runtime */
  x?: number
  y?: number
  z?: number
}

export type GraphViewLink = {
  source: PaperNodeId
  target: PaperNodeId
}

