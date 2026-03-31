import "./App.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGraphStore } from "./store/graphStore";
import { computeInDegree } from "./types/graph";
import { Graph3D } from "./graph/Graph3D";
import type { GraphViewNode } from "./graph/graphViewTypes";
import { parsePdfToCitations } from "./pdf/parsePdfToCitations";
import type { ParsePdfToCitationsResult } from "./pdf/parsePdfToCitations";
import { foldIngestParsedPdfs } from "./store/ingestPdf";
function App() {
  const { state, actions, loading } = useGraphStore();
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  /** Keeps the same card visible while pointer moves from a node onto the overlay */
  const [stickyOverlayId, setStickyOverlayId] = useState<string | null>(null);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseStatus, setParseStatus] = useState<string>("");
  const [graphDragOver, setGraphDragOver] = useState(false);

  const hoverLeaveTimerRef = useRef<number>(0);
  const lastOverlayIdRef = useRef<string | null>(null);

  /** Hover preview first; then pinned click; sticky while pointer is on the overlay */
  const overlayNodeId = hoveredId ?? pinnedId ?? stickyOverlayId;
  const overlayPaper = overlayNodeId
    ? state.nodes[overlayNodeId] ?? null
    : null;

  useEffect(() => {
    if (overlayNodeId) lastOverlayIdRef.current = overlayNodeId;
  }, [overlayNodeId]);

  useEffect(() => () => window.clearTimeout(hoverLeaveTimerRef.current), []);

  const nodeCount = Object.keys(state.nodes).length;
  const linkCount = state.links.length;

  const exportJson = useMemo(
    () => actions.exportJson(),
    [actions, state.updatedAtMs],
  );
  const exportBlobUrl = useMemo(
    () =>
      URL.createObjectURL(new Blob([exportJson], { type: "application/json" })),
    [exportJson],
  );

  useEffect(() => {
    return () => URL.revokeObjectURL(exportBlobUrl);
  }, [exportBlobUrl]);

  const graphData = useMemo(() => {
    const nodesArr = Object.values(state.nodes);
    const indeg = computeInDegree(state.links);
    const nodes: GraphViewNode[] = nodesArr.map((n) => ({
      id: n.id,
      label: (n.title ?? n.arxivId ?? n.id).slice(0, 80),
      source: n.source,
      read: n.read,
      notes: n.notes,
      arxivUrl: n.arxivUrl,
      doi: n.doi,
      val: indeg[n.id] ?? 0,
    }));
    const links = state.links.map((l) => ({
      source: l.source,
      target: l.target,
    }));
    return { nodes, links };
  }, [state.links, state.nodes]);

  const onDropPdfs = useCallback(
    async (files: File[]) => {
      setParseBusy(true);
      try {
        const results: ParsePdfToCitationsResult[] = [];
        for (const file of files) {
          setParseStatus(`Parsing ${file.name}…`);
          results.push(await parsePdfToCitations(file));
          const last = results[results.length - 1];
          setParseStatus(
            `${file.name}: ${last.debug.referenceEntries} ref lines → ${last.debug.citedNodesAdded} arXiv citations (${last.debug.pagesExtracted} pages)`,
          );
        }
        if (results.length === 0) return;
        const { next, lastMergedUserId } = foldIngestParsedPdfs(state, results);
        actions.replaceGraphState(next);
        if (lastMergedUserId) setPinnedId(lastMergedUserId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setParseStatus(`Parse failed: ${msg}`);
        // eslint-disable-next-line no-console
        console.error(e);
      } finally {
        setParseBusy(false);
      }
    },
    [actions, state],
  );

  const acceptPdf = useMemo(() => ["application/pdf"], []);

  const onGraphDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (parseBusy) return;
      e.dataTransfer.dropEffect = "copy";
      setGraphDragOver(true);
    },
    [parseBusy],
  );

  const onGraphDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setGraphDragOver(false);
  }, []);

  const onGraphDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setGraphDragOver(false);
      if (parseBusy) return;
      const files = [...(e.dataTransfer?.files ?? [])].filter(
        (f) =>
          acceptPdf.includes(f.type) || f.name.toLowerCase().endsWith(".pdf"),
      );
      if (files.length === 0) return;
      await onDropPdfs(files);
    },
    [acceptPdf, onDropPdfs, parseBusy],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="title">3D Academic Citation Graph</div>
          <div className="subtitle">
            {loading
              ? "Loading…"
              : parseBusy
                ? parseStatus || "Parsing…"
                : parseStatus || `${nodeCount} nodes · ${linkCount} citations`}
          </div>
        </div>
        <div className="actions">
          <label className="button">
            Choose PDFs
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              style={{ display: "none" }}
              onChange={async (e) => {
                if (parseBusy) return;
                const files = [...(e.target.files ?? [])];
                if (files.length === 0) return;
                await onDropPdfs(files);
                e.target.value = "";
              }}
            />
          </label>
          <a
            className="button"
            href={exportBlobUrl}
            download="citation-graph.json"
          >
            Export JSON
          </a>
          <button
            className="button danger"
            onClick={() => actions.reset()}
            type="button"
          >
            Reset
          </button>
        </div>
      </header>

      <main className="main">
        <section
          className={`graphCanvas${graphDragOver ? " graphCanvasDrag" : ""}${parseBusy ? " graphCanvasBusy" : ""}`}
          aria-label="Graph canvas — drop PDFs here"
          onDragOver={onGraphDragOver}
          onDragLeave={onGraphDragLeave}
          onDrop={onGraphDrop}
        >
          <Graph3D
            nodes={graphData.nodes}
            links={graphData.links}
            onNodeHover={(n) => {
              if (n) {
                window.clearTimeout(hoverLeaveTimerRef.current);
                setStickyOverlayId(null);
                setHoveredId(n.id);
              } else {
                hoverLeaveTimerRef.current = window.setTimeout(
                  () => setHoveredId(null),
                  200,
                );
              }
            }}
            onNodeClick={(n) => setPinnedId(n.id)}
            onBackgroundClick={() => {
              window.clearTimeout(hoverLeaveTimerRef.current);
              setPinnedId(null);
              setHoveredId(null);
              setStickyOverlayId(null);
            }}
            onOverlayPointerEnter={() => {
              window.clearTimeout(hoverLeaveTimerRef.current);
              const id = lastOverlayIdRef.current;
              if (id) setStickyOverlayId(id);
            }}
            onOverlayPointerLeave={() => {
              setStickyOverlayId(null);
              setHoveredId(null);
            }}
            overlayNodeId={overlayNodeId}
            overlayPaper={overlayPaper}
            onOverlayRead={(id, read) => actions.setRead(id, read)}
            onOverlayNotes={(id, notes) => actions.setNotes(id, notes)}
            onOverlayTitle={(id, title) => {
              const n = state.nodes[id];
              if (n) actions.upsert({ ...n, title });
            }}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
