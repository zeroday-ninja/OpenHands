/**
 * What is waiting on you.
 *
 * A cycle that hits a breaking change stops and asks rather than publishing or
 * failing: the work stays on its branch and the cycle holds the phase it
 * stopped at. This is where that question gets answered, and it sits on the
 * map because the map is where the work is — an answer that lives on a
 * different page is an answer the reader has to go looking for.
 *
 * It renders nothing at all when nothing is waiting, including when the
 * automations backend is too old to park anything. A panel that says "no
 * parked work" on every visit teaches the reader to stop looking at it.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import {
  useParkedImproveCycles,
  useResolveImproveCycle,
} from "#/hooks/query/use-improve-program";
import {
  IMPROVE_RESOLVE_ROUTES,
  type ImproveChangeoverPlan,
  type ImproveCycle,
  type ImproveRoute,
} from "#/types/improve";
import { useFeatureTrial } from "#/hooks/use-feature-trial";
import { PROJECT_MAP_BUTTON_CLASS } from "./project-map-controls";

const ICON_SIZE = 14;

const ROUTE_LABELS: Record<ImproveRoute, I18nKey> = {
  approve: I18nKey.IMPROVE$PARKED$ROUTE_APPROVE,
  cycle: I18nKey.IMPROVE$PARKED$ROUTE_CYCLE,
  return: I18nKey.IMPROVE$PARKED$ROUTE_RETURN,
  archive: I18nKey.IMPROVE$PARKED$ROUTE_ARCHIVE,
  // Present for exhaustiveness. `escalate` is never offered: answering *is*
  // the escalation, and the service refuses it here.
  escalate: I18nKey.IMPROVE$PARKED$ROUTE_RETURN,
};

const PLAN_SECTIONS: {
  key: keyof ImproveChangeoverPlan;
  label: I18nKey;
}[] = [
  { key: "breaks", label: I18nKey.IMPROVE$PARKED$PLAN_BREAKS },
  { key: "consumers", label: I18nKey.IMPROVE$PARKED$PLAN_CONSUMERS },
  { key: "sequence", label: I18nKey.IMPROVE$PARKED$PLAN_SEQUENCE },
];

export function ProjectMapWaiting() {
  const { t } = useTranslation("openhands");
  const { data } = useParkedImproveCycles();
  const cycles = data?.cycles ?? [];

  if (cycles.length === 0) return null;

  return (
    <section
      data-testid="project-map-waiting"
      data-count={cycles.length}
      className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3"
    >
      <header className="flex items-baseline gap-2">
        <Clock size={ICON_SIZE} aria-hidden className="text-warning" />
        <h3 className="text-sm font-medium text-contrast">
          {t(I18nKey.IMPROVE$PARKED$HEADING)}
        </h3>
        <p className="text-xs text-text-secondary">
          {t(I18nKey.IMPROVE$PARKED$SUBTITLE)}
        </p>
      </header>
      {cycles.map((cycle) => (
        <ParkedCycle key={cycle.id} cycle={cycle} />
      ))}
    </section>
  );
}

function ParkedCycle({ cycle }: { cycle: ImproveCycle }) {
  const { t } = useTranslation("openhands");
  const resolve = useResolveImproveCycle();
  const trial = useFeatureTrial("map-waiting-on-you");
  const [reason, setReason] = React.useState("");
  const reasonId = `parked-reason-${cycle.id}`;

  const answer = (route: ImproveRoute) => {
    // Answering is what using this panel means. Rendering is not: a panel
    // that appeared is not a panel anybody acted on, and counting a render
    // would make an ignored feature look used.
    trial.markUsed();
    // The service requires a reason and so does this: an answer with no
    // reasoning behind it has to be guessed at again next time, which is the
    // repetition this whole surface exists to end.
    if (!reason.trim()) return;
    resolve.mutate({ cycleId: cycle.id, route, resolution: reason.trim() });
  };

  return (
    <article
      data-testid="project-map-waiting-cycle"
      data-cycle-id={cycle.id}
      data-change-class={cycle.change_class ?? undefined}
      className="flex flex-col gap-2 rounded-md bg-base-secondary p-3"
    >
      <p className="font-mono text-micro text-muted">
        {cycle.repository.label}
        {cycle.branch ? ` · ${cycle.branch}` : ""}
        {cycle.change_class ? ` · ${cycle.change_class}` : ""}
      </p>
      <p className="whitespace-pre-line text-sm text-contrast">
        {cycle.parked_question ?? cycle.summary}
      </p>
      <ChangeoverPlan plan={cycle.parked_plan ?? null} />
      <label
        htmlFor={reasonId}
        className="text-xs font-medium text-text-secondary"
      >
        {t(I18nKey.IMPROVE$PARKED$REASON_LABEL)}
      </label>
      <textarea
        id={reasonId}
        data-testid="project-map-waiting-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        placeholder={t(I18nKey.IMPROVE$PARKED$REASON_REQUIRED)}
        className="w-full rounded-md border border-border-subtle bg-canvas-base p-2 text-sm text-canvas-base"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {IMPROVE_RESOLVE_ROUTES.map((route) => (
          <button
            key={route}
            type="button"
            data-testid={`project-map-waiting-route-${route}`}
            className={PROJECT_MAP_BUTTON_CLASS}
            disabled={!reason.trim() || resolve.isPending}
            onClick={() => answer(route)}
          >
            {t(ROUTE_LABELS[route])}
          </button>
        ))}
      </div>
      {resolve.isError && (
        <p
          data-testid="project-map-waiting-error"
          className="text-xs text-danger"
        >
          {t(I18nKey.IMPROVE$PARKED$FAILED)}
        </p>
      )}
    </article>
  );
}

/**
 * The changeover plan, with whatever the builder did not supply still shown.
 *
 * The service fills an unsupplied field with a sentence saying so rather than
 * leaving it empty, because a blank rollback reads as a change that needs no
 * rollback. Rendering those sentences is the point; hiding them here would
 * undo that.
 */
function ChangeoverPlan({ plan }: { plan: ImproveChangeoverPlan | null }) {
  const { t } = useTranslation("openhands");
  if (!plan) return null;

  return (
    <dl className="flex flex-col gap-1.5 text-xs">
      {PLAN_SECTIONS.map(({ key, label }) => {
        const items = plan[key];
        if (!Array.isArray(items) || items.length === 0) return null;
        return (
          <div key={key} data-testid={`project-map-waiting-plan-${key}`}>
            <dt className="font-medium text-text-secondary">{t(label)}</dt>
            <dd className="text-text-secondary">
              <ul className="list-inside list-disc">
                {items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </dd>
          </div>
        );
      })}
      {plan.rollback && (
        <div data-testid="project-map-waiting-plan-rollback">
          <dt className="font-medium text-text-secondary">
            {t(I18nKey.IMPROVE$PARKED$PLAN_ROLLBACK)}
          </dt>
          <dd className="text-text-secondary">{plan.rollback}</dd>
        </div>
      )}
    </dl>
  );
}
