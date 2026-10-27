/**
 * The right-click menu, shared by the canvas, the board and the panels.
 *
 * Each caller describes its actions as data; this draws them, places them
 * inside the viewport, moves focus with the arrow keys, opens submenus on the
 * right arrow or hover, and closes on Escape, an outside press, or a choice.
 * The caller never has to know how menus work, which is what keeps "right
 * click anything" true across the whole workbench.
 */

import React from "react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "#/utils/utils";

export interface WorkbenchMenuItem {
  id: string;
  label: string;
  /** A keyboard hint drawn at the right, e.g. "Del". */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  children?: WorkbenchMenuItem[];
}

export interface WorkbenchMenuState {
  x: number;
  y: number;
  title?: string;
  items: WorkbenchMenuItem[];
}

const MENU_WIDTH = 220;
const MENU_ITEM_CLASS =
  "flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-xs text-foreground outline-none hover:bg-interactive-hover focus-visible:bg-interactive-hover disabled:cursor-not-allowed disabled:opacity-40";

function clampToViewport(x: number, y: number, height: number) {
  if (typeof window === "undefined") return { x, y };
  return {
    x: Math.max(4, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
    y: Math.max(4, Math.min(y, window.innerHeight - height - 8)),
  };
}

interface MenuListProps {
  items: WorkbenchMenuItem[];
  title?: string;
  depth: number;
  onDone: () => void;
  onBack?: () => void;
}

function MenuList({ items, title, depth, onDone, onBack }: MenuListProps) {
  const [openChild, setOpenChild] = React.useState<string | null>(null);
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);

  React.useEffect(() => {
    const first = buttons.current.find((button) => button && !button.disabled);
    first?.focus();
  }, []);

  const focusAt = (index: number) => {
    const enabled = buttons.current
      .map((button, idx) => ({ button, idx }))
      .filter((entry) => entry.button && !entry.button.disabled);
    if (enabled.length === 0) return;
    const position = enabled.findIndex((entry) => entry.idx === index);
    const target = enabled[(position + enabled.length) % enabled.length];
    target.button?.focus();
  };

  const onKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    index: number,
    item: WorkbenchMenuItem,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = buttons.current.findIndex(
        (button, idx) => idx > index && button && !button.disabled,
      );
      focusAt(
        next === -1
          ? buttons.current.findIndex((button) => button && !button.disabled)
          : next,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      let prev = -1;
      for (let idx = index - 1; idx >= 0; idx -= 1) {
        if (buttons.current[idx] && !buttons.current[idx]?.disabled) {
          prev = idx;
          break;
        }
      }
      if (prev === -1) {
        for (let idx = buttons.current.length - 1; idx > index; idx -= 1) {
          if (buttons.current[idx] && !buttons.current[idx]?.disabled) {
            prev = idx;
            break;
          }
        }
      }
      if (prev !== -1) focusAt(prev);
    } else if (event.key === "ArrowRight" && item.children) {
      event.preventDefault();
      setOpenChild(item.id);
    } else if (event.key === "ArrowLeft" && onBack) {
      event.preventDefault();
      onBack();
    }
  };

  return (
    <div
      role="menu"
      data-testid={depth === 0 ? "workbench-context-menu" : undefined}
      className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-tertiary p-1 shadow-lg"
      style={{ width: MENU_WIDTH }}
    >
      {title && (
        <div className="truncate px-2 py-1 text-micro font-semibold uppercase tracking-widest text-muted">
          {title}
        </div>
      )}
      {items.map((item, index) => (
        <div
          key={item.id}
          className="relative"
          onKeyDown={(event) => onKeyDown(event, index, item)}
        >
          <button
            type="button"
            role={item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            data-testid={`workbench-menu-${item.id}`}
            disabled={item.disabled}
            aria-haspopup={item.children ? "menu" : undefined}
            aria-expanded={item.children ? openChild === item.id : undefined}
            aria-checked={item.checked}
            className={cn(MENU_ITEM_CLASS, item.danger && "text-danger")}
            onMouseEnter={() => setOpenChild(item.children ? item.id : null)}
            onClick={() => {
              if (item.children) {
                setOpenChild(item.id);
                return;
              }
              item.onSelect?.();
              onDone();
            }}
          >
            <span className="flex items-center gap-2 truncate">
              {item.checked !== undefined && (
                <span aria-hidden className="inline-flex w-3 justify-center">
                  {item.checked && <Check size={12} />}
                </span>
              )}
              <span className="truncate">{item.label}</span>
            </span>
            {item.children ? (
              <ChevronRight size={12} aria-hidden />
            ) : (
              item.hint && (
                <kbd className="font-mono text-micro text-muted">
                  {item.hint}
                </kbd>
              )
            )}
          </button>
          {item.children && openChild === item.id && (
            <div className="absolute left-full top-0 -ml-0.5 pl-0.5">
              <MenuList
                items={item.children}
                depth={depth + 1}
                onDone={onDone}
                onBack={() => {
                  setOpenChild(null);
                  buttons.current[index]?.focus();
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export interface WorkbenchContextMenuProps {
  menu: WorkbenchMenuState | null;
  onClose: () => void;
}

export function WorkbenchContextMenu({
  menu,
  onClose,
}: WorkbenchContextMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menu) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  const estimatedHeight = menu.items.length * 30 + (menu.title ? 28 : 0) + 8;
  const { x, y } = clampToViewport(menu.x, menu.y, estimatedHeight);
  return (
    <div
      ref={ref}
      className="fixed z-50"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <MenuList
        items={menu.items}
        title={menu.title}
        depth={0}
        onDone={onClose}
      />
    </div>
  );
}

/** The usual "open a menu on right click" wiring. */
export function useWorkbenchContextMenu() {
  const [menu, setMenu] = React.useState<WorkbenchMenuState | null>(null);
  const open = React.useCallback(
    (
      event: {
        clientX: number;
        clientY: number;
        preventDefault: () => void;
        stopPropagation?: () => void;
      },
      items: WorkbenchMenuItem[],
      title?: string,
    ) => {
      event.preventDefault();
      event.stopPropagation?.();
      setMenu({ x: event.clientX, y: event.clientY, items, title });
    },
    [],
  );
  const close = React.useCallback(() => setMenu(null), []);
  return { menu, open, close };
}
