/**
 * A short confirmation at the bottom of the stage, with Undo when the thing it
 * confirms can be undone. Deleting without asking first is only acceptable
 * because this is here.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";

export interface WorkbenchToastMessage {
  id: number;
  text: string;
  canUndo: boolean;
}

const TOAST_MS = 3800;
const TOAST_UNDO_MS = 6500;

export function useWorkbenchToast() {
  const [toast, setToast] = React.useState<WorkbenchToastMessage | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = React.useCallback((text: string, canUndo = false) => {
    if (timer.current) clearTimeout(timer.current);
    const next = { id: Date.now(), text, canUndo };
    setToast(next);
    timer.current = setTimeout(
      () => setToast(null),
      canUndo ? TOAST_UNDO_MS : TOAST_MS,
    );
  }, []);
  const dismiss = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);
  return { toast, show, dismiss };
}

export function WorkbenchToast({
  toast,
  onUndo,
  onDismiss,
}: {
  toast: WorkbenchToastMessage | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("openhands");
  if (!toast) return null;
  return (
    <div
      role="status"
      data-testid="workbench-toast"
      className="pointer-events-none absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-md bg-contrast px-3 py-2 text-xs font-medium text-contrast-foreground shadow-lg"
    >
      <span>{toast.text}</span>
      {toast.canUndo && (
        <button
          type="button"
          data-testid="workbench-toast-undo"
          className="pointer-events-auto rounded px-1.5 py-0.5 font-semibold underline-offset-2 hover:underline"
          onClick={() => {
            onUndo();
            onDismiss();
          }}
        >
          {t(I18nKey.WORKBENCH$UNDO)}
        </button>
      )}
    </div>
  );
}
