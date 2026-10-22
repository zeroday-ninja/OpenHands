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
 * way to describe it and the wrong way to find it: the conversation this
 * message starts runs in a subdirectory of the directory the page reads, so a
 * map written relative to the agent's own working directory is a map the page
 * will never open. Naming the absolute path is what closes that loop.
 */
export function buildProjectMapAnalysisPrompt(mapPath: string): string {
  return [
    PROJECT_MAP_ANALYSIS_PROMPT.trimEnd(),
    "",
    `Write the map to ${mapPath}, and read any existing one from there. That absolute path is the file the user has open; your working directory may be somewhere else.`,
    "",
  ].join("\n");
}
