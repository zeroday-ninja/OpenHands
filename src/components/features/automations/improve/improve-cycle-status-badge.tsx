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
  [ImproveCycleStatus.COMPLETED]:
    "bg-semantic-success/10 text-semantic-success",
  [ImproveCycleStatus.FAILED]: "bg-semantic-danger/10 text-danger",
};

const STATUS_LABELS: Record<ImproveCycleStatus, I18nKey> = {
  [ImproveCycleStatus.CLAIMED]: I18nKey.AUTOMATIONS$IMPROVE$STATUS_CLAIMED,
  [ImproveCycleStatus.BUILDING]: I18nKey.AUTOMATIONS$IMPROVE$STATUS_BUILDING,
  [ImproveCycleStatus.REVIEWING]: I18nKey.AUTOMATIONS$IMPROVE$STATUS_REVIEWING,
  [ImproveCycleStatus.COMPLETED]: I18nKey.AUTOMATIONS$IMPROVE$STATUS_COMPLETED,
  [ImproveCycleStatus.FAILED]: I18nKey.AUTOMATIONS$IMPROVE$STATUS_FAILED,
};

function StatusIcon({ status }: { status: ImproveCycleStatus }) {
  switch (status) {
    case ImproveCycleStatus.COMPLETED:
      return <CheckCircleIcon className="size-3.5" />;
    case ImproveCycleStatus.FAILED:
      return <XCircleIcon className="size-3.5" />;
    case ImproveCycleStatus.CLAIMED:
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
