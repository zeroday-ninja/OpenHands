import { useTranslation } from "react-i18next";
import {
  useChatInputModelState,
  type ChatInputModelState,
} from "#/hooks/use-chat-input-model-state";
import { useSwitchAcpModel } from "#/hooks/mutation/use-switch-acp-model";
import { ComboboxCaretInline } from "#/ui/combobox-caret";
import SettingsGearIcon from "#/icons/settings-gear.svg?react";
import CheckIcon from "#/icons/checkmark.svg?react";
import { useClickOutsideElement } from "#/hooks/use-click-outside-element";
import { NavigationLink } from "#/components/shared/navigation-link";
import { ContextMenu } from "#/ui/context-menu";
import { ContextMenuListItem } from "#/components/features/context-menu/context-menu-list-item";
import { Divider } from "#/ui/divider";
import { Typography } from "#/ui/typography";
import { I18nKey } from "#/i18n/declaration";
import {
  acpEffortLabel,
  composeAcpModelEffort,
} from "#/utils/acp-model-effort";
import { cn } from "#/utils/utils";
import { getLockedCloudHost } from "#/api/agent-server-config";
import { chatInputPillButtonClassName } from "#/utils/form-control-classes";
import React from "react";

const MODEL_LABEL_MAX_CHARS = 10;
// ACP surfaces show the provider's human label (e.g. "Claude Opus 4.7"),
// which is longer than a raw model id, so the inline button gets a wider cap
// before truncating. The full string still shows in the title + popover.
const ACP_MODEL_LABEL_MAX_CHARS = 22;

function truncateModelLabel(
  model: string,
  maxChars: number = MODEL_LABEL_MAX_CHARS,
): string {
  if (model.length <= maxChars) {
    return model;
  }
  return `${model.slice(0, maxChars)}…`;
}

/**
 * A section label in the picker. role="presentation" keeps it a valid <li>
 * child of the ContextMenu <ul> without exposing it as a selectable menu item
 * (the label text is still announced).
 */
function MenuSectionLabel({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <li role="presentation" className={cn("px-2 pb-0.5", className)}>
      <Typography.Text className="text-[11px] font-medium text-text-dim uppercase tracking-wide leading-4">
        {children}
      </Typography.Text>
    </li>
  );
}

function PickerRow({
  testId,
  label,
  isSelected,
  onSelect,
}: {
  testId: string;
  label: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <ContextMenuListItem
      testId={testId}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect();
      }}
      className={cn(
        "flex items-center gap-2",
        isSelected && "bg-interactive-hover",
      )}
    >
      <span className="flex-1 truncate text-sm leading-5" title={label}>
        {label}
      </span>
      {isSelected && (
        <CheckIcon width={14} height={14} className="shrink-0" aria-hidden />
      )}
    </ContextMenuListItem>
  );
}

interface ChatInputModelMenuContentProps {
  model: ChatInputModelState;
  onClose: () => void;
  dividerInset?: "menu";
  settingsLinkClassName?: string;
  settingsIconClassName?: string;
}

