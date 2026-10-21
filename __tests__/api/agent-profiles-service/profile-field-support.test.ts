import { describe, expect, it, vi } from "vitest";
import {
  agentProfileSupportsAcpFallback,
  agentProfileSupportsInstructions,
  agentProfileSupportsRouter,
  agentProfileSupportsSecretRefs,
  agentProfileSupportsSkills,
  agentProfileSupportsTools,
} from "#/api/agent-profiles-service/profile-field-support";

const mockBackendKind = vi.fn<() => string>(() => "local");

vi.mock("#/api/backend-registry/active-store", () => ({
  getActiveBackend: () => ({ backend: { kind: mockBackendKind() } }),
}));

describe.each([
  ["agentProfileSupportsSecretRefs", agentProfileSupportsSecretRefs],
  ["agentProfileSupportsInstructions", agentProfileSupportsInstructions],
  ["agentProfileSupportsTools", agentProfileSupportsTools],
  ["agentProfileSupportsSkills", agentProfileSupportsSkills],
  ["agentProfileSupportsRouter", agentProfileSupportsRouter],
])("%s", (_name, supports) => {
  it("is offered on a local backend", () => {
    mockBackendKind.mockReturnValue("local");
    expect(supports()).toBe(true);
  });

  it("stays off on Cloud, whose launches do not apply it yet", () => {
    mockBackendKind.mockReturnValue("cloud");
    expect(supports()).toBe(false);
  });
});

const mockCachedServerInfo = vi.fn<() => { capabilities?: string[] } | null>(
  () => null,
);

vi.mock("#/api/agent-server-compatibility", () => ({
  getCachedAgentServerInfo: () => mockCachedServerInfo(),
}));

describe("agentProfileSupportsAcpFallback", () => {
  it("is offered once the agent-server advertises runtime failover", () => {
    mockBackendKind.mockReturnValue("local");
    mockCachedServerInfo.mockReturnValue({
      capabilities: ["profile_secret_scope_v1", "acp_runtime_failover_v1"],
    });
    expect(agentProfileSupportsAcpFallback()).toBe(true);
  });

  it("stays off when the server predates the fields, so saves are not rejected", () => {
    mockBackendKind.mockReturnValue("local");
    mockCachedServerInfo.mockReturnValue({
      capabilities: ["profile_secret_scope_v1"],
    });
    expect(agentProfileSupportsAcpFallback()).toBe(false);
    mockCachedServerInfo.mockReturnValue(null);
    expect(agentProfileSupportsAcpFallback()).toBe(false);
  });

  it("stays off on Cloud", () => {
    mockBackendKind.mockReturnValue("cloud");
    mockCachedServerInfo.mockReturnValue({
      capabilities: ["acp_runtime_failover_v1"],
    });
    expect(agentProfileSupportsAcpFallback()).toBe(false);
  });
});
