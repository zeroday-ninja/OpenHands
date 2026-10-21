import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAgentCanvasControlStatus,
  requestAgentCanvasControl,
  type AgentCanvasControlInfo,
  type AgentCanvasControlTarget,
} from "#/api/agent-canvas-updates";

export type AgentCanvasSelfUpdateAction = "update" | "restart";

export type AgentCanvasSelfUpdateState =
  | { phase: "idle" }
  | { phase: "requesting"; action: AgentCanvasSelfUpdateAction }
  | {
      phase: "updating";
      action: AgentCanvasSelfUpdateAction;
      message: string | null;
    }
  | { phase: "restarting"; action: AgentCanvasSelfUpdateAction }
  | { phase: "reloading"; action: AgentCanvasSelfUpdateAction }
  | { phase: "failed"; action: AgentCanvasSelfUpdateAction; error: string };

export const SELF_UPDATE_POLL_MS = 1000;
/** `npm ci` / `npm install -g` on a slow link can take a few minutes. */
export const SELF_UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
export const SELF_RESTART_TIMEOUT_MS = 3 * 60 * 1000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      window.clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

interface UseAgentCanvasSelfUpdateOptions {
  /** Replaces `window.location.reload()` (tests). */
  reload?: () => void;
  pollMs?: number;
}

/**
 * Drive an in-place update or restart of the local stack, the way
 * clockwork-quill's "restart server" does: ask the launcher, then poll the
 * ingress status until a *different* instance answers (the replacement
 * stack), and reload the page onto it. Unreachable polls are expected while
 * the old stack is down and the new one is starting.
 */
export function useAgentCanvasSelfUpdate(
  control: {
    info: AgentCanvasControlInfo;
    target: AgentCanvasControlTarget;
  } | null,
  {
    reload,
    pollMs = SELF_UPDATE_POLL_MS,
  }: UseAgentCanvasSelfUpdateOptions = {},
) {
  const [state, setState] = useState<AgentCanvasSelfUpdateState>({
    phase: "idle",
  });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const start = useCallback(
    async (action: AgentCanvasSelfUpdateAction) => {
      if (!control) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;
      setState({ phase: "requesting", action });
      try {
        const accepted = await requestAgentCanvasControl(
          control.target,
          action,
          signal,
        );
        const startedInstance = accepted.instance;
        setState(
          accepted.phase === "updating"
            ? { phase: "updating", action, message: accepted.message }
            : { phase: "restarting", action },
        );
        const deadline =
          Date.now() +
          (action === "update"
            ? SELF_UPDATE_TIMEOUT_MS
            : SELF_RESTART_TIMEOUT_MS);
        while (!signal.aborted) {
          await sleep(pollMs, signal);
          let status;
          try {
            status = await fetchAgentCanvasControlStatus(
              control.target,
              signal,
            );
          } catch (error) {
            if (signal.aborted) throw error;
            // Between stacks: the old ingress is gone, the new one not up.
            setState({ phase: "restarting", action });
            if (Date.now() > deadline) {
              throw new Error("The stack did not come back in time.");
            }
            continue;
          }
          if (status.instance !== startedInstance) {
            setState({ phase: "reloading", action });
            (reload ?? (() => window.location.reload()))();
            return;
          }
          if (status.phase === "failed") {
            setState({
              phase: "failed",
              action,
              error: status.message ?? "The launcher reported a failure.",
            });
            return;
          }
          setState(
            status.phase === "restarting"
              ? { phase: "restarting", action }
              : { phase: "updating", action, message: status.message },
          );
          if (Date.now() > deadline) {
            throw new Error("The update did not finish in time.");
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        setState({
          phase: "failed",
          action,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [control, pollMs, reload],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({ phase: "idle" });
  }, []);

  return { state, start, reset };
}
