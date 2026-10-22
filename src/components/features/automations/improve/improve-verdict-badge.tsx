import { useTranslation } from "react-i18next";
import { CircleAlert, CircleHelp, CircleSlash, UserX } from "lucide-react";
import CheckCircleIcon from "#/icons/check-circle.svg?react";
import XCircleIcon from "#/icons/x-circle.svg?react";
import { I18nKey } from "#/i18n/declaration";
import { ImproveVerdict } from "#/types/improve";
import { cn } from "#/utils/utils";

/**
 * How a verdict reads at a glance.
 *
 * Only `ACCEPTED` is a pass. `SINGLE_RUNTIME` and `NO_CHANGE` are deliberately
 * not success-toned: the first says no second runtime reviewed the change, the
 * second that the cycle changed nothing. Rendering either like `ACCEPTED`
 * would tell the user a change was independently reviewed when it was not.
 */
const VERDICT_TONES: Record<ImproveVerdict, string> = {
  [ImproveVerdict.ACCEPTED]: "bg-semantic-success/10 text-semantic-success",
  [ImproveVerdict.CHANGES_REQUESTED]: "bg-warning/10 text-warning",
  [ImproveVerdict.REJECTED]: "bg-semantic-danger/10 text-danger",
  [ImproveVerdict.INCONCLUSIVE]: "bg-warning/10 text-warning",
  [ImproveVerdict.SINGLE_RUNTIME]: "bg-warning/10 text-warning",
  [ImproveVerdict.NO_CHANGE]: "bg-surface-raised text-muted",
};

const VERDICT_LABELS: Record<ImproveVerdict, I18nKey> = {
  [ImproveVerdict.ACCEPTED]: I18nKey.AUTOMATIONS$IMPROVE$VERDICT_ACCEPTED,
  [ImproveVerdict.CHANGES_REQUESTED]:
    I18nKey.AUTOMATIONS$IMPROVE$VERDICT_CHANGES_REQUESTED,
  [ImproveVerdict.REJECTED]: I18nKey.AUTOMATIONS$IMPROVE$VERDICT_REJECTED,
  [ImproveVerdict.INCONCLUSIVE]:
    I18nKey.AUTOMATIONS$IMPROVE$VERDICT_INCONCLUSIVE,
  [ImproveVerdict.SINGLE_RUNTIME]:
    I18nKey.AUTOMATIONS$IMPROVE$VERDICT_SINGLE_RUNTIME,
  [ImproveVerdict.NO_CHANGE]: I18nKey.AUTOMATIONS$IMPROVE$VERDICT_NO_CHANGE,
};

/** The sentence under a verdict that is easy to misread as a pass. */
const VERDICT_EXPLANATIONS: Partial<Record<ImproveVerdict, I18nKey>> = {
  [ImproveVerdict.SINGLE_RUNTIME]:
    I18nKey.AUTOMATIONS$IMPROVE$VERDICT_SINGLE_RUNTIME_HELP,
  [ImproveVerdict.NO_CHANGE]:
    I18nKey.AUTOMATIONS$IMPROVE$VERDICT_NO_CHANGE_HELP,
};

export function improveVerdictExplanationKey(
  verdict: ImproveVerdict,
): I18nKey | undefined {
  return VERDICT_EXPLANATIONS[verdict];
}

function VerdictIcon({ verdict }: { verdict: ImproveVerdict }) {
  switch (verdict) {
    case ImproveVerdict.ACCEPTED:
      return <CheckCircleIcon className="size-3.5" />;
    case ImproveVerdict.REJECTED:
      return <XCircleIcon className="size-3.5" />;
    case ImproveVerdict.CHANGES_REQUESTED:
      return <CircleAlert className="size-3.5" aria-hidden />;
    case ImproveVerdict.SINGLE_RUNTIME:
      return <UserX className="size-3.5" aria-hidden />;
    case ImproveVerdict.NO_CHANGE:
      return <CircleSlash className="size-3.5" aria-hidden />;
    default:
      return <CircleHelp className="size-3.5" aria-hidden />;
  }
}

interface ImproveVerdictBadgeProps {
  /** Null while a cycle has not concluded. */
  verdict: ImproveVerdict | null;
  testId?: string;
}

export function ImproveVerdictBadge({
  verdict,
  testId = "improve-verdict-badge",
}: ImproveVerdictBadgeProps) {
  const { t } = useTranslation("openhands");

  if (verdict === null) {
    return (
      <span
        data-testid={testId}
        data-verdict="PENDING"
        className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised px-2.5 py-1 text-xs font-medium text-muted"
      >
        {t(I18nKey.AUTOMATIONS$IMPROVE$VERDICT_PENDING)}
      </span>
    );
  }

  // Degrade instead of crashing on a verdict the service adds later.
  const tone = VERDICT_TONES[verdict] ?? "bg-warning/10 text-warning";
  const label = VERDICT_LABELS[verdict];

  return (
    <span
      data-testid={testId}
      data-verdict={verdict}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full pl-2 pr-2.5 py-1 text-xs font-medium",
        tone,
      )}
    >
      <VerdictIcon verdict={verdict} />
      {label ? t(label) : verdict}
    </span>
  );
}
