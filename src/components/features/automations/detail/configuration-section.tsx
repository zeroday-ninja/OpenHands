import { useState } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { Automation } from "#/types/automation";
import CogIcon from "#/icons/cog.svg?react";
import GitBranchIcon from "#/icons/git-branch.svg?react";
import CheckCircleIcon from "#/icons/check-circle.svg?react";
import CalendarIcon from "#/icons/calendar.svg?react";
import SparkleIcon from "#/icons/sparkle.svg?react";
import UserIcon from "#/icons/user.svg?react";
import { Zap } from "lucide-react";
import BellIcon from "#/icons/bell.svg?react";
import CodeTagIcon from "#/icons/code-tag.svg?react";
import LinkExternalIcon from "#/icons/link-external.svg?react";
import { formatEventOn } from "#/utils/automation-schedule";
import type { AutomationAgentDisplay } from "#/utils/automation-agent";
import { parseGitRemoteUrl } from "#/utils/parse-git-remote-url";
import { SectionCard } from "./section-card";
import { ConfigField } from "./config-field";
import { BranchBadge } from "./branch-badge";

interface ConfigurationSectionProps {
  automation: Automation;
  /**
   * What the automation runs as, resolved by the page (the automation itself
   * only carries an agent-profile id). Omitted, the section falls back to the
   * automation's own pinned LLM profile.
   */
  agent?: AutomationAgentDisplay;
  /**
   * Identity the automation runs as — the creator's email, or their raw user
   * id when the email could not be resolved. Omitted/null hides the field
   * (local backends, or while the lookup is still in flight).
   */
  runsAs?: string | null;
}

const FILTER_TRUNCATE_LENGTH = 60;

function FilterExpression({ filter }: { filter: string }) {
  const { t } = useTranslation("openhands");
  const [expanded, setExpanded] = useState(false);
  const isLong = filter.length > FILTER_TRUNCATE_LENGTH;

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono break-all">
        {isLong && !expanded
          ? `${filter.slice(0, FILTER_TRUNCATE_LENGTH)}…`
          : filter}
      </span>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="text-xs text-muted hover:text-content self-start"
        >
          {expanded
            ? t(I18nKey.SETTINGS$SKILLS_SHOW_LESS)
            : t(I18nKey.SETTINGS$SKILLS_SHOW_MORE)}
        </button>
      )}
    </div>
  );
}

/**
 * What the automation runs as.
 *
 * An automation on an agent profile has no `model`, so the field names the
 * profile and the runtime behind it instead — the thing that says whether a
 * run is Claude Code, Codex or a local model. An unresolved id is named
 * rather than hidden; only an id still being resolved renders nothing.
 */
function AgentField({ agent }: { agent: AutomationAgentDisplay }) {
  const { t } = useTranslation("openhands");

  if (agent.kind === "pending") return null;

  const isProfile = agent.kind === "profile" || agent.kind === "missing";
  let value = t(I18nKey.COMMON$ACTIVE_PROFILE);
  if (agent.kind === "model") value = agent.model;
  if (agent.kind === "profile") value = agent.name;
  if (agent.kind === "missing") {
    value = t(I18nKey.AUTOMATIONS$UNAVAILABLE_AGENT_PROFILE, {
      id: agent.profileId,
    });
  }

  return (
    <ConfigField
      icon={<SparkleIcon className="size-3.5" />}
      label={
        isProfile
          ? t(I18nKey.CHAT$AGENT_PROFILE_PLACEHOLDER)
          : t(I18nKey.AUTOMATIONS$DETAIL$MODEL)
      }
    >
      <div className="flex flex-col gap-0.5">
        <span data-testid="automation-agent" className="break-all">
          {value}
        </span>
        {agent.kind === "profile" && agent.runtime && (
          <span
            data-testid="automation-agent-runtime"
            className="break-all text-xs text-muted"
          >
            {agent.runtime}
          </span>
        )}
      </div>
    </ConfigField>
  );
}

