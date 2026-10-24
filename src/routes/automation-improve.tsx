import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { getErrorStatus } from "#/hooks/query/use-settings";
import { useAutomationDetail } from "#/hooks/query/use-automation-detail";
import { useAutomationHealth } from "#/hooks/query/use-automation-health";
import {
  useImproveCycles,
  useImproveRotation,
} from "#/hooks/query/use-improve-program";
import { BackLink } from "#/components/features/automations/detail/back-link";
import { NotFoundState } from "#/components/features/automations/detail/not-found-state";
import { ErrorState } from "#/components/features/automations/error-state";
import { BackendNotConfigured } from "#/components/features/automations/backend-not-configured";
import { GitSyncSkeleton } from "#/components/features/automations/git-sync/git-sync-skeleton";
import { ImproveConfigForm } from "#/components/features/automations/improve/improve-config-form";
import { ImproveCycleHistory } from "#/components/features/automations/improve/improve-cycle-history";
import { ImproveRotationStrip } from "#/components/features/automations/improve/improve-rotation-strip";
import { ImproveStaleCodeNotice } from "#/components/features/automations/improve/improve-stale-code-notice";
import { extensionModuleEmptyStateClassName } from "#/utils/extension-module-card-classes";
import { lastVerdictByRepository } from "#/utils/improve-program";

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <div className="p-6 max-w-4xl mx-auto">{children}</div>
    </div>
  );
}

/**
 * The automation exists but has no improvement configuration, which is what
 * the service answers 409 for. Distinct from a 404: linking a non-program id
 * into this URL must not read as "deleted".
 */
function NotAProgramState() {
  const { t } = useTranslation("openhands");

  return (
    <div
      data-testid="improve-not-a-program"
      className={extensionModuleEmptyStateClassName}
    >
      <h2 className="text-sm font-semibold text-contrast">
        {t(I18nKey.AUTOMATIONS$IMPROVE$NOT_A_PROGRAM_TITLE)}
      </h2>
      <p className="mt-2 text-sm text-tertiary-light">
        {t(I18nKey.AUTOMATIONS$IMPROVE$NOT_A_PROGRAM_BODY)}
      </p>
    </div>
  );
}

function ImproveProgramPage({ automationId }: { automationId: string }) {
  const { t } = useTranslation("openhands");
  const automation = useAutomationDetail({ id: automationId });
  const rotation = useImproveRotation({ automationId });
  const cycles = useImproveCycles({ automationId });

  if (rotation.isLoading) {
    return <GitSyncSkeleton />;
  }

  const rotationStatus = getErrorStatus(rotation.error);
  if (!rotation.data) {
    if (rotationStatus === 404) return <NotFoundState />;
    if (rotationStatus === 409) return <NotAProgramState />;
    return <ErrorState onRetry={() => rotation.refetch()} />;
  }

  // History is secondary: a program whose rotation loaded still shows its
  // rotation when the cycle page fails, rather than replacing the page.
  const cycleList = cycles.data?.cycles ?? [];

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <header className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-content">
          {automation.data?.name || t(I18nKey.AUTOMATIONS$IMPROVE$TITLE)}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {t(I18nKey.AUTOMATIONS$IMPROVE$DESCRIPTION)}
        </p>
      </header>

      {/* Above the rotation: it changes what the next cycle does, so it
          belongs before what the next cycle will take. */}
      <ImproveStaleCodeNotice
        automationId={automationId}
        isCurrent={rotation.data.preset_code_is_current}
      />

      <ImproveRotationStrip
        repositories={rotation.data.repositories}
        nextIndex={rotation.data.next_index}
        lastVerdicts={lastVerdictByRepository(cycleList)}
      />

      {/* Keyed by the program so the form is seeded from the configuration of
          the automation it is editing, and never carries a draft across. */}
      <ImproveConfigForm
        key={automationId}
        automationId={automationId}
        config={rotation.data.config}
      />

      {cycles.isError && cycleList.length === 0 ? (
        <ErrorState onRetry={() => cycles.refetch()} />
      ) : (
        <ImproveCycleHistory
          cycles={cycleList}
          total={cycles.data?.total ?? cycleList.length}
        />
      )}
    </div>
  );
}

/** One improvement program: its rotation and its cycle history. */
export default function AutomationImprove() {
  const { automationId } = useParams();
  const {
    data: healthData,
    isLoading: isHealthLoading,
    refetch: refetchHealth,
  } = useAutomationHealth();
  const isBackendHealthy = healthData?.status === "ok";

  if (isHealthLoading) {
    return (
      <PageFrame>
        <GitSyncSkeleton />
      </PageFrame>
    );
  }

  if (!isBackendHealthy) {
    return (
      <PageFrame>
        <BackendNotConfigured onRetry={refetchHealth} />
      </PageFrame>
    );
  }

  if (!automationId) {
    return (
      <PageFrame>
        <NotFoundState />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <ImproveProgramPage automationId={automationId} />
    </PageFrame>
  );
}
