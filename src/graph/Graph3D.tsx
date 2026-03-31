import ForceGraph3D from "react-force-graph-3d";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PaperNode } from "../types/graph";
import { GraphNodeOverlay } from "./GraphNodeOverlay";
import type { GraphViewLink, GraphViewNode } from "./graphViewTypes";

export type Graph3DProps = {
  nodes: GraphViewNode[];
  links: GraphViewLink[];
  onNodeHover: (node: GraphViewNode | null) => void;
  onNodeClick: (node: GraphViewNode) => void;
  onBackgroundClick?: () => void;
  overlayNodeId: string | null;
  overlayPaper: PaperNode | null;
  onOverlayRead: (id: string, read: boolean) => void;
  onOverlayNotes: (id: string, notes: string) => void;
  onOverlayTitle: (id: string, title: string) => void;
  /** Keep hover preview while moving pointer from node onto the overlay */
  onOverlayPointerEnter?: () => void;
  onOverlayPointerLeave?: () => void;
  /** When true and a paper is selected, the right detail panel is slid open. */
  detailPanelOpen: boolean;
  /** Dismiss selection and close the detail panel. */
  onCloseDetailPanel?: () => void;
  /** UI theme — graph canvas and link contrast */
  theme?: "light" | "dark";
};

/** Invisible sphere for easier raycast hit (bigger hitbox than visible mesh). */
const HITBOX_SCALE = 2.6;

/** Camera distance range for the zoom slider (left = farther, right = closer). */
const ZOOM_SLIDER_MIN_DIST = 28;
const ZOOM_SLIDER_MAX_DIST = 900;

function distanceToSliderPct(d: number): number {
  const clamped = THREE.MathUtils.clamp(
    d,
    ZOOM_SLIDER_MIN_DIST,
    ZOOM_SLIDER_MAX_DIST,
  );
  const t =
    (clamped - ZOOM_SLIDER_MIN_DIST) /
    (ZOOM_SLIDER_MAX_DIST - ZOOM_SLIDER_MIN_DIST);
  return Math.round((1 - t) * 100);
}

function sliderPctToDistance(pct: number): number {
  const t = THREE.MathUtils.clamp(pct / 100, 0, 1);
  return (
    ZOOM_SLIDER_MAX_DIST - t * (ZOOM_SLIDER_MAX_DIST - ZOOM_SLIDER_MIN_DIST)
  );
}

function applySliderDistanceToCamera(
  fg: { camera: () => THREE.Camera; controls: () => unknown },
  pct: number,
) {
  const camera = fg.camera() as THREE.PerspectiveCamera;
  const controls = fg.controls() as {
    target: THREE.Vector3;
    update: () => void;
  };
  if (!camera || !controls?.target) return;
  const target = controls.target;
  const distance = sliderPctToDistance(pct);
  const offset = new THREE.Vector3().subVectors(camera.position, target);
  if (offset.lengthSq() < 1e-10) {
    offset.set(0, 0, distance);
  } else {
    offset.normalize().multiplyScalar(distance);
  }
  camera.position.copy(target).add(offset);
  controls.update();
}

/** Larger default node radius; indegree still scales size */
function nodeRadius(node: GraphViewNode): number {
  return 2.6 + Math.sqrt(Math.max(0, node.val)) * 1.05;
}

/** Flat unlit spheres (no scene lighting). User = light green, cited references = light red. */
function makeNodeObject(node: GraphViewNode): THREE.Object3D {
  const group = new THREE.Group();
  const r = nodeRadius(node);

  const hitGeom = new THREE.SphereGeometry(r * HITBOX_SCALE, 16, 16);
  const hitMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const hit = new THREE.Mesh(hitGeom, hitMat);
  hit.renderOrder = -1;
  group.add(hit);

  const sphereGeom = new THREE.SphereGeometry(r, 40, 32);

  const userColor = 0xa7f3d0;
  const refColor = 0xfecaca;

  if (node.source === "user") {
    const mesh = new THREE.Mesh(
      sphereGeom,
      new THREE.MeshBasicMaterial({ color: userColor }),
    );
    mesh.renderOrder = 2;
    group.add(mesh);
  } else {
    const mesh = new THREE.Mesh(
      sphereGeom,
      new THREE.MeshBasicMaterial({ color: refColor }),
    );
    mesh.renderOrder = 2;
    group.add(mesh);
  }

  return group;
}