export function ChatInputModelMenuContent({
  model,
  onClose,
  dividerInset,
  settingsLinkClassName,
  settingsIconClassName,
}: ChatInputModelMenuContentProps) {
  const { t } = useTranslation("openhands");
  const switchAcpModel = useSwitchAcpModel();
  const hasModelRows = model.showAcpPicker || Boolean(model.displayModel);
  // Locked-to-Cloud blocks the Canvas settings pages this links to (OHE-3457).
  const showSettingsLink = getLockedCloudHost() === null;

  const switchTo = (value: string | null) => {
    if (value !== model.selectedValue) {
      switchAcpModel.mutate({
        conversationId: model.switchConversationId,
        model: value,
      });
    }
    onClose();
  };

  const handleSelectAcpModel = (option: {
    id: string | null;
    efforts?: string[];
  }) => {
    // Keep the chosen effort when the new model offers it.
    const keepEffort =
      !!model.selectedEffort &&
      !!option.efforts?.includes(model.selectedEffort);
    switchTo(
      option.id &&
        composeAcpModelEffort(
          option.id,
          keepEffort ? model.selectedEffort : null,
        ),
    );
  };

  const handleSelectEffort = (effort: string | null) => {
    if (model.effortModelId) {
      switchTo(composeAcpModelEffort(model.effortModelId, effort));
    }
  };

  return (
    <>
      {model.showAcpPicker ? (
        <>
          <MenuSectionLabel className="pt-1">
            {t(I18nKey.MODEL$AVAILABLE_MODELS)}
          </MenuSectionLabel>
          {[
            ...(model.agentDefaultLabel
              ? [{ id: null, label: model.agentDefaultLabel }]
              : []),
            ...model.availableAcpModels,
          ].map((option) => (
            <PickerRow
              key={option.id ?? ""}
              testId={`chat-input-acp-model-option-${option.id ?? "agent-default"}`}
              label={option.label}
              isSelected={option.id === model.selectedModelId}
              onSelect={() => handleSelectAcpModel(option)}
            />
          ))}
          {model.availableEfforts.length > 0 && model.effortModelId && (
            <>
              <MenuSectionLabel className="pt-2">
                {t(I18nKey.MODEL$EFFORT)}
              </MenuSectionLabel>
              {[
                {
                  effort: null,
                  label: t(I18nKey.SETTINGS$AGENT_MODEL_AGENT_DEFAULT),
                },
                ...model.availableEfforts.map((effort) => ({
                  effort,
                  label: acpEffortLabel(effort),
                })),
              ].map(({ effort, label }) => (
                <PickerRow
                  key={effort ?? ""}
                  testId={`chat-input-acp-effort-option-${effort ?? "agent-default"}`}
                  label={label}
                  isSelected={effort === model.selectedEffort}
                  onSelect={() => handleSelectEffort(effort)}
                />
              ))}
            </>
          )}
        </>
      ) : model.displayModel ? (
        <li className="text-sm">
          <div className="p-2 leading-5 text-foreground break-all">
            {model.displayModel}
          </div>
        </li>
      ) : null}
      {showSettingsLink && hasModelRows && <Divider inset={dividerInset} />}
      {showSettingsLink && (
        <li className="text-sm">
          <NavigationLink
            to={model.destinationPath}
            onClick={onClose}
            className={cn(
              "flex h-7.5 items-center gap-2 rounded p-2 leading-5 text-foreground hover:bg-interactive-hover transition-colors",
              settingsLinkClassName,
            )}
          >
            <SettingsGearIcon
              width={16}
              height={16}
              className={cn("shrink-0", settingsIconClassName)}
              aria-hidden
            />
            <span>{model.destinationLabel}</span>
          </NavigationLink>
        </li>
      )}
    </>
  );
}

export function ChatInputModel() {
  const model = useChatInputModelState();
  const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = useClickOutsideElement<HTMLUListElement>(
    () => setIsPopoverOpen(false),
    triggerRef,
  );

  if (!model.displayModel) {
    return null;
  }

  const truncatedModelLabel = truncateModelLabel(
    model.displayModel,
    model.isAcpContext ? ACP_MODEL_LABEL_MAX_CHARS : MODEL_LABEL_MAX_CHARS,
  );

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        className={chatInputPillButtonClassName}
        title={model.displayModel}
        data-testid="chat-input-llm-model"
        aria-expanded={isPopoverOpen}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsPopoverOpen((open) => !open);
        }}
      >
        <span>{truncatedModelLabel}</span>
        <ComboboxCaretInline isOpen={isPopoverOpen} />
      </button>

      {isPopoverOpen && (
        <ContextMenu
          ref={popoverRef}
          testId="chat-input-llm-model-popover"
          position="top"
          alignment="left"
          spacing="none"
          className="z-[60] mb-2 min-w-50 max-w-80 max-h-[60vh] overflow-y-auto"
        >
          <ChatInputModelMenuContent
            model={model}
            onClose={() => setIsPopoverOpen(false)}
          />
        </ContextMenu>
      )}
    </div>
  );
}
