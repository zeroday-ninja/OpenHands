/**
 * Translated names for the document's enumerations. Kinds, statuses, wire
 * labels, stages, roles and agent states are stored as stable identifiers and
 * shown through these, so the file never carries UI copy.
 */

import { I18nKey } from "#/i18n/declaration";
import type {
  WorkbenchAgentState,
  WorkbenchItemType,
  WorkbenchPartKind,
  WorkbenchPartStatus,
  WorkbenchPersona,
  WorkbenchRoleId,
  WorkbenchStage,
  WorkbenchWireLabel,
} from "#/types/workbench";

export const KIND_LABEL_KEYS: Record<WorkbenchPartKind, I18nKey> = {
  route: I18nKey.WORKBENCH$KIND_ROUTE,
  component: I18nKey.WORKBENCH$KIND_COMPONENT,
  hook: I18nKey.WORKBENCH$KIND_HOOK,
  service: I18nKey.WORKBENCH$KIND_SERVICE,
  endpoint: I18nKey.WORKBENCH$KIND_ENDPOINT,
  table: I18nKey.WORKBENCH$KIND_TABLE,
  job: I18nKey.WORKBENCH$KIND_JOB,
  module: I18nKey.WORKBENCH$KIND_MODULE,
  external: I18nKey.WORKBENCH$KIND_EXTERNAL,
};

export const STATUS_LABEL_KEYS: Record<WorkbenchPartStatus, I18nKey> = {
  planned: I18nKey.WORKBENCH$STATUS_PLANNED,
  built: I18nKey.WORKBENCH$STATUS_BUILT,
  live: I18nKey.WORKBENCH$STATUS_LIVE,
};

export const WIRE_LABEL_KEYS: Record<WorkbenchWireLabel, I18nKey> = {
  renders: I18nKey.WORKBENCH$WIRE_RENDERS,
  calls: I18nKey.WORKBENCH$WIRE_CALLS,
  reads: I18nKey.WORKBENCH$WIRE_READS,
  writes: I18nKey.WORKBENCH$WIRE_WRITES,
  imports: I18nKey.WORKBENCH$WIRE_IMPORTS,
  publishes: I18nKey.WORKBENCH$WIRE_PUBLISHES,
  planned: I18nKey.WORKBENCH$WIRE_PLANNED,
};

export const STAGE_LABEL_KEYS: Record<WorkbenchStage, I18nKey> = {
  backlog: I18nKey.WORKBENCH$STAGE_BACKLOG,
  build: I18nKey.WORKBENCH$STAGE_BUILD,
  test: I18nKey.WORKBENCH$STAGE_TEST,
  review: I18nKey.WORKBENCH$STAGE_REVIEW,
  done: I18nKey.WORKBENCH$STAGE_DONE,
};

export const STAGE_OWNER_KEYS: Record<WorkbenchStage, I18nKey> = {
  backlog: I18nKey.WORKBENCH$STAGE_BACKLOG_WHO,
  build: I18nKey.WORKBENCH$STAGE_BUILD_WHO,
  test: I18nKey.WORKBENCH$STAGE_TEST_WHO,
  review: I18nKey.WORKBENCH$STAGE_REVIEW_WHO,
  done: I18nKey.WORKBENCH$STAGE_DONE_WHO,
};

export const ROLE_LABEL_KEYS: Record<WorkbenchRoleId, I18nKey> = {
  pm: I18nKey.WORKBENCH$ROLE_PM,
  arch: I18nKey.WORKBENCH$ROLE_ARCHITECT,
  fe: I18nKey.WORKBENCH$ROLE_FRONTEND,
  be: I18nKey.WORKBENCH$ROLE_BACKEND,
  qa: I18nKey.WORKBENCH$ROLE_QA,
  rev: I18nKey.WORKBENCH$ROLE_REVIEWER,
  ops: I18nKey.WORKBENCH$ROLE_DEVOPS,
};

export const ROLE_BLURB_KEYS: Record<WorkbenchRoleId, I18nKey> = {
  pm: I18nKey.WORKBENCH$ROLE_PM_BLURB,
  arch: I18nKey.WORKBENCH$ROLE_ARCHITECT_BLURB,
  fe: I18nKey.WORKBENCH$ROLE_FRONTEND_BLURB,
  be: I18nKey.WORKBENCH$ROLE_BACKEND_BLURB,
  qa: I18nKey.WORKBENCH$ROLE_QA_BLURB,
  rev: I18nKey.WORKBENCH$ROLE_REVIEWER_BLURB,
  ops: I18nKey.WORKBENCH$ROLE_DEVOPS_BLURB,
};

export const AGENT_STATE_KEYS: Record<WorkbenchAgentState, I18nKey> = {
  running: I18nKey.WORKBENCH$AGENT_RUNNING,
  waiting: I18nKey.WORKBENCH$AGENT_WAITING,
  scheduled: I18nKey.WORKBENCH$AGENT_SCHEDULED,
  idle: I18nKey.WORKBENCH$AGENT_IDLE,
};

export const ITEM_TYPE_KEYS: Record<WorkbenchItemType, I18nKey> = {
  story: I18nKey.WORKBENCH$ITEM_STORY,
  task: I18nKey.WORKBENCH$ITEM_TASK,
  bug: I18nKey.WORKBENCH$ITEM_BUG,
};

export const PERSONA_KEYS: Record<WorkbenchPersona, I18nKey> = {
  arch: I18nKey.WORKBENCH$ROLE_ARCHITECT,
  pm: I18nKey.WORKBENCH$ROLE_PM,
};
