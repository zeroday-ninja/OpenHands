import { describe, expect, it } from "vitest";
import {
  buildProjectMapContextBlock,
  buildProjectMapLaunchMessage,
  buildProjectMapQuestionMessage,
  findProjectMapMentions,
} from "#/utils/project-map/project-map-context";
import {
  PROJECT_MAP_FILE_PATH,
  PROJECT_MAP_VERSION,
  type ProjectMapDocument,
  type ProjectMapNode,
} from "#/types/project-map";

function node(
  overrides: Partial<ProjectMapNode> & { id: string },
): ProjectMapNode {
  return {
    kind: "module",
    label: overrides.id,
    path: overrides.id,
    group: null,
    summary: "",
    size: 100,
    x: null,
    y: null,
    pinned: false,
    hidden: false,
    tags: [],
    ...overrides,
  };
}

const route = node({
  id: "src/routes/home.tsx",
  kind: "route",
  label: "home",
  path: "src/routes/home.tsx",
});
const external = node({
  id: "ext:posthog",
  kind: "external",
  label: "PostHog",
  path: null,
});

describe("buildProjectMapContextBlock", () => {
  it("names each selected node's kind, label and path so the subject is unambiguous", () => {
    // Act
    const block = buildProjectMapContextBlock([route, external], {
      commit: "abc1234",
    });

    // Assert
    expect(block).toContain('- route "home" (src/routes/home.tsx)');
    expect(block).toContain('- external "PostHog" (no file)');
    expect(block).toContain("generated against abc1234");
    expect(block).toContain(PROJECT_MAP_FILE_PATH);
  });

  it("sends nothing extra when nothing is selected", () => {
    // Act / Assert
    expect(buildProjectMapContextBlock([], { commit: null })).toBe("");
  });
});

describe("buildProjectMapLaunchMessage", () => {
  it("seeds a redesign with the design skill by leading with its slash command", () => {
    // Act
    const message = buildProjectMapLaunchMessage("redesign", [route], {
      commit: null,
    });

    // Assert: the catalog skill loads from the first token of the message.
    expect(message.startsWith("/frontend-design ")).toBe(true);
    expect(message).toContain('- route "home" (src/routes/home.tsx)');
  });

  it("does not seed a skill for the other intents", () => {
    // Act / Assert
    for (const intent of ["ask", "change"] as const) {
      expect(
        buildProjectMapLaunchMessage(intent, [route], { commit: null }),
      ).not.toContain("/frontend-design");
    }
  });
});

describe("buildProjectMapQuestionMessage", () => {
  it("puts the user's question first and the selection under it", () => {
    // Act
    const message = buildProjectMapQuestionMessage(
      "why is this slow?",
      [route],
      {
        commit: null,
      },
    );

    // Assert
    expect(
      message.startsWith("why is this slow?\n\nSelected on the project map"),
    ).toBe(true);
  });

  it("sends only the question when nothing is selected", () => {
    // Act / Assert
    expect(
      buildProjectMapQuestionMessage("  hello  ", [], { commit: null }),
    ).toBe("hello");
  });
});

describe("findProjectMapMentions", () => {
  const document: ProjectMapDocument = {
    version: PROJECT_MAP_VERSION,
    generated_at: null,
    commit: null,
    groups: [],
    nodes: [
      route,
      node({
        id: "src/routes",
        kind: "dir",
        label: "routes",
        path: "src/routes",
      }),
    ],
    edges: [],
    notes: [],
  };

  it("links the most specific node an answer names, not its parent directory", () => {
    // Act
    const mentions = findProjectMapMentions(
      "The launcher lives in src/routes/home.tsx.",
      document,
    );

    // Assert
    expect(mentions.map((entry) => entry.id)).toEqual(["src/routes/home.tsx"]);
  });

  it("ignores a label that happens to be a common word", () => {
    // Act
    const mentions = findProjectMapMentions("take me home", document);

    // Assert
    expect(mentions).toEqual([]);
  });
});
