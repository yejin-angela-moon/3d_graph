import "./App.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGraphStore } from "./store/graphStore";
import { computeInDegree } from "./types/graph";
import { Graph3D } from "./graph/Graph3D";
import type { GraphViewNode } from "./graph/graphViewTypes";
import { parsePdfToCitations } from "./pdf/parsePdfToCitations";
import type { ParsePdfToCitationsResult } from "./pdf/parsePdfToCitations";
import { foldIngestParsedPdfs } from "./store/ingestPdf";
import {
  readThemeFromDom,
  setTheme as persistTheme,
  type Theme,
} from "./theme";
import Cursor from "./graph/Cursor";

function App() {
  const [theme, setTheme] = useState<Theme>(() => readThemeFromDom());
  const { state, actions, loading } = useGraphStore();
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  /** Keeps the same card visible while pointer moves from a node onto the overlay */
  const [stickyOverlayId, setStickyOverlayId] = useState<string | null>(null);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseStatus, setParseStatus] = useState<string>("");
  const [graphDragOver, setGraphDragOver] = useState(false);
  const [hoveredNodeTitle, setHoveredNodeTitle] = useState<string | null>(null);

  const hoverLeaveTimerRef = useRef<number>(0);
  const lastOverlayIdRef = useRef<string | null>(null);
  const graphSectionRef = useRef<HTMLElement | null>(null);
  const [pointerInGraph, setPointerInGraph] = useState(false);
  /** Right paper panel: toggled from top bar; opens automatically when a node is selected. */
  const [detailPanelOpen, setDetailPanelOpen] = useState(true);

  const selectedNodeId = pinnedId ?? stickyOverlayId;
  const nodeSelected = selectedNodeId != null;
  const overlayPaper =
    selectedNodeId != null ? state.nodes[selectedNodeId] ?? null : null;

  useEffect(() => {
    if (selectedNodeId) lastOverlayIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    if (selectedNodeId) setDetailPanelOpen(true);
  }, [selectedNodeId]);

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
          <button
            type="button"
            className="button topbarPanelToggle"
            disabled={!nodeSelected}
            aria-pressed={nodeSelected && detailPanelOpen}
            aria-label={
              !nodeSelected
                ? "Select a paper on the graph to use the panel"
                : detailPanelOpen
                ? "Hide paper panel"
                : "Show paper panel"
            }
            title={
              !nodeSelected
                ? "Select a paper first"
                : detailPanelOpen
                ? "Hide paper panel"
                : "Show paper panel"
            }
            onClick={() => setDetailPanelOpen((open) => !open)}
          >
            <svg
              className="topbarPanelToggleIcon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <rect
                x="3"
                y="4"
                width="18"
                height="16"
                rx="2.5"
                stroke="currentColor"
                strokeWidth="1.75"
              />
              <rect
                x="14"
                y="6"
                width="5.5"
                height="12"
                rx="1"
                fill="currentColor"
                opacity="0.88"
              />
            </svg>
          </button>
          <button
            type="button"
            className="button themeToggle"
            onClick={() => {
              const next: Theme = theme === "light" ? "dark" : "light";
              persistTheme(next);
              setTheme(next);
            }}
            aria-pressed={theme === "dark"}
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            title={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
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
          ref={graphSectionRef}
          className={`graphCanvas${graphDragOver ? " graphCanvasDrag" : ""}${
            parseBusy ? " graphCanvasBusy" : ""
          }`}
          aria-label="Graph canvas — drop PDFs here"
          onPointerEnter={() => setPointerInGraph(true)}
          onPointerLeave={() => {
            setPointerInGraph(false);
            setHoveredNodeTitle(null);
          }}
          onDragOver={onGraphDragOver}
          onDragLeave={onGraphDragLeave}
          onDrop={onGraphDrop}
        >
          <Cursor
            hoverTitle={hoveredNodeTitle}
            graphActive={pointerInGraph}
            containerRef={graphSectionRef}
          />
          <Graph3D
            theme={theme}
            nodes={graphData.nodes}
            links={graphData.links}
            onNodeHover={(n) => {
              if (n) {
                window.clearTimeout(hoverLeaveTimerRef.current);
                setStickyOverlayId(null);
                setHoveredNodeTitle((n.label ?? "").trim() || "Untitled");
              } else {
                setHoveredNodeTitle(null);
              }
            }}
            onNodeClick={(n) => setPinnedId(n.id)}
            onBackgroundClick={() => {
              window.clearTimeout(hoverLeaveTimerRef.current);
              setPinnedId(null);
              setStickyOverlayId(null);
            }}
            detailPanelOpen={detailPanelOpen}
            onCloseDetailPanel={() => {
              window.clearTimeout(hoverLeaveTimerRef.current);
              setPinnedId(null);
              setStickyOverlayId(null);
            }}
            onOverlayPointerEnter={() => {
              window.clearTimeout(hoverLeaveTimerRef.current);
              const id = lastOverlayIdRef.current;
              if (id) setStickyOverlayId(id);
            }}
            onOverlayPointerLeave={() => {
              setStickyOverlayId(null);
            }}
            selectedNodeId={selectedNodeId}
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
