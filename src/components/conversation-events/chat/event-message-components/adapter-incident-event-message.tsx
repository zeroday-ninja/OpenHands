/**
 * An adapter's report that it met something it could not translate, as a
 * notice with what became of it.
 *
 * The adapter also says this as a sentence in the assistant's text. The
 * notice is the typed half on screen: which adapter, what it could not read,
 * and whether it was filed as a lesson for the next cycle on that runtime —
 * or why it could not be, because "recorded" that silently failed is the
 * `out_of_scope` failure the learning pipeline exists to catch.
 */

import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { ACPAdapterIncidentEvent } from "#/types/agent-server/core/events/acp-adapter-incident-event";
import {
  adapterIncidentKey,
  useAdapterIncidentsStore,
} from "#/stores/adapter-incidents-store";
import { useOptionalConversationId } from "#/hooks/use-conversation-id";

export function AdapterIncidentEventMessage({
  event,
}: {
  event: ACPAdapterIncidentEvent;
}) {
  const { t } = useTranslation("openhands");
  const { conversationId } = useOptionalConversationId();
  const record = useAdapterIncidentsStore((state) =>
    conversationId
      ? state.records[
          adapterIncidentKey({
            conversationId,
            adapter: event.adapter,
            what: event.what,
            kind: event.unrecognised_kind,
          })
        ]
      : undefined,
  );
  const status =
    record === undefined
      ? null
      : record.lessonId !== null
        ? t(I18nKey.ACP_INCIDENT$RECORDED)
        : record.error !== null
          ? t(I18nKey.ACP_INCIDENT$NOT_RECORDED, { reason: record.error })
          : null;

  return (
    <div
      data-testid="adapter-incident-event"
      data-adapter={event.adapter}
      data-what={event.what}
      data-kind={event.unrecognised_kind ?? undefined}
      data-recorded={record?.lessonId ? "true" : "false"}
      data-error={record?.error ?? undefined}
      className="flex flex-col gap-1 rounded-lg border border-feedback-warning/40 bg-base-secondary px-3 py-2 text-sm"
    >
      <span className="text-micro font-semibold uppercase tracking-widest text-feedback-warning">
        {t(I18nKey.ACP_INCIDENT$TITLE)}
      </span>
      <span className="text-contrast">
        {t(I18nKey.ACP_INCIDENT$BODY, {
          adapter: event.adapter,
          what: event.what,
          kind: event.unrecognised_kind ?? t(I18nKey.ACP_INCIDENT$NO_KIND),
        })}
      </span>
      {status !== null && (
        <span
          data-testid="adapter-incident-status"
          className="text-xs text-muted"
        >
          {status}
        </span>
      )}
    </div>
  );
}
