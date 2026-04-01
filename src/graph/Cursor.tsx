import { useEffect, useRef, type RefObject } from "react";

export type CursorProps = {
  /** When set (graph node hover), frame expands and shows this label inside L-corners. */
  hoverTitle?: string | null;
  /** False when the pointer is outside the graph region — hides the custom cursor. */
  graphActive?: boolean;
  /** Graph container; positions are computed relative to this element (position: relative). */
  containerRef: RefObject<HTMLElement | null>;
};

export default function Cursor({
  hoverTitle = null,
  graphActive = false,
  containerRef,
}: CursorProps) {
  const cursorFrameRef = useRef<HTMLDivElement>(null);
  const cursorEnlarged = useRef(false);
  const hoverTitleRef = useRef<string | null>(null);
  const graphActiveRef = useRef(false);
  hoverTitleRef.current = hoverTitle;
  graphActiveRef.current = graphActive;

  function isOverGraphDetailPanel(clientX: number, clientY: number): boolean {
    const hit = document.elementFromPoint(clientX, clientY);
    return !!hit?.closest?.(".graphDetailPanel");
  }

  const onMouseMove = (event: MouseEvent) => {
    positionFrame(event);
  };
  const onMouseDown = (e: MouseEvent) => {
    if (!graphActiveRef.current || isOverGraphDetailPanel(e.clientX, e.clientY))
      return;
    cursorEnlarged.current = true;
    toggleCursorSize();
  };
  const onMouseUp = (e: MouseEvent) => {
    if (!graphActiveRef.current || isOverGraphDetailPanel(e.clientX, e.clientY))
      return;
    cursorEnlarged.current = false;
    toggleCursorSize();
  };

  useEffect(() => {
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);

    handleLinks();

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    const el = cursorFrameRef.current;
    if (!el) return;
    if (!graphActive) el.style.opacity = "0";
  }, [graphActive]);

  function positionFrame(e: MouseEvent) {
    const el = cursorFrameRef.current;
    const root = containerRef.current;
    if (!el || !root) return;
    if (!graphActiveRef.current) {
      el.style.opacity = "0";
      return;
    }
    if (isOverGraphDetailPanel(e.clientX, e.clientY)) {
      el.style.opacity = "0";
      return;
    }
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.opacity = "1";
  }

  function toggleCursorSize() {
    if (hoverTitleRef.current || !graphActiveRef.current) return;
    const el = cursorFrameRef.current;
    if (!el) return;
    if (cursorEnlarged.current) {
      el.style.transform = "translate(-50%, -50%) scale(1.85)";
    } else {
      el.style.transform = "translate(-50%, -50%) scale(1)";
    }
  }

  function handleLinks() {
    document.querySelectorAll("a").forEach((anchor) => {
      if (anchor.closest(".graphDetailPanel")) return;
      anchor.addEventListener("mouseover", () => {
        if (!graphActiveRef.current) return;
        cursorEnlarged.current = true;
        toggleCursorSize();
      });
      anchor.addEventListener("mouseout", () => {
        if (!graphActiveRef.current) return;
        cursorEnlarged.current = false;
        toggleCursorSize();
      });
    });
  }

  const expanded = !!hoverTitle;

  return (
    <div
      ref={cursorFrameRef}
      className={
        expanded ? "cursor-frame cursor-frame--expanded" : "cursor-frame"
      }
    >
      {expanded ? (
        <div className="cursor-hover-title">{hoverTitle}</div>
      ) : null}
    </div>
  );
}
