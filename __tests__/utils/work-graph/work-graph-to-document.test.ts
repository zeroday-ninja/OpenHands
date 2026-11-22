import { describe, expect, it } from "vitest";
import {
  conversationIdOf,
  workGraphToDerivedLayer,
} from "#/utils/work-graph/work-graph-to-document";
import type {
  MergedWorkGraph,
  MergedWorkGraphNode,
} from "#/utils/work-graph/work-graph-merge";

function node(
  overrides: Partial<MergedWorkGraphNode> & { key: string; kind: string },
): MergedWorkGraphNode {
  return {
    label: overrides.key,
    status: "done",
    startedAt: null,
    endedAt: null,
    updatedAt: "2026-10-24T08:00:00Z",
    attrs: {},
    backendKeys: ["local:host"],
    ...overrides,
  } as MergedWorkGraphNode;
}

function graph(partial: Partial<MergedWorkGraph>): MergedWorkGraph {
  return {
    nodes: [],
    edges: [],
    omissions: [],
    findings: [],
    inFlight: 0,
    generatedAt: null,
    ...partial,
  };
}

describe("workGraphToDerivedLayer", () => {
  it("puts each kind of work in its own column, in the order it happens", () => {
    // Arrange
    const merged = graph({
      nodes: [
        node({ key: "p", kind: "program" }),
        node({ key: "c", kind: "cycle" }),
        node({ key: "a", kind: "agent" }),
      ],
    });

    // Act
    const layer = workGraphToDerivedLayer(merged);

    // Assert: work has a shape — a program schedules, a cycle is claimed, an
    // agent builds — and columns are what make that readable at a glance.
    const x = new Map(layer.nodes.map((n) => [n.id, n.x]));
    expect(x.get("p")!).toBeLessThan(x.get("c")!);
    expect(x.get("c")!).toBeLessThan(x.get("a")!);
  });

  it("gives the graph a layer per kind of work, so it folds", () => {
    // Arrange: a graph with three kinds of work on it, one of them twice.
    const merged = graph({
      nodes: [
        node({ key: "p", kind: "program" }),
        node({ key: "a1", kind: "agent" }),
        node({ key: "a2", kind: "agent" }),
      ],
    });

    // Act
    const layer = workGraphToDerivedLayer(merged, {
      program: "Programmes",
      agent: "Agents at work",
    });

    // Assert: a layer per kind present, named by the caller, in the order
    // the columns are drawn; every node belongs to its own kind's layer.
    expect(layer.groups.map((group) => [group.id, group.label])).toEqual([
      ["program", "Programmes"],
      ["agent", "Agents at work"],
    ]);
    expect(layer.nodes.map((drawn) => drawn.group)).toEqual([
      "program",
      "agent",
      "agent",
    ]);
  });

  it("puts the most recent work at the top of its column", () => {
    // Arrange
    const merged = graph({
      nodes: [
        node({ key: "old", kind: "cycle", updatedAt: "2026-10-01T00:00:00Z" }),
        node({ key: "new", kind: "cycle", updatedAt: "2026-10-24T00:00:00Z" }),
      ],
    });

    // Act
    const layer = workGraphToDerivedLayer(merged);

    // Assert: what someone opened the page to see is not at the bottom.
    const y = new Map(layer.nodes.map((n) => [n.id, n.y]));
    expect(y.get("new")!).toBeLessThan(y.get("old")!);
  });

  it("leaves out a line whose end is not on the paper", () => {
    // Arrange: an edge to a node the window did not include.
    const merged = graph({
      nodes: [node({ key: "a", kind: "agent" })],
      edges: [
        { kind: "cites", from: "a", to: "source:gone", backendKeys: ["x"] },
      ],
    });

    // Act
    const layer = workGraphToDerivedLayer(merged);

    // Assert: a line drawn to nowhere is worse than no line, and the merge
    // already reports what it left out, so nothing is hidden by this.
    expect(layer.edges).toHaveLength(0);
  });

  it("finds the conversation behind an agent, and reports its absence", () => {
    // Arrange
    const withTranscript = node({
      key: "a",
      kind: "agent",
      attrs: { conversation_id: "conv-1" },
    });
    const without = node({ key: "b", kind: "agent" });

    // Act / Assert: clicking an agent is the point of drawing it, and an
    // agent with no conversation has nothing to open.
    expect(conversationIdOf(withTranscript)).toBe("conv-1");
    expect(conversationIdOf(without)).toBeNull();
  });
});
