/**
 * One tooltip for the whole workbench, driven by `data-tip` attributes.
 *
 * Panels, rail icons, parts and cards all want a hover hint, and mounting a
 * tooltip component around each of them would double the tree. Instead the
 * page mounts this once; it listens for pointer movement over anything
 * carrying `data-tip` and shows that text beside the pointer. It is purely
 * visual: everything that matters is also an `aria-label` or visible text.
 */

import React from "react";

const TOOLTIP_DELAY_MS = 350;
const TOOLTIP_OFFSET = 12;

interface TipState {
  text: string;
  x: number;
  y: number;
}

export function WorkbenchTooltip({
  rootRef,
}: {
  rootRef: React.RefObject<HTMLElement | null>;
}) {
  const [tip, setTip] = React.useState<TipState | null>(null);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: Element | null = null;

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      current = null;
      setTip(null);
    };
    const onMove = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest("[data-tip]");
      if (!target) {
        if (current) clear();
        return;
      }
      if (target === current) return;
      if (timer) clearTimeout(timer);
      current = target;
      const text = target.getAttribute("data-tip") ?? "";
      const { clientX, clientY } = event;
      timer = setTimeout(() => {
        setTip({
          text,
          x: clientX + TOOLTIP_OFFSET,
          y: clientY + TOOLTIP_OFFSET,
        });
      }, TOOLTIP_DELAY_MS);
    };
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerdown", clear);
    root.addEventListener("pointerleave", clear);
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", clear);
      root.removeEventListener("pointerleave", clear);
      if (timer) clearTimeout(timer);
    };
  }, [rootRef]);

  if (tip === null || tip.text === "") return null;
  return (
    <div
      role="tooltip"
      data-testid="workbench-tooltip"
      className="pointer-events-none fixed z-50 max-w-64 rounded-md bg-contrast px-2 py-1 text-xs font-medium text-contrast-foreground shadow-md"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>
  );
}
