import { BaseEvent } from "../base/event";

/**
 * An ACP adapter met an event or step it has no translation for.
 *
 * The adapter says so in the assistant's text too, as "[unrecognised step:
 * 'x']"; this is the machine-readable half, emitted by the SDK's bridge the
 * moment the marked chunk arrives. Canvas files it as a lesson against the
 * runtime and shows it as a notice, so the next cycle on that adapter finds
 * it without anyone scraping prose.
 */
export interface ACPAdapterIncidentEvent extends BaseEvent {
  kind: "ACPAdapterIncidentEvent";
  source: "environment";
  /** Provider registry key of the adapter, as it named itself. */
  adapter: string;
  /** `event` for a top-level stream event, `step` for a step inside one. */
  what: string;
  /**
   * The unrecognised type as the CLI named it; null when it carried none.
   * Not `kind`, which is every event's own discriminator.
   */
  unrecognised_kind: string | null;
  /** The sentence the adapter put in the assistant's text, if any. */
  detail: string;
}
