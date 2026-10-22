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
