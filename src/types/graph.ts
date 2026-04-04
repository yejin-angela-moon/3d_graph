export type NodeSource = "user" | "extracted";
export type PaperNodeId = string;

export type PaperNode = {
  id: PaperNodeId;
  title?: string;
  arxivUrl?: string;
  doi?: string;
  source: NodeSource;
  read: boolean;
  notes: string;
};

export type Edge = {
  source: PaperNodeId;
  target: PaperNodeId;
};

export type GraphState = {
  nodes: Record<PaperNodeId, PaperNode>;
  edges: Edge[];
};

export function makeEmptyGraphState(): GraphState {
  return { nodes: {}, edges: [] };
}

export function computeInDegree(edges: Edge[]): Record<PaperNodeId, number> {
  const counts: Record<PaperNodeId, number> = {};
  for (const l of edges) counts[l.target] = (counts[l.target] ?? 0) + 1;
  return counts;
}

export function normalizePaperTitleForMatch(title: string): string {
  return title.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
export function upsertNode(state: GraphState, node: PaperNode): GraphState {
  const existing = state.nodes[node.id];
  const merged = existing ? mergePaperNode(existing, node) : node;

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [node.id]: merged,
    },
  };
}

function mergePaperNode(existing: PaperNode, incoming: PaperNode): PaperNode {
  return {
    id: existing.id,
    source: "user",
    read: existing.read,
    notes: existing.notes,
    title: incoming.title,
    arxivUrl: incoming.arxivUrl,
    doi: incoming.doi,
  };
}
