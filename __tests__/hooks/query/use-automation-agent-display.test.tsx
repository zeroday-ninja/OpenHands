import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AgentProfilesService from "#/api/agent-profiles-service/agent-profiles-service.api";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import { useAutomationAgentDisplay } from "#/hooks/query/use-automation-agent-display";
import type { Backend } from "#/api/backend-registry/types";
import type { Automation } from "#/types/automation";
import type { AutomationAgentDisplay } from "#/utils/automation-agent";

vi.mock(
  "#/api/agent-profiles-service/agent-profiles-service.api",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("#/api/agent-profiles-service/agent-profiles-service.api")
      >();
    return {
      ...actual,
      default: { listProfiles: vi.fn(), getProfile: vi.fn() },
    };
  },
);

const localBackend: Backend = {
  id: "local-1",
  name: "Local 1",
  host: "http://localhost:8000",
  apiKey: "session-key",
  kind: "local",
};

const ACP_PROFILE_ID = "96ace0a6-483e-4a39-91cc-ced1b8663056";
const OPENHANDS_PROFILE_ID = "2cace2b0-f0a2-44d9-918e-0987fad9442d";

const profiles = {
  profiles: [
    {
      id: ACP_PROFILE_ID,
      name: "claude-code",
      agent_kind: "acp" as const,
      revision: 9,
      llm_profile_ref: null,
      mcp_server_refs: null,
    },
    {
      id: OPENHANDS_PROFILE_ID,
      name: "default",
      agent_kind: "openhands" as const,
      revision: 3,
      llm_profile_ref: "lm-studio",
      mcp_server_refs: null,
    },
  ],
  active_agent_profile_id: ACP_PROFILE_ID,
};

const acpProfileDetail = {
  name: "claude-code",
  profile: {
    schema_version: 3,
    agent_kind: "acp" as const,
    id: ACP_PROFILE_ID,
    name: "claude-code",
    revision: 9,
    mcp_server_refs: null,
    secret_refs: null,
    acp_server: "claude-code" as const,
    acp_model: "opus",
    acp_session_mode: null,
    acp_prompt_timeout: 1800,
    acp_command: null,
    acp_args: null,
  },
};

function buildAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "automation-1",
    name: "Dashboard skills and extensions",
    prompt: null,
    trigger: { type: "cron", schedule: "0 5 1 * *" },
    enabled: true,
    created_at: "2026-10-22T13:16:39Z",
    updated_at: "2026-10-22T20:51:34Z",
    model: null,
    ...overrides,
  };
}

let seen: AutomationAgentDisplay | null = null;

function Probe({
  automation,
  withRuntime,
}: {
  automation: Automation;
  withRuntime: boolean;
}) {
  const agent = useAutomationAgentDisplay(automation, { withRuntime });
  seen = agent;
  return <span data-testid="agent-kind">{agent.kind}</span>;
}

function renderProbe(automation: Automation, withRuntime = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveBackendProvider>
        <Probe automation={automation} withRuntime={withRuntime} />
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  seen = null;
  window.localStorage.clear();
  __resetActiveStoreForTests();
  vi.mocked(AgentProfilesService.listProfiles).mockResolvedValue(profiles);
  vi.mocked(AgentProfilesService.getProfile).mockResolvedValue(
    acpProfileDetail,
  );
  setRegisteredBackends([localBackend]);
  setActiveSelection({ backendId: localBackend.id });
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  __resetActiveStoreForTests();
});

describe("useAutomationAgentDisplay", () => {
  it("resolves an agent profile to its name and ACP runtime", async () => {
    // Arrange — an automation that runs under an ACP agent profile carries no
    // model at all, so the id is the only thing naming its runtime.
    const automation = buildAutomation({ agent_profile_id: ACP_PROFILE_ID });

    // Act
    renderProbe(automation);

    // Assert
    await waitFor(() =>
      expect(seen).toEqual({
        kind: "profile",
        name: "claude-code",
        runtime: "Claude Code (opus)",
      }),
    );
  });

  it("reads an OpenHands profile's runtime from the list alone", async () => {
    // Arrange
    const automation = buildAutomation({
      agent_profile_id: OPENHANDS_PROFILE_ID,
    });

    // Act
    renderProbe(automation);

    // Assert — the LLM profile it references is already in the list payload,
    // so no per-profile detail request is made.
    await waitFor(() => expect(seen?.kind).toBe("profile"));
    expect(seen).toEqual({
      kind: "profile",
      name: "default",
      runtime: "lm-studio",
    });
    expect(AgentProfilesService.getProfile).not.toHaveBeenCalled();
  });

  it("names the profile id a list surface cannot expand", async () => {
    // Arrange — a list surface asks for no runtime, so an ACP profile costs
    // nothing beyond the one shared list request.
    const automation = buildAutomation({ agent_profile_id: ACP_PROFILE_ID });

    // Act
    renderProbe(automation, false);

    // Assert
    await waitFor(() => expect(seen?.kind).toBe("profile"));
    expect(seen).toEqual({
      kind: "profile",
      name: "claude-code",
      runtime: null,
    });
    expect(AgentProfilesService.getProfile).not.toHaveBeenCalled();
  });

  it("reports a deleted profile as unresolvable rather than silently blank", async () => {
    // Arrange
    const automation = buildAutomation({
      agent_profile_id: "deleted-profile-id",
    });

    // Act
    renderProbe(automation);

    // Assert
    await waitFor(() =>
      expect(seen).toEqual({
        kind: "missing",
        profileId: "deleted-profile-id",
      }),
    );
  });

  it("reports a backend without the profiles surface as unresolvable", async () => {
    // Arrange — an older local backend, or a cloud org without the endpoint,
    // answers the list request with an error.
    vi.mocked(AgentProfilesService.listProfiles).mockRejectedValue(
      new Error("Not Found"),
    );
    const automation = buildAutomation({ agent_profile_id: ACP_PROFILE_ID });

    // Act
    renderProbe(automation);

    // Assert
    await waitFor(() =>
      expect(seen).toEqual({ kind: "missing", profileId: ACP_PROFILE_ID }),
    );
  });

  it("keeps showing a pinned LLM profile and asks for no profiles at all", async () => {
    // Arrange
    const automation = buildAutomation({ model: "lm-studio" });

    // Act
    renderProbe(automation);

    // Assert
    expect(await screen.findByTestId("agent-kind")).toHaveTextContent("model");
    expect(seen).toEqual({ kind: "model", model: "lm-studio" });
    expect(AgentProfilesService.listProfiles).not.toHaveBeenCalled();
  });

  it("falls back to the active profile when the automation pins neither", async () => {
    // Arrange / Act
    renderProbe(buildAutomation());

    // Assert
    expect(await screen.findByTestId("agent-kind")).toHaveTextContent("none");
  });
});