function layoutDisconnectedComponents(
  nodes: GraphViewNode[],
  links: GraphViewLink[],
): Record<string, { x: number; y: number; z: number }> {
  const ids = nodes.map((n) => n.id);
  const adj = new Map<string, Set<string>>();
  for (const id of ids) adj.set(id, new Set());

  for (const l of links) {
    const s = String(l.source);
    const t = String(l.target);
    adj.get(s)?.add(t);
    adj.get(t)?.add(s);
  }

  const seen = new Set<string>();
  const components: string[][] = [];

  for (const id of ids) {
    if (seen.has(id)) continue;
    const q = [id];
    seen.add(id);
    const comp: string[] = [];
    while (q.length) {
      const cur = q.pop()!;
      comp.push(cur);
      for (const nei of adj.get(cur) ?? []) {
        if (seen.has(nei)) continue;
        seen.add(nei);
        q.push(nei);
      }
    }
    components.push(comp);
  }

  const compCount = components.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(compCount)));
  const spacing = 140;

  const pos: Record<string, { x: number; y: number; z: number }> = {};
  components.forEach((comp, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const ax = (col - (cols - 1) / 2) * spacing;
    const ay = (row - (Math.ceil(compCount / cols) - 1) / 2) * spacing;
    for (let i = 0; i < comp.length; i++) {
      const jitter = (i % 7) * 2.2;
      pos[comp[i]] = { x: ax + jitter, y: ay - jitter, z: 0 };
    }
  });

  return pos;
}

