import ForceGraph3D from "react-force-graph-3d";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  /** When non-null, the graph uses focus styling (selected node, neighbors, incident edges). */
  selectedNodeId: string | null;
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

type NodeHighlightRole = "center" | "neighbor" | "dim" | "none";

type NodePaint = {
  color: THREE.Color;
  opacity: number;
  scale: number;
  depthWrite: boolean;
};

const _spawnPaint: NodePaint = {
  color: new THREE.Color(),
  opacity: 1,
  scale: 1,
  depthWrite: true,
};
const _paintA: NodePaint = {
  color: new THREE.Color(),
  opacity: 1,
  scale: 1,
  depthWrite: true,
};
const _paintB: NodePaint = {
  color: new THREE.Color(),
  opacity: 1,
  scale: 1,
  depthWrite: true,
};
const _mixColor = new THREE.Color();

/** Target appearance for a node role (used for smooth blending in the rAF loop). */
function writeNodePaint(
  node: GraphViewNode,
  role: NodeHighlightRole,
  isDark: boolean,
  out: NodePaint,
): void {
  const userColor = 0xa7f3d0;
  const refColor = 0xfecaca;
  const centerColor = 0xfbbf24;

  let hex: number;
  let opacity = 1;
  let scale = 1;
  if (role === "none") {
    hex = node.source === "user" ? userColor : refColor;
  } else if (role === "center") {
    hex = centerColor;
    scale = 1.12;
  } else if (role === "neighbor") {
    hex = isDark ? 0xd1d5db : 0x1f2937;
  } else {
    hex = isDark ? 0x6b7280 : 0xe5e7eb;
    opacity = isDark ? 0.14 : 0.42;
  }
  out.color.setHex(hex);
  out.opacity = opacity;
  out.scale = scale;
  out.depthWrite = opacity >= 0.95;
}

/** Flat unlit spheres; colours are driven each frame by `applyGraphColorAnimations`. */
function makeNodeObject(node: GraphViewNode, isDark: boolean): THREE.Object3D {
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
  writeNodePaint(node, "none", isDark, _spawnPaint);
  const mesh = new THREE.Mesh(
    sphereGeom,
    new THREE.MeshBasicMaterial({
      color: _spawnPaint.color.clone(),
      transparent: _spawnPaint.opacity < 1,
      opacity: _spawnPaint.opacity,
      depthWrite: _spawnPaint.depthWrite,
    }),
  );
  mesh.renderOrder = 2;
  mesh.scale.setScalar(_spawnPaint.scale);
  mesh.userData.paperGraphVizSphere = true;
  mesh.userData.paperGraphNodeId = node.id;
  group.add(mesh);

  return group;
}

function neighborIdsForSelection(
  selectedId: string,
  links: GraphViewLink[],
): Set<string> {
  const next = new Set<string>();
  for (const l of links) {
    const s = linkEndpointId(l.source);
    const t = linkEndpointId(l.target);
    if (s === selectedId) next.add(t);
    if (t === selectedId) next.add(s);
  }
  return next;
}

function nodeHighlightRole(
  nodeId: string,
  selectedNodeId: string | null,
  neighborIds: Set<string> | null,
): NodeHighlightRole {
  if (selectedNodeId == null) return "none";
  if (nodeId === selectedNodeId) return "center";
  if (neighborIds?.has(nodeId)) return "neighbor";
  return "dim";
}

/**
 * After the force simulation runs, d3 mutates links so `source` / `target` are
 * node objects, not string ids — `String(object)` is wrong for comparisons.
 */
function linkEndpointId(endpoint: unknown): string {
  if (endpoint == null) return "";
  if (typeof endpoint === "string" || typeof endpoint === "number") {
    return String(endpoint);
  }
  if (typeof endpoint === "object" && "id" in (endpoint as object)) {
    return String((endpoint as { id: string }).id);
  }
  return String(endpoint);
}

function linkIncidentToSelected(
  link: { source: unknown; target: unknown },
  selectedNodeId: string,
): boolean {
  const s = linkEndpointId(link.source);
  const t = linkEndpointId(link.target);
  return s === selectedNodeId || t === selectedNodeId;
}

