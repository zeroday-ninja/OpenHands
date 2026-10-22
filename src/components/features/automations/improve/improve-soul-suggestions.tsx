import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, UserPen } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { MAX_SOUL_LENGTH } from "#/api/soul-service/soul.types";
import type { ImproveSoulSuggestion } from "#/types/improve";
import { BrandButton } from "#/components/features/settings/brand-button";
import { useSaveSoul } from "#/hooks/mutation/use-save-soul";
import { useSoul } from "#/hooks/query/use-soul";
import { getApiErrorMessage } from "#/utils/api-error-message";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";
import {
  appendLearnedPreference,
  soulStatesLearnedPreference,
} from "#/utils/soul-learned-preferences";

/**
 * What a cycle proposes about the **user**, next to the sections that are
 * about the repository.
 *
 * This is the half of a program that learns from working for someone: a cycle
 * may notice a preference the user's SOUL.md does not state, and says so. It
 * is never applied on its own — a run has no way to edit SOUL.md — so each
 * entry is a proposal the user adds or ignores here.
 *
 * Nothing is rendered when a cycle proposed nothing, which is the normal
 * outcome: unlike cited sources, an absent proposal is not a gap in evidence,
 * and announcing it on every card would bury the cycles that did propose.
 */
export function ImproveSoulSuggestions({
  suggestions,
}: {
  suggestions: ImproveSoulSuggestion[];
}) {
  const { t } = useTranslation("openhands");
  const { data: soul, isError, unsupportedReason } = useSoul();
  const save = useSaveSoul();
  // The text being written, so the button can report which proposal is in
  // flight. The ref is the actual guard: two clicks in one tick share a
  // render and would both read the state as idle, and two appends built on
  // the same base content would silently drop one of them.
  const [savingText, setSavingText] = useState<string | null>(null);
  const isSavingRef = useRef(false);

  if (suggestions.length === 0) return null;

  // A Cloud backend has no per-user SOUL.md and an agent server older than
  // `/api/soul` cannot serve one; a read that failed outright leaves us
  // without the document an append needs. All three read the same way to the
  // user: the proposals are here to read, but not to accept from here.
  const canAdd = unsupportedReason === null && !isError;

  const add = (suggestion: ImproveSoulSuggestion) => {
    if (!soul || isSavingRef.current) return;

    const next = appendLearnedPreference(soul.content, suggestion.text);
    if (next.length > MAX_SOUL_LENGTH) {
      displayErrorToast(
        t(I18nKey.SETTINGS$SOUL_TOO_LONG, {
          excess: next.length - MAX_SOUL_LENGTH,
          max: MAX_SOUL_LENGTH,
        }),
      );
      return;
    }

    isSavingRef.current = true;
    setSavingText(suggestion.text);
    save.mutate(next, {
      onSuccess: () => {
        displaySuccessToast(
          t(I18nKey.AUTOMATIONS$IMPROVE$SOUL_SUGGESTION_ADDED_TOAST),
        );
      },
      onError: (error) => {
        displayErrorToast(
          getApiErrorMessage(error, t(I18nKey.SETTINGS$SOUL_SAVE_ERROR)),
        );
      },
      onSettled: () => {
        isSavingRef.current = false;
        setSavingText(null);
      },
    });
  };

  return (
    <div
      data-testid="improve-cycle-soul-suggestions"
      className="flex flex-col gap-1.5 rounded-xl border border-dashed border-border bg-surface-raised px-3 py-2.5"
    >
      <h5 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
        <UserPen className="size-3.5 shrink-0" aria-hidden />
        {t(I18nKey.AUTOMATIONS$IMPROVE$SOUL_SUGGESTIONS_TITLE)}
      </h5>
      {/* Said in words, not only by the heading: every other section on this
          card is about the repository, and a reader who carries that reading
          over would take a preference of their own for a project finding. */}
      <p className="text-xs text-muted">
        {t(I18nKey.AUTOMATIONS$IMPROVE$SOUL_SUGGESTIONS_DESCRIPTION)}
      </p>
      {!canAdd ? (
        <p
          data-testid="improve-soul-suggestions-read-only"
          className="text-xs text-muted"
        >
          {t(I18nKey.AUTOMATIONS$IMPROVE$SOUL_SUGGESTIONS_READ_ONLY)}
        </p>
      ) : null}

      <ul className="mt-0.5 flex flex-col gap-2">
        {suggestions.map((suggestion, index) => {
          const isAdded =
            !!soul &&
            soulStatesLearnedPreference(soul.content, suggestion.text);

          return (
            <li
              // Proposals are an ordered JSON list on the cycle with no id of
              // their own, and both stages can propose the same text.
              key={`${suggestion.text}-${index}`}
              data-testid="improve-soul-suggestion"
              className="flex flex-wrap items-start justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <p
                  data-testid="improve-soul-suggestion-text"
                  className="text-xs text-content"
                >
                  {suggestion.text}
                </p>
                {suggestion.why ? (
                  <p
                    data-testid="improve-soul-suggestion-why"
                    className="mt-0.5 text-xs text-muted"
                  >
                    {suggestion.why}
                  </p>
                ) : null}
              </div>

              {isAdded ? (
                <span
                  data-testid="improve-soul-suggestion-added"
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-feedback-success"
                >
                  <Check className="size-3 shrink-0" aria-hidden />
                  {t(I18nKey.AUTOMATIONS$IMPROVE$SOUL_SUGGESTION_ALREADY_ADDED)}
                </span>
              ) : null}

              {canAdd && !isAdded ? (
                <BrandButton
                  testId="improve-soul-suggestion-add"
                  type="button"
                  variant="secondary"
                  // Disabled while the document is still loading and while any
                  // proposal is being written.
                  isDisabled={!soul || savingText !== null}
                  aria-busy={savingText === suggestion.text}
                  onClick={() => add(suggestion)}
                  className="shrink-0 !h-7 !min-h-7 !px-2.5 !text-xs"
                >
                  {t(I18nKey.AUTOMATIONS$IMPROVE$SOUL_SUGGESTION_ADD)}
                </BrandButton>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
