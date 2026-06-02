import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "pi-gui:sidebar-width";
const DEFAULT_WIDTH = 292;
const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

function readStored(): number {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WIDTH;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return DEFAULT_WIDTH;
    return clamp(n);
  } catch {
    return DEFAULT_WIDTH;
  }
}

function clamp(n: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
}

export interface SidebarResize {
  readonly width: number;
  readonly isResizing: boolean;
  readonly onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function useSidebarWidth(): SidebarResize {
  const [width, setWidth] = useState<number>(() => readStored());
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, String(width));
    } catch {
      // ignore
    }
  }, [width]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    startXRef.current = event.clientX;
    startWidthRef.current = width;
    setIsResizing(true);

    function onMove(e: PointerEvent) {
      const dx = e.clientX - startXRef.current;
      setWidth(clamp(startWidthRef.current + dx));
    }
    function onUp() {
      setIsResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [width]);

  return { width, isResizing, onPointerDown };
}