export function ConfigurationSection({
  automation,
  agent,
  runsAs,
}: ConfigurationSectionProps) {
  const { t } = useTranslation("openhands");
  const isEvent = automation.trigger.type === "event";

  let scheduleDisplay = automation.trigger.schedule ?? "";
  if (automation.trigger.schedule_human) {
    scheduleDisplay = automation.timezone
      ? `${automation.trigger.schedule_human} (${automation.timezone})`
      : automation.trigger.schedule_human;
  }

  // Without a resolved agent the automation's own pinned LLM profile is all
  // this section knows, which is what it showed before agent profiles.
  const agentDisplay: AutomationAgentDisplay =
    agent ??
    (automation.model
      ? { kind: "model", model: automation.model }
      : { kind: "none" });

  const triggerDisplay = isEvent
    ? t(I18nKey.AUTOMATIONS$DETAIL$TRIGGER_EVENT)
    : t(I18nKey.AUTOMATIONS$DETAIL$TRIGGER_SCHEDULE);

  return (
    <SectionCard
      icon={<CogIcon className="size-4" />}
      title={t(I18nKey.AUTOMATIONS$DETAIL$CONFIGURATION)}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        {automation.repositories && automation.repositories.length > 0 && (
          <ConfigField
            icon={<GitBranchIcon className="size-3.5" />}
            label={t(I18nKey.AUTOMATIONS$DETAIL$REPOSITORIES)}
          >
            <ul className="flex flex-col gap-1">
              {automation.repositories.map(({ url, ref }) => (
                <li
                  key={`${url}@${ref ?? ""}`}
                  data-testid="automation-repository"
                  className="flex flex-wrap items-center gap-1"
                >
                  <span className="break-all">
                    {parseGitRemoteUrl(url)?.repository ?? url}
                  </span>
                  {ref && <BranchBadge branch={ref} />}
                </li>
              ))}
            </ul>
          </ConfigField>
        )}

        <ConfigField
          icon={<CheckCircleIcon className="size-3.5" />}
          label={t(I18nKey.AUTOMATIONS$DETAIL$TRIGGER)}
        >
          {triggerDisplay}
        </ConfigField>

        {!isEvent && (
          <ConfigField
            icon={<CalendarIcon className="size-3.5" />}
            label={t(I18nKey.AUTOMATIONS$DETAIL$SCHEDULE)}
          >
            {scheduleDisplay}
          </ConfigField>
        )}

        {isEvent && automation.trigger.source && (
          <ConfigField
            icon={<Zap className="size-3.5" aria-hidden="true" />}
            label={t(I18nKey.AUTOMATIONS$DETAIL$EVENT_SOURCE)}
          >
            {automation.trigger.source}
          </ConfigField>
        )}

        {isEvent && automation.trigger.on && (
          <ConfigField
            icon={<LinkExternalIcon className="size-3.5" />}
            label={t(I18nKey.AUTOMATIONS$DETAIL$EVENT_TYPE)}
          >
            {formatEventOn(automation.trigger.on)}
          </ConfigField>
        )}

        {isEvent && automation.trigger.filter && (
          <ConfigField
            icon={<CodeTagIcon className="size-3.5" />}
            label={t(I18nKey.AUTOMATIONS$DETAIL$EVENT_FILTER)}
          >
            <FilterExpression filter={automation.trigger.filter} />
          </ConfigField>
        )}

        {runsAs && (
          <ConfigField
            icon={<UserIcon className="size-3.5" />}
            label={t(I18nKey.AUTOMATIONS$DETAIL$RUNS_AS)}
          >
            <span className="break-all">{runsAs}</span>
          </ConfigField>
        )}

        <AgentField agent={agentDisplay} />

        {automation.notification && (
          <ConfigField
            icon={<BellIcon className="size-3.5" />}
            label={t(I18nKey.AUTOMATIONS$DETAIL$NOTIFICATION)}
          >
            {automation.notification}
          </ConfigField>
        )}
      </div>
    </SectionCard>
  );
}