/** 3d-force-graph builds the scene with clickAfterDrag(false); re-apply after init/refresh. */
function enableClickAfterDrag(
  fg: { clickAfterDrag?: (v: boolean) => void } | null,
) {
  if (fg && typeof fg.clickAfterDrag === "function") fg.clickAfterDrag(true);
}

/** Higher = faster approach to the target selection tint (per frame, exponential). */
const COLOR_BLEND_RATE = 0.045;

type GraphAnimSnapshot = {
  selectedNodeId: string | null;
  neighborIds: Set<string> | null;
  isDark: boolean;
  nodeSelected: boolean;
  linkBaseColor: THREE.Color;
  linkBaseOpacity: number;
};

function linkTargetPaint(
  isDark: boolean,
  incident: boolean,
  outRgb: THREE.Color,
): number {
  if (incident) {
    if (isDark) {
      outRgb.setRGB(251 / 255, 191 / 255, 36 / 255);
      return 0.92;
    }
    outRgb.setRGB(180 / 255, 83 / 255, 9 / 255);
    return 0.9;
  }
  if (isDark) {
    outRgb.setRGB(75 / 255, 85 / 255, 99 / 255);
    return 0.12;
  }
  outRgb.setRGB(148 / 255, 163 / 255, 184 / 255);
  return 0.14;
}

