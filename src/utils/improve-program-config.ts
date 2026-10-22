/**
 * The editable shape of an improvement program's configuration.
 *
 * The service takes a whole `ImproveProgramConfig` on every change, and its
 * fields constrain each other. Two of those constraints cannot be expressed by
 * a flat form at all:
 *
 * - an empty `reviewer_profile_ids` does not mean "nobody reviews", it means
 *   "every runtime except that turn's builder reviews"; and
 * - `rotate_builder` cannot be combined with named reviewers, because on the
 *   turn a named reviewer builds it would be reviewing its own work.
 *
 * So the form state carries the *choice* (`reviewerMode`, `repositorySource`)
 * and {@link improveConfigFromForm} derives the fields from it. A combination
 * the service refuses is therefore not reachable from the form rather than
 * being caught after a round trip.
 *
 * The service stays the authority: these checks exist so the common mistakes
 * are named next to the field that caused them instead of arriving as a 422,
 * and a save it still rejects surfaces its own message.
 */

import { I18nKey } from "#/i18n/declaration";
import type {
  ImproveExplicitRepository,
  ImproveProgramConfig,
  ImproveRepositorySource,
} from "#/types/improve";

/** What a run can clone, exactly as the service's `RepoSource` accepts it. */
export const CLONEABLE_URL_PREFIXES = ["https://", "git@", "file://"] as const;

export const MAX_IMPROVE_REVIEWERS = 4;
export const MAX_IMPROVE_BUILDERS = 4;
export const MAX_IMPROVE_REPOSITORIES = 50;
export const MIN_IMPROVE_CHANGED_FILES = 1;
export const MAX_IMPROVE_CHANGED_FILES = 500;

/**
 * Who reviews a cycle.
 *
 * `automatic` is the configuration most programs want and the one the service
 * stores as an empty reviewer list, so the form offers it as a choice in its
 * own words rather than as an empty multi-select that reads as "nobody".
 */
export type ImproveReviewerMode = "automatic" | "chosen";

/** One row of the explicit repository list while it is being edited. */
export interface ImproveRepositoryRow {
  label: string;
  url: string;
  ref: string;
}

export interface ImproveConfigFormState {
  builderProfileId: string;
  /** Profiles that take turns building after the builder, in order. */
  rotateProfileIds: string[];
  reviewerMode: ImproveReviewerMode;
  reviewerProfileIds: string[];
  repositorySource: ImproveRepositorySource;
  repositories: ImproveRepositoryRow[];
  /** Git Sync labels the rotation is limited to; empty means all of them. */
  repositoryLabels: string[];
  branchPrefix: string;
  /** Kept as text so a half-typed or emptied number can be reported. */
  maxChangedFiles: string;
  openPr: boolean;
  focus: string;
}

/** The stored configuration as the form edits it. */
export function improveConfigFormState(
  config: ImproveProgramConfig,
): ImproveConfigFormState {
  return {
    builderProfileId: config.builder_profile_id,
    rotateProfileIds: [...config.rotate_builder],
    // An empty stored reviewer list is the automatic mode, not an empty
    // selection: that is the whole point of the field.
    reviewerMode:
      config.reviewer_profile_ids.length > 0 ? "chosen" : "automatic",
    reviewerProfileIds: [...config.reviewer_profile_ids],
    repositorySource: config.repository_source,
    repositories: config.repositories.map((repository) => ({
      label: repository.label,
      url: repository.url,
      ref: repository.ref ?? "",
    })),
    repositoryLabels: [...config.repository_labels],
    branchPrefix: config.branch_prefix,
    maxChangedFiles: String(config.max_changed_files),
    openPr: config.open_pr,
    focus: config.focus ?? "",
  };
}

/** Why this URL is not something a cycle could clone, or `null`. */
export function improveRepositoryUrlError(url: string): I18nKey | null {
  const trimmed = url.trim();
  if (
    trimmed === "" ||
    !CLONEABLE_URL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
  ) {
    // `http://` is refused rather than silently upgraded, and `git://` and
    // `ssh://` are not cloneable by a run at all.
    return I18nKey.AUTOMATIONS$IMPROVE$CONFIG_REPOSITORY_URL_INVALID;
  }
  return null;
}

// What git forbids in a ref, plus the space it cannot carry either.
const BRANCH_PREFIX_FORBIDDEN = new Set([
  " ",
  "~",
  "^",
  ":",
  "?",
  "*",
  "[",
  "\\",
  "\u007f",
]);

