import React from "react";
import { useHandleWSEvents } from "../hooks/use-handle-ws-events";
import { useHandleRuntimeActive } from "../hooks/use-handle-runtime-active";
import { useRecordAdapterIncidents } from "../hooks/use-record-adapter-incidents";

export function EventHandler({ children }: React.PropsWithChildren) {
  useHandleWSEvents();
  useHandleRuntimeActive();
  useRecordAdapterIncidents();

  return children;
}
