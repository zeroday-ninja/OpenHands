import { useEffect } from "react";
import { useLoaderData, useLocation, useNavigate } from "react-router";
import { Route } from "./+types/automation-setup-route";
import {
  automationDetailPath,
  automationListPath,
  hasAutomationInterface,
} from "#/manifests/automation-interface";
import { SETUP_REGISTRY } from "#/manifests/manifest-sources";
import { SetupDialog } from "#/components/features/manifest/manifest-setup-dialog";
import { DetailSkeleton } from "#/components/features/automations/detail/detail-skeleton";
import { NotFoundState } from "#/components/features/automations/detail/not-found-state";
import { ErrorState } from "#/components/features/automations/error-state";
import { useAutomationDetail } from "#/hooks/query/use-automation-detail";
import { getErrorStatus } from "#/hooks/query/use-settings";
import type { Automation } from "#/types/automation";
import {
  improveProgramPath,
  isImprovementProgram,
} from "#/utils/improve-program";

/**
 * Setup for one catalog entry.
 *
 * The path is not declared by the manifest: it is the same shape for every
 * entry, so the host derives it from the id. Without an admitted manifest the
 * page has nothing to render or submit to, which is a 404 the layout's
 * existing error boundary renders.
 *
 * An id no entry claims is not necessarily nothing: this URL is easy to build
 * or paste with a live automation's id, and that automation has a page of its
 * own. Telling the two apart costs a request, so the loader admits the id and
 * the page resolves it.
 */
export const clientLoader = ({ params }: Route.ClientLoaderArgs) => {
  const automationId = params.automationId ?? "";
  const entry = SETUP_REGISTRY.findById(automationId);

  // Setup submits against the interface manifest's endpoints, so without an
  // admitted manifest the page has nothing to submit to either.
  if (!hasAutomationInterface()) {
    throw new Response(null, { status: 404, statusText: "Not Found" });
  }

  return { automationId: entry?.id ?? automationId, isCatalogEntry: !!entry };
};

function CatalogEntrySetup({ automationId }: { automationId: string }) {
  const location = useLocation();
  const navigate = useNavigate();

  const entry = SETUP_REGISTRY.findById(automationId);
  if (!entry) return null;

  const handleClose = () => {
    // "default" is the initial history entry, so there is nothing to go back
    // to; dismissing a cold deep link lands on the list instead.
    if (location.key === "default")
      navigate(automationListPath(), { replace: true });
    else navigate(-1);
  };

  return <SetupDialog entry={entry} onClose={handleClose} />;
}

/** The page that owns an existing automation. */
function pageForAutomation(automation: Automation): string {
  return isImprovementProgram(automation)
    ? improveProgramPath(automation.id)
    : automationDetailPath(automation.id);
}

/**
 * An id the catalog does not claim, resolved as an existing automation.
 *
 * Setup for a preset the user already created is that automation's own page,
 * not this one: the improvement-program dashboard for a program, the detail
 * page otherwise. Only an id that is no automation either is a dead end, and
 * it says so rather than 404ing the whole route.
 */
function ExistingAutomationSetup({ automationId }: { automationId: string }) {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useAutomationDetail({
    id: automationId,
  });
  const target = data ? pageForAutomation(data) : null;

  useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [navigate, target]);

  let body = <DetailSkeleton />;
  if (!isLoading && !target) {
    body =
      isError && getErrorStatus(error) !== 404 ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <NotFoundState />
      );
  }

  return (
    <div className="min-h-full">
      <div className="p-6 max-w-4xl mx-auto">{body}</div>
    </div>
  );
}

export default function AutomationSetupRoute() {
  const { automationId, isCatalogEntry } = useLoaderData<typeof clientLoader>();

  return isCatalogEntry ? (
    <CatalogEntrySetup automationId={automationId} />
  ) : (
    <ExistingAutomationSetup automationId={automationId} />
  );
}