/** Why this prefix could not start a branch name, or `null`. */
export function improveBranchPrefixError(prefix: string): I18nKey | null {
  const invalid =
    prefix === "" ||
    prefix.trim() !== prefix ||
    prefix.startsWith("/") ||
    prefix.includes("..") ||
    [...prefix].some(
      (character) =>
        BRANCH_PREFIX_FORBIDDEN.has(character) ||
        (character.codePointAt(0) ?? 0) < 0x20,
    );
  return invalid
    ? I18nKey.AUTOMATIONS$IMPROVE$CONFIG_BRANCH_PREFIX_INVALID
    : null;
}

export interface ImproveConfigFormErrors {
  builder?: I18nKey;
  reviewers?: I18nKey;
  repositories?: I18nKey;
  /** Per-row problems of the explicit list, keyed by row index. */
  repositoryRows: Map<number, { label?: I18nKey; url?: I18nKey }>;
  branchPrefix?: I18nKey;
  maxChangedFiles?: I18nKey;
}

/** Everything about this form state the service would refuse. */
export function improveConfigFormErrors(
  state: ImproveConfigFormState,
): ImproveConfigFormErrors {
  const errors: ImproveConfigFormErrors = { repositoryRows: new Map() };

  if (state.builderProfileId.trim() === "") {
    errors.builder = I18nKey.AUTOMATIONS$IMPROVE$CONFIG_BUILDER_REQUIRED;
  }

  // Only the chosen mode can be empty by mistake; the automatic one is empty
  // on purpose.
  if (
    state.reviewerMode === "chosen" &&
    state.reviewerProfileIds.length === 0
  ) {
    errors.reviewers = I18nKey.AUTOMATIONS$IMPROVE$CONFIG_REVIEWERS_REQUIRED;
  }

  if (state.repositorySource === "explicit") {
    if (state.repositories.length === 0) {
      errors.repositories =
        I18nKey.AUTOMATIONS$IMPROVE$CONFIG_REPOSITORIES_REQUIRED;
    }
    state.repositories.forEach((repository, index) => {
      const row: { label?: I18nKey; url?: I18nKey } = {};
      if (repository.label.trim() === "") {
        row.label =
          I18nKey.AUTOMATIONS$IMPROVE$CONFIG_REPOSITORY_LABEL_REQUIRED;
      }
      const urlError = improveRepositoryUrlError(repository.url);
      if (urlError) row.url = urlError;
      if (row.label || row.url) errors.repositoryRows.set(index, row);
    });
  }

  const branchPrefixError = improveBranchPrefixError(state.branchPrefix);
  if (branchPrefixError) errors.branchPrefix = branchPrefixError;

  const maxChangedFiles = Number(state.maxChangedFiles.trim());
  if (
    state.maxChangedFiles.trim() === "" ||
    !Number.isInteger(maxChangedFiles) ||
    maxChangedFiles < MIN_IMPROVE_CHANGED_FILES ||
    maxChangedFiles > MAX_IMPROVE_CHANGED_FILES
  ) {
    errors.maxChangedFiles =
      I18nKey.AUTOMATIONS$IMPROVE$CONFIG_MAX_FILES_INVALID;
  }

  return errors;
}

export function hasImproveConfigFormErrors(
  errors: ImproveConfigFormErrors,
): boolean {
  return (
    errors.builder !== undefined ||
    errors.reviewers !== undefined ||
    errors.repositories !== undefined ||
    errors.repositoryRows.size > 0 ||
    errors.branchPrefix !== undefined ||
    errors.maxChangedFiles !== undefined
  );
}

/**
 * The configuration this form state means.
 *
 * The two mutually exclusive pairs are resolved here rather than trusted from
 * state: the fields the current choice does not use are sent empty, so no
 * leftover selection from a mode the user switched away from can reach the
 * service and be rejected.
 */
export function improveConfigFromForm(
  state: ImproveConfigFormState,
): ImproveProgramConfig {
  const isExplicit = state.repositorySource === "explicit";
  const repositories: ImproveExplicitRepository[] = isExplicit
    ? state.repositories.map((repository) => ({
        label: repository.label.trim(),
        url: repository.url.trim(),
        ref: repository.ref.trim() || null,
      }))
    : [];

  return {
    builder_profile_id: state.builderProfileId,
    rotate_builder:
      state.reviewerMode === "automatic" ? [...state.rotateProfileIds] : [],
    reviewer_profile_ids:
      state.reviewerMode === "chosen" ? [...state.reviewerProfileIds] : [],
    repository_source: state.repositorySource,
    repositories,
    repository_labels: isExplicit ? [] : [...state.repositoryLabels],
    branch_prefix: state.branchPrefix,
    max_changed_files: Number(state.maxChangedFiles.trim()),
    open_pr: state.openPr,
    focus: state.focus.trim() || null,
  };
}
