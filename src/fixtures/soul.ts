/**
 * Stand-ins for what the agent server serves on `/api/soul`, for mock mode.
 *
 * Lives under `src/fixtures/` because MSW handlers ship in the mock build and
 * `__tests__/` is excluded from the Docker build context.
 */
export const DEFAULT_MOCK_SOUL = `# Soul

## How I work

- Read the surrounding code before changing it, and match what is already there.
- Say what I did and what I could not do; never imply a check I did not run.

## My review bar

- Every behavioral change needs a test that fails without it.
- A change I cannot explain in one sentence is too large.
`;

/**
 * The identity documents the agent server declares, in load order, with the
 * purposes it serves for them (software-agent-sdk `context/identity.py`).
 *
 * Copied rather than imported: the set and its wording belong to the agent
 * server, and mock mode has to stand in for one. A real server that declares
 * a different set is the authority, which is why the page renders whatever
 * arrives instead of this list.
 */
export const MOCK_IDENTITY_DOCUMENTS = [
  {
    name: "soul",
    relative_path: "SOUL.md",
    purpose:
      "Who you are: background, worldview, opinions by domain, interests, current focus, influences, vocabulary, tensions, boundaries.",
  },
  {
    name: "style",
    relative_path: "STYLE.md",
    purpose:
      "How you write and work: voice, words you use and never use, punctuation, rhetorical moves, anti-patterns.",
  },
  {
    name: "memory",
    relative_path: "MEMORY.md",
    purpose:
      "Continuity across sessions. Entries are appended with an id and a timestamp so two machines can merge without losing any.",
  },
  {
    name: "good-outputs",
    relative_path: "examples/good-outputs.md",
    purpose: "Work that sounds like you, for calibration.",
  },
  {
    name: "bad-outputs",
    relative_path: "examples/bad-outputs.md",
    purpose: "Work that does not, and what is wrong with it.",
  },
  {
    name: "influences",
    relative_path: "data/influences.md",
    purpose: "What shaped your thinking, and what you took from each.",
  },
] as const;
