/**
 * The instructions sent when the user asks for the map to be generated or
 * regenerated.
 *
 * The prompt is a Markdown file in the repository rather than a template
 * literal, so what the agent is told stays reviewable in a diff next to the
 * code that sends it — the same reason the selection block is shown to the
 * user verbatim. Edit `project-map-analysis.md`, not a string here.
 */

import analysisPrompt from "#/prompts/project-map-analysis.md?raw";

export const PROJECT_MAP_ANALYSIS_PROMPT: string = analysisPrompt;

/**
 * The analysis instructions, told where to put the result.
 *
 * The prompt names the map by its repository-relative path, which is the right
 * way to describe it and — when the page and the agent are looking at
 * different directories — the wrong way to find it. So the caller passes the
 * absolute path of the file the page has open, and the agent is told to use
 * that instead of its own working directory.
 *
 * `null` means the opposite situation and must not be faked with a path: the
 * conversation runs in its own isolated sandbox, so the page's directory does
 * not exist there and the only file the agent can write is the one in its own
 * working directory. The page then follows the conversation rather than the
 * conversation following the page.
 */
export function buildProjectMapAnalysisPrompt(mapPath: string | null): string {
  const where =
    mapPath === null
      ? "Write the map to `.openhands/project-map.json` inside your own working directory, and read any existing one from there. The user is looking at this conversation's workspace."
      : `Write the map to ${mapPath}, and read any existing one from there. That absolute path is the file the user has open; your working directory may be somewhere else.`;
  return [PROJECT_MAP_ANALYSIS_PROMPT.trimEnd(), "", where, ""].join("\n");
}