function applyGraphColorAnimations(
  scene: THREE.Object3D,
  blend: number,
  snap: GraphAnimSnapshot,
  nodesById: Map<string, GraphViewNode>,
  effectiveSelectedId: string | null,
  effectiveNeighbors: Set<string> | null,
): void {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.paperGraphVizSphere) {
      const id = obj.userData.paperGraphNodeId as string | undefined;
      if (!id) return;
      const node = nodesById.get(id);
      if (!node) return;
      const mat = obj.material;
      if (!(mat instanceof THREE.MeshBasicMaterial)) return;

      writeNodePaint(node, "none", snap.isDark, _paintA);
      const focusRole = nodeHighlightRole(
        id,
        effectiveSelectedId,
        effectiveNeighbors,
      );
      writeNodePaint(node, focusRole, snap.isDark, _paintB);
      _mixColor.copy(_paintA.color).lerp(_paintB.color, blend);
      mat.color.copy(_mixColor);
      mat.opacity =
        _paintA.opacity + (_paintB.opacity - _paintA.opacity) * blend;
      const sc = _paintA.scale + (_paintB.scale - _paintA.scale) * blend;
      obj.scale.setScalar(sc);
      mat.depthWrite = mat.opacity >= 0.95;
      mat.transparent = mat.opacity < 0.999;
      return;
    }

    const linkGrp = obj as THREE.Object3D & {
      __graphObjType?: string;
      __data?: GraphViewLink;
    };
    if (linkGrp.__graphObjType === "link" && linkGrp.__data) {
      const link = linkGrp.__data;
      const lineOrMesh = linkGrp.children[0] as
        | THREE.Mesh
        | THREE.Line
        | undefined;
      const mat = lineOrMesh?.material as
        | THREE.MeshLambertMaterial
        | THREE.LineBasicMaterial
        | undefined;
      if (!mat || !("color" in mat)) return;
      let endOp: number;
      if (effectiveSelectedId == null) {
        _paintB.color.copy(snap.linkBaseColor);
        endOp = snap.linkBaseOpacity;
      } else {
        const incident = linkIncidentToSelected(link, effectiveSelectedId);
        endOp = linkTargetPaint(snap.isDark, incident, _paintB.color);
      }
      _mixColor.copy(snap.linkBaseColor).lerp(_paintB.color, blend);
      mat.color.copy(_mixColor);
      mat.opacity =
        snap.linkBaseOpacity + (endOp - snap.linkBaseOpacity) * blend;
      mat.transparent = mat.opacity < 0.999;
      mat.depthWrite = mat.opacity >= 1;
      return;
    }

    const arrow = obj as THREE.Mesh & {
      __linkThreeObjType?: string;
      __data?: GraphViewLink;
    };
    if (
      arrow.__linkThreeObjType === "arrow" &&
      arrow.__data &&
      arrow.material
    ) {
      const link = arrow.__data;
      const mat = arrow.material as THREE.MeshLambertMaterial;
      let endOp: number;
      if (effectiveSelectedId == null) {
        _paintB.color.copy(snap.linkBaseColor);
        endOp = snap.linkBaseOpacity;
      } else {
        const incident = linkIncidentToSelected(link, effectiveSelectedId);
        endOp = linkTargetPaint(snap.isDark, incident, _paintB.color);
      }
      _mixColor.copy(snap.linkBaseColor).lerp(_paintB.color, blend);
      mat.color.copy(_mixColor);
      const lineOp =
        snap.linkBaseOpacity + (endOp - snap.linkBaseOpacity) * blend;
      mat.opacity = lineOp * 3;
      mat.transparent = true;
    }
  });
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
  const graphAnimRef = useRef<GraphAnimSnapshot>({
    selectedNodeId: null,
    neighborIds: null,
    isDark: true,
    nodeSelected: false,
    linkBaseColor: new THREE.Color(),
    linkBaseOpacity: 0.55,
  });
  const colorBlendRef = useRef(0);
  const nodesByIdRef = useRef(new Map<string, GraphViewNode>());
  const linkStrokeOnlyRef = useRef("#ffffff");
  const prevSelRef = useRef<string | null>(null);
  const prevNeighborsRef = useRef<Set<string> | null>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const zoomBaseDistanceRef = useRef<number | null>(null);
  const [zoomSliderPct, setZoomSliderPct] = useState(50);
  const sliderDraggingRef = useRef(false);
  const lastSyncedSliderPctRef = useRef<number | null>(null);
  /** True if the current primary-button gesture moved enough to count as orbit/pan (not a pure click). */
  const cameraGestureDraggedRef = useRef(false);
  const cameraGestureRef = useRef({ down: false, x: 0, y: 0 });
  /** Used to ignore background-click clear when we synthesize a node selection. */
  const synthesizedNodeSelectRef = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const DRAG_PX = 8;
    const g = cameraGestureRef;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      g.current = { down: true, x: e.clientX, y: e.clientY };
      cameraGestureDraggedRef.current = false;
      synthesizedNodeSelectRef.current = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!g.current.down) return;
      const { x, y } = g.current;
      if (Math.hypot(e.clientX - x, e.clientY - y) >= DRAG_PX)
        cameraGestureDraggedRef.current = true;
    };
    const onUp = (e: PointerEvent) => {
      g.current.down = false;
      if (e.button !== 0) return;
      if (cameraGestureDraggedRef.current) return;

      const fg = fgRef.current as {
        scene?: () => THREE.Object3D;
        camera?: () => THREE.Camera;
      } | null;
      const scene = fg?.scene?.();
      const camera = fg?.camera?.() as THREE.Camera | undefined;
      if (!scene || !camera) return;

      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2(x, y);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      if (!hits.length) return;

      const climbGraphObj = (o: THREE.Object3D | null): any => {
        let cur: any = o;
        while (
          cur &&
          !Object.prototype.hasOwnProperty.call(cur, "__graphObjType")
        ) {
          cur = cur.parent;
        }
        return cur;
      };

      const graphObj = climbGraphObj(hits[0]?.object ?? null);
      if (graphObj?.__graphObjType === "node" && graphObj.__data) {
        synthesizedNodeSelectRef.current = true;
        props.onNodeClick(graphObj.__data as GraphViewNode);
      }
    };
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointermove", onMove, true);
    el.addEventListener("pointerup", onUp, true);
    el.addEventListener("pointercancel", onUp, true);
    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointermove", onMove, true);
      el.removeEventListener("pointerup", onUp, true);
      el.removeEventListener("pointercancel", onUp, true);
    };
  }, []);

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

  const selectedNodeId = props.selectedNodeId;
  const nodeSelected = selectedNodeId != null;

  const neighborIds = useMemo(() => {
    if (selectedNodeId == null) return null;
    return neighborIdsForSelection(selectedNodeId, props.links);
  }, [selectedNodeId, props.links]);

  const nodesById = useMemo(() => {
    const m = new Map<string, GraphViewNode>();
    for (const n of graphData.nodes) m.set(n.id, n);
    return m;
  }, [graphData.nodes]);

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
    const fg = fgRef.current;
    fg?.refresh?.();
    enableClickAfterDrag(fg ?? null);
  }, [props.theme]);

  const isDark = (props.theme ?? "dark") === "dark";
  const linkStroke = isDark ? "#ffffff" : "#6b7280";
  const defaultLinkOpacity = isDark ? 0.55 : 0.45;

  const ga = graphAnimRef.current;
  ga.selectedNodeId = selectedNodeId;
  ga.neighborIds = neighborIds;
  ga.isDark = isDark;
  ga.nodeSelected = nodeSelected;
  ga.linkBaseColor.set(linkStroke);
  ga.linkBaseOpacity = defaultLinkOpacity;
  nodesByIdRef.current = nodesById;
  linkStrokeOnlyRef.current = linkStroke;
  if (selectedNodeId != null) {
    prevSelRef.current = selectedNodeId;
    prevNeighborsRef.current = neighborIds;
  }

  const nodeThreeObject = useCallback((n: unknown) => {
    const node = n as GraphViewNode;
    return makeNodeObject(node, graphAnimRef.current.isDark);
  }, []);

  const linkColorStable = useCallback(() => linkStrokeOnlyRef.current, []);

  useEffect(() => {
    let rafId = 0;
    const loop = () => {
      rafId = requestAnimationFrame(loop);
      const fg = fgRef.current;
      const scene = fg?.scene?.() as THREE.Object3D | undefined;
      if (!scene) return;
      const snap = graphAnimRef.current;
      const target = snap.nodeSelected ? 1 : 0;
      const b = colorBlendRef.current;
      const blend = b + (target - b) * COLOR_BLEND_RATE;
      colorBlendRef.current = blend;
      const exiting = !snap.nodeSelected && blend > 0.015;
      const effSel = exiting ? prevSelRef.current : snap.selectedNodeId;
      const effNei = exiting ? prevNeighborsRef.current : snap.neighborIds;
      applyGraphColorAnimations(
        scene,
        blend,
        snap,
        nodesByIdRef.current,
        effSel,
        effNei,
      );
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useLayoutEffect(() => {
    enableClickAfterDrag(fgRef.current);
  }, [
    dims.width,
    dims.height,
    graphData.nodes.length,
    graphData.links.length,
    isDark,
  ]);

  useEffect(() => {
    const fg = fgRef.current;
    enableClickAfterDrag(fg);
    if (fg?.refresh) {
      requestAnimationFrame(() => {
        fg.refresh();
        enableClickAfterDrag(fg);
      });
    }
  }, [
    graphData.nodes.length,
    graphData.links.length,
    isDark,
    dims.width,
    dims.height,
  ]);

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
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        linkWidth={0.6}
        linkOpacity={defaultLinkOpacity}
        linkColor={linkColorStable}
        linkDirectionalArrowColor={linkColorStable}
        onNodeHover={(n: unknown) => {
          props.onNodeHover((n as GraphViewNode) ?? null);
        }}
        onNodeClick={(n: unknown) => props.onNodeClick(n as GraphViewNode)}
        onBackgroundClick={() => {
          if (synthesizedNodeSelectRef.current) return;
          if (cameraGestureDraggedRef.current) return;
          props.onBackgroundClick?.();
        }}
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
          nodeSelected && props.detailPanelOpen
            ? "graphDetailPanel graphDetailPanel--open"
            : "graphDetailPanel"
        }
        aria-hidden={!nodeSelected}
        onPointerEnter={() => props.onOverlayPointerEnter?.()}
        onPointerLeave={() => props.onOverlayPointerLeave?.()}
      >
        {props.overlayPaper && nodeSelected ? (
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
