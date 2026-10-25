import { useEffect } from "react";
import { useLoaderData, useLocation, useNavigate } from "react-router";
import { Route } from "./+types/automation-setup-route";
import {
  automationDetailPath,
  automationListPath,
  automationInterfaceRejection,
  hasAutomationInterface,
} from "#/manifests/automation-interface";
import { RejectedManifestNotice } from "#/components/features/automations/rejected-manifest-notice";
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
  // admitted manifest the page has nothing to submit to either. A manifest
  // that was published and refused is a package defect rather than a
  // deployment without automations, and says so instead of 404ing.
  if (!hasAutomationInterface() && !automationInterfaceRejection()) {
    throw new Response(null, { status: 404, statusText: "Not Found" });
  }

  // A refused entry is neither a catalog entry nor a missing one. Without
  // this it fell through to the automation lookup and the page said there was
  // no such automation — which is a different claim from "the catalog
  // published this and this host would not run it".
  const rejection = entry ? null : SETUP_REGISTRY.rejectionFor(automationId);

  return {
    automationId: entry?.id ?? automationId,
    isCatalogEntry: !!entry,
    setupRejection: rejection?.reason ?? null,
  };
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

function AutomationSetupRoutePage() {
  const { automationId, isCatalogEntry, setupRejection } =
    useLoaderData<typeof clientLoader>();

  // Said before the automation lookup, because the lookup's answer would be
  // "no such automation" and that is not what happened.
  if (setupRejection) return <RejectedManifestNotice reason={setupRejection} />;

  return isCatalogEntry ? (
    <CatalogEntrySetup automationId={automationId} />
  ) : (
    <ExistingAutomationSetup automationId={automationId} />
  );
}

/**
 * The page, or why there is no page.
 *
 * A wrapper rather than an early return inside the page itself: everything in
 * there reads the admitted manifest, which by definition is not there when the
 * published one was refused.
 */
export default function AutomationSetupRoute() {
  const rejection = automationInterfaceRejection();
  if (rejection) return <RejectedManifestNotice reason={rejection} />;
  return <AutomationSetupRoutePage />;
}