export function Graph3D(props: Graph3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 600, height: 500 });
  const fgRef = useRef<any>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const zoomBaseDistanceRef = useRef<number | null>(null);
  const [zoomSliderPct, setZoomSliderPct] = useState(50);
  const sliderDraggingRef = useRef(false);
  const lastSyncedSliderPctRef = useRef<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.max(200, el.clientWidth);
      const h = Math.max(200, el.clientHeight);
      setDims({ width: w, height: h });
    });
    ro.observe(el);
    setDims({
      width: Math.max(200, el.clientWidth),
      height: Math.max(200, el.clientHeight),
    });
    return () => ro.disconnect();
  }, []);

  // Keep wheel/trackpad zoom working over the graph (avoid page scroll stealing the event).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const graphData = useMemo(() => {
    const anchors = layoutDisconnectedComponents(props.nodes, props.links);
    const nodesWithPos = props.nodes.map((n) => ({
      ...n,
      x: (n as GraphViewNode & { x?: number }).x ?? anchors[n.id]?.x ?? 0,
      y: (n as GraphViewNode & { y?: number }).y ?? anchors[n.id]?.y ?? 0,
      z: (n as GraphViewNode & { z?: number }).z ?? anchors[n.id]?.z ?? 0,
    }));
    return { nodes: nodesWithPos, links: props.links };
  }, [props.links, props.nodes]);

  /** No custom lights — flat MeshBasicMaterial nodes ignore lighting anyway. */
  useEffect(() => {
    let cancelled = false;
    const clearLights = () => {
      if (cancelled) return;
      const fg = fgRef.current;
      if (!fg?.lights) {
        requestAnimationFrame(clearLights);
        return;
      }
      fg.lights([]);
    };
    requestAnimationFrame(clearLights);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    zoomBaseDistanceRef.current = null;
    lastSyncedSliderPctRef.current = null;
  }, [graphData.nodes.length]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const fg = fgRef.current;
      if (fg) {
        const controls = fg.controls?.() as
          | { getDistance?: () => number }
          | undefined;
        const d = controls?.getDistance?.();
        if (d != null && d > 1e-6) {
          if (zoomBaseDistanceRef.current == null)
            zoomBaseDistanceRef.current = d;
          const base = zoomBaseDistanceRef.current;
          const pct = Math.round((base / d) * 100);
          setZoomPct(Math.min(9999, Math.max(1, pct)));

          if (!sliderDraggingRef.current) {
            const sp = distanceToSliderPct(d);
            if (
              lastSyncedSliderPctRef.current === null ||
              Math.abs(sp - lastSyncedSliderPctRef.current) >= 1
            ) {
              lastSyncedSliderPctRef.current = sp;
              setZoomSliderPct(sp);
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force?.("charge");
    if (charge) {
      charge.strength(-45);
      if (typeof charge.distanceMax === "function") charge.distanceMax(85);
    }
    const link = fg.d3Force?.("link");
    if (link && typeof link.distance === "function") link.distance(56);
  }, [graphData.nodes.length, graphData.links.length]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const fg = fgRef.current;
      if (!fg) return;
      const c = fg.controls?.() as
        | { minDistance?: number; maxDistance?: number }
        | undefined;
      if (c) {
        c.minDistance = ZOOM_SLIDER_MIN_DIST;
        c.maxDistance = ZOOM_SLIDER_MAX_DIST;
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [dims.width, dims.height, graphData.nodes.length]);

  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const fg = fgRef.current;
      const c = fg?.controls?.();
      if (!c) {
        requestAnimationFrame(apply);
        return;
      }
      const controls = c as any;
      controls.enableZoom = true;
      controls.enableRotate = true;
      controls.enablePan = true;
      controls.zoomSpeed = 1.0;
      controls.rotateSpeed = 0.7;
      controls.panSpeed = 0.7;
    };
    requestAnimationFrame(apply);
    return () => {
      cancelled = true;
    };
  }, [dims.width, dims.height]);

  useEffect(() => {
    fgRef.current?.refresh?.();
  }, [props.theme]);

  const isDark = (props.theme ?? "dark") === "dark";
  const linkStroke = isDark ? "#ffffff" : "#6b7280";

  return (
    <div
      ref={wrapRef}
      className="graphCanvasInner"
      style={{
        width: "100%",
        height: "100%",
        minHeight: 320,
      }}
    >
      <ForceGraph3D
        ref={fgRef}
        width={dims.width}
        height={dims.height}
        graphData={graphData}
        backgroundColor={
          (props.theme ?? "dark") === "dark" ? "#121318" : "#ffffff"
        }
        controlType="orbit"
        enableNavigationControls
        enableNodeDrag={false}
        nodeLabel={() => ""}
        nodeThreeObject={(n: unknown) => makeNodeObject(n as GraphViewNode)}
        nodeThreeObjectExtend={false}
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        linkWidth={0.6}
        linkOpacity={isDark ? 0.55 : 0.45}
        linkColor={() => linkStroke}
        linkDirectionalArrowColor={() => linkStroke}
        onNodeHover={(n: unknown) => {
          props.onNodeHover((n as GraphViewNode) ?? null);
        }}
        onNodeClick={(n: unknown) => props.onNodeClick(n as GraphViewNode)}
        onBackgroundClick={() => props.onBackgroundClick?.()}
        enablePointerInteraction
        showNavInfo={false}
      />
      <div className="graphZoomControl">
        <label className="graphZoomSliderLabel">
          <div className="graphZoomRow">
            <input
              type="range"
              className="graphZoomSlider"
              min={0}
              max={100}
              step={1}
              value={zoomSliderPct}
              aria-label="Zoom camera distance"
              onPointerDown={() => {
                sliderDraggingRef.current = true;
              }}
              onPointerUp={() => {
                sliderDraggingRef.current = false;
              }}
              onPointerCancel={() => {
                sliderDraggingRef.current = false;
              }}
              onInput={(e) => {
                const v = Number(e.currentTarget.value);
                setZoomSliderPct(v);
                lastSyncedSliderPctRef.current = v;
                const fg = fgRef.current;
                if (fg) applySliderDistanceToCamera(fg, v);
              }}
            />
            <div className="graphZoomHud" role="status" aria-live="polite">
              {zoomPct}%
            </div>
          </div>
        </label>
      </div>
      <aside
        className={
          props.overlayNodeId && props.detailPanelOpen
            ? "graphDetailPanel graphDetailPanel--open"
            : "graphDetailPanel"
        }
        aria-hidden={!props.overlayNodeId}
        onPointerEnter={() => props.onOverlayPointerEnter?.()}
        onPointerLeave={() => props.onOverlayPointerLeave?.()}
      >
        {props.overlayPaper && props.overlayNodeId ? (
          <GraphNodeOverlay
            paper={props.overlayPaper}
            onRead={(read) => props.onOverlayRead(props.overlayPaper!.id, read)}
            onNotes={(notes) =>
              props.onOverlayNotes(props.overlayPaper!.id, notes)
            }
            onTitle={(title) =>
              props.onOverlayTitle(props.overlayPaper!.id, title)
            }
          />
        ) : null}
      </aside>
    </div>
  );
}
