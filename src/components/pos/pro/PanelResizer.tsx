"use client";

// =============================================
// Cart / quick-grid split (desktop Pro till)
//
// The right column used to be a hard-coded 380px. That is the wrong number for
// most tills: a shop that mostly scans wants the cart wide and the grid narrow,
// and a shop that mostly taps the grid (bakery, produce, anything without
// barcodes) wants the opposite. Neither can be right for both, so the cashier
// drags the divider and the till remembers it.
//
// The width is per DEVICE, not per store — it is a property of the screen this
// till runs on, and two tills in the same shop can reasonably differ.
// =============================================

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "goldensquirrel_pos_panel_width";

/** What the layout shipped with, and where a double-click resets to. */
export const DEFAULT_PANEL_WIDTH = 380;

const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 760;

/**
 * The cart keeps at least this much room whatever the window size. A cart
 * squeezed narrower than this truncates product names to the point where a
 * cashier cannot tell two similar lines apart, which is a mis-sale waiting to
 * happen — worth more than honouring the drag exactly.
 */
const MIN_CART_WIDTH = 420;

/** Arrow-key nudge. Coarse enough to be useful, fine enough to land precisely. */
const KEYBOARD_STEP = 16;

function clampWidth(next: number, containerWidth?: number): number {
  let max = MAX_PANEL_WIDTH;
  if (containerWidth && containerWidth > 0) {
    // Never at the cart's expense.
    max = Math.min(max, Math.max(MIN_PANEL_WIDTH, containerWidth - MIN_CART_WIDTH));
  }
  return Math.round(Math.min(max, Math.max(MIN_PANEL_WIDTH, next)));
}

// ── The stored width, as an external store ───────────────────────────────────
//
// localStorage is exactly what useSyncExternalStore is for: state that lives
// outside React and differs between server and client. Reading it in an effect
// and calling setState would work, but it renders twice on every mount and is
// the cascading-render pattern the React lint rules (rightly) reject.
//
// getServerSnapshot returns the default, so the prerendered HTML is stable and
// there is no hydration mismatch; the client swaps to the stored width on its
// first commit.

/** Cached so getSnapshot is referentially stable — it must not re-read on every render. */
let cachedWidth: number | null = null;
const widthListeners = new Set<() => void>();

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return clampWidth(parsed);
    }
  } catch {
    /* a storage we cannot read just means the default */
  }
  return DEFAULT_PANEL_WIDTH;
}

function getWidthSnapshot(): number {
  if (cachedWidth === null) cachedWidth = readStoredWidth();
  return cachedWidth;
}

function getServerWidthSnapshot(): number {
  return DEFAULT_PANEL_WIDTH;
}

function subscribeToWidth(onChange: () => void): () => void {
  widthListeners.add(onChange);
  return () => {
    widthListeners.delete(onChange);
  };
}

function storeWidth(next: number): void {
  cachedWidth = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    /* the layout still works, it just will not be remembered */
  }
  for (const listener of widthListeners) listener();
}

/** The persisted width of the right-hand (totals + quick grid) column. */
export function usePanelWidth() {
  const width = useSyncExternalStore(
    subscribeToWidth,
    getWidthSnapshot,
    getServerWidthSnapshot
  );

  const commitWidth = useCallback((next: number, containerWidth?: number) => {
    const clamped = clampWidth(next, containerWidth);
    storeWidth(clamped);
    return clamped;
  }, []);

  return { width, commitWidth };
}

interface PanelResizerProps {
  /** The element being resized — the right-hand column. */
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** The row holding both columns, used to keep the cart above its minimum. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  onCommit: (next: number, containerWidth?: number) => number;
  /**
   * Called once the drag ends. The Pro till lives or dies on the scan field
   * holding focus — a wedge scanner types into whatever has it — so the
   * divider hands focus straight back rather than keeping it.
   */
  onDragEnd?: () => void;
}

export default function PanelResizer({
  panelRef,
  containerRef,
  width,
  onCommit,
  onDragEnd,
}: PanelResizerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ignore anything that is not a primary press (right-click, extra
      // buttons) — a context menu mid-drag leaves the pointer captured.
      if (e.button !== 0) return;
      const panel = panelRef.current;
      if (!panel) return;

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startWidth: panel.offsetWidth };
      setIsDragging(true);
    },
    [panelRef]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const panel = panelRef.current;
      if (!drag || !panel) return;

      // Written straight to the DOM, deliberately NOT through React state.
      // The right column contains QuickGrid, and re-rendering the till on every
      // pointermove makes the drag stutter on exactly the low-end hardware
      // these run on. State is updated once, on release.
      const delta = drag.startX - e.clientX; // dragging left widens the panel
      const next = clampWidth(
        drag.startWidth + delta,
        containerRef.current?.offsetWidth
      );
      panel.style.width = `${next}px`;
    },
    [panelRef, containerRef]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }

      const panel = panelRef.current;
      if (panel) {
        onCommit(panel.offsetWidth, containerRef.current?.offsetWidth);
      }
      onDragEnd?.();
    },
    [panelRef, containerRef, onCommit, onDragEnd]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const containerWidth = containerRef.current?.offsetWidth;
      let next: number | null = null;

      if (e.key === "ArrowLeft") next = width + KEYBOARD_STEP;
      else if (e.key === "ArrowRight") next = width - KEYBOARD_STEP;
      else if (e.key === "Home") next = MIN_PANEL_WIDTH;
      else if (e.key === "End") next = MAX_PANEL_WIDTH;
      else if (e.key === "Enter" || e.key === " ") next = DEFAULT_PANEL_WIDTH;

      if (next === null) return;
      e.preventDefault();
      onCommit(next, containerWidth);
    },
    [width, containerRef, onCommit]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize cart and quick grid"
      aria-valuenow={width}
      aria-valuemin={MIN_PANEL_WIDTH}
      aria-valuemax={MAX_PANEL_WIDTH}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onCommit(DEFAULT_PANEL_WIDTH, containerRef.current?.offsetWidth)}
      onKeyDown={handleKeyDown}
      title="Drag to resize · double-click to reset"
      // -mx-2 keeps the visible line hairline-thin while the grab area stays a
      // comfortable target on a touchscreen. touch-none stops the browser
      // treating the drag as a scroll.
      className={`group -mx-2 flex w-4 flex-none cursor-col-resize touch-none items-center justify-center rounded-full outline-none ${
        isDragging ? "" : "transition-colors"
      }`}
    >
      <div
        className={`h-16 w-1 rounded-full transition-colors ${
          isDragging
            ? "bg-primary"
            : "bg-white/[0.12] group-hover:bg-primary/60 group-focus-visible:bg-primary"
        }`}
      />
    </div>
  );
}
