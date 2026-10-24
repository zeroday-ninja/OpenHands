import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import CheckCircleIcon from "#/icons/check-circle.svg?react";
import XCircleIcon from "#/icons/x-circle.svg?react";
import ClockIcon from "#/icons/clock.svg?react";
import { I18nKey } from "#/i18n/declaration";
import { ImproveCycleStatus } from "#/types/improve";
import { cn } from "#/utils/utils";

const STATUS_TONES: Record<ImproveCycleStatus, string> = {
  [ImproveCycleStatus.CLAIMED]: "bg-surface-raised text-muted",
  [ImproveCycleStatus.BUILDING]: "bg-surface-raised text-muted",
  [ImproveCycleStatus.REVIEWING]: "bg-surface-raised text-muted",
  // Waiting on a person, so it reads as something to act on rather than as
  // either work in progress or a failure.
  [ImproveCycleStatus.PARKED]: "bg-warning/10 text-warning",
  [ImproveCycleStatus.COMPLETED]:
    "bg-semantic-success/10 text-semantic-success",
  [ImproveCycleStatus.FAILED]: "bg-semantic-danger/10 text-danger",
};

const STATUS_LABELS: Record<ImproveCycleStatus, I18nKey> = {
  [ImproveCycleStatus.CLAIMED]: I18nKey.AUTOMATIONS$IMPROVE$STATUS_CLAIMED,
  [ImproveCycleStatus.BUILDING]: I18nKey.AUTOMATIONS$IMPROVE$STATUS_BUILDING,
  [ImproveCycleStatus.REVIEWING]: I18nKey.AUTOMATIONS$IMPROVE$STATUS_REVIEWING,
  [ImproveCycleStatus.PARKED]: I18nKey.AUTOMATIONS$IMPROVE$STATUS_PARKED,
  [ImproveCycleStatus.COMPLETED]: I18nKey.AUTOMATIONS$IMPROVE$STATUS_COMPLETED,
  [ImproveCycleStatus.FAILED]: I18nKey.AUTOMATIONS$IMPROVE$STATUS_FAILED,
};

function StatusIcon({ status }: { status: ImproveCycleStatus }) {
  switch (status) {
    case ImproveCycleStatus.COMPLETED:
      return <CheckCircleIcon className="size-3.5" />;
    case ImproveCycleStatus.FAILED:
      return <XCircleIcon className="size-3.5" />;
    // A clock for both, not a spinner: nothing is working on a claimed or a
    // parked cycle, and a spinner would say that something is.
    case ImproveCycleStatus.CLAIMED:
    case ImproveCycleStatus.PARKED:
      return <ClockIcon className="size-3.5" />;
    default:
      return (
        <Loader2
          className="size-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
      );
  }
}

export function ImproveCycleStatusBadge({
  status,
}: {
  status: ImproveCycleStatus;
}) {
  const { t } = useTranslation("openhands");
  const tone = STATUS_TONES[status] ?? "bg-surface-raised text-muted";
  const label = STATUS_LABELS[status];

  return (
    <span
      data-testid="improve-cycle-status-badge"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full pl-2 pr-2.5 py-1 text-xs font-medium",
        tone,
      )}
    >
      <StatusIcon status={status} />
      {label ? t(label) : status}
    </span>
  );
}
