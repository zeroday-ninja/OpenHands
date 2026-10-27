# Workbench smoke run (mock mode)

Screenshots taken by a Playwright script against `VITE_MOCK_API=true react-router dev`
on 2026-10-27, after skipping onboarding the way the E2E suites do. The script drove
the running app and checked each step:

| Step | Result |
|---|---|
| `/workbench` lists the example projects | home rendered, project card present |
| Open "Team workspace" | 14 parts, 15 wires, 4 repo groups drawn |
| Right-click a part | context menu opened (ask, story, rename, status, move, delete) |
| Hover a part | tooltip shown |
| Click a part, press Delete | 14 → 13 parts, toast with Undo |
| Ctrl+Z | 14 parts again |
| Drag the "external" group by its title bar | group moved 59 px right, 79 px down |
| Collapse both drawers | icon rails rendered (team, scheduled, library, repos; talk-to on the right) |
| Switch to Work | board with 7 cards in the active sprint |
| Drag story ROLE-9 to Building | card moved lanes |
| Sprint 13 → Plan | 6 stories, "0 of 20 points done" |
| Click a part in Design | chat focus chips show the selection |
| Wait 2 s | toolbar shows "Saved" (autosave through the mock upload route) |

Only failed request: the PostHog config script, blocked by the sandbox network.
These files are evidence for the PR only and are removed by hand before merge.
