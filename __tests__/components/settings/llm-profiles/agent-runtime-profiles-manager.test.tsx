import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "test-utils";
import AgentProfilesService, {
  type AgentProfileSummary,
  type StoredAcpProfile,
} from "#/api/agent-profiles-service/agent-profiles-service.api";
import { AgentRuntimeProfilesManager } from "#/components/features/settings/llm-profiles/agent-runtime-profiles-manager";

vi.mock(
  "#/api/agent-profiles-service/agent-profiles-service.api",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("#/api/agent-profiles-service/agent-profiles-service.api")
      >();
    return {
      ...actual,
      default: {
        listProfiles: vi.fn(),
        getProfile: vi.fn(),
        saveProfile: vi.fn(),
        deleteProfile: vi.fn(),
        activateProfile: vi.fn(),
      },
    };
  },
);
vi.mock("#/utils/custom-toast-handlers");
vi.mock("#/contexts/active-backend-context", () => ({
  useActiveBackend: () => ({
    backend: { id: "backend-1", kind: "local" },
    orgId: null,
  }),
}));

const openHandsSummary: AgentProfileSummary = {
  id: "id-openhands",
  name: "gpt-via-api-key",
  agent_kind: "openhands",
  revision: 1,
  llm_profile_ref: "gpt-5.5",
  mcp_server_refs: null,
};

const codexSummary: AgentProfileSummary = {
  id: "id-codex",
  name: "codex-high",
  agent_kind: "acp",
  revision: 1,
  llm_profile_ref: null,
  mcp_server_refs: null,
};

const storedCodex = {
  schema_version: 1,
  id: "id-codex",
  name: "codex-high",
  revision: 1,
  agent_kind: "acp",
  acp_server: "codex",
  acp_model: "gpt-5.5-codex/high",
  acp_session_mode: null,
  acp_prompt_timeout: 1800,
  acp_command: null,
  acp_args: null,
  mcp_server_refs: null,
} as unknown as StoredAcpProfile;

beforeEach(() => {
  vi.mocked(AgentProfilesService.listProfiles).mockResolvedValue({
    profiles: [openHandsSummary, codexSummary],
    active_agent_profile_id: "id-openhands",
  });
  vi.mocked(AgentProfilesService.getProfile).mockResolvedValue({
    name: "codex-high",
    profile: storedCodex,
  });
});

describe("AgentRuntimeProfilesManager", () => {
  it("names the runtime and the model a runtime profile runs", async () => {
    // Arrange / Act
    renderWithProviders(<AgentRuntimeProfilesManager />);

    // Assert: `GET /api/agent-profiles` summarises a profile without its
    // runtime or model, so both come from the profile's own record.
    const row = await screen.findByTestId("agent-runtime-profile-row");
    expect(
      within(row).getByTestId("agent-runtime-profile-runtime"),
    ).toHaveTextContent("Codex");
    expect(
      within(row).getByTestId("agent-runtime-profile-model"),
    ).toHaveTextContent("gpt-5.5-codex · High");
    expect(AgentProfilesService.getProfile).toHaveBeenCalledWith("codex-high");
  });

  it("marks a runtime profile so it does not read as an API-key model", async () => {
    // Arrange / Act
    renderWithProviders(<AgentRuntimeProfilesManager />);

    // Assert
    const row = await screen.findByTestId("agent-runtime-profile-row");
    expect(
      within(row).getByTestId("agent-runtime-profile-badge"),
    ).toBeInTheDocument();
  });

  it("lists only runtime-backed profiles, never the API-key ones", async () => {
    // Arrange / Act
    renderWithProviders(<AgentRuntimeProfilesManager />);

    // Assert: an OpenHands profile resolves an LLM profile and belongs to the
    // list above, so it must not be duplicated into this one.
    await screen.findByTestId("agent-runtime-profile-row");
    expect(screen.getAllByTestId("agent-runtime-profile-row")).toHaveLength(1);
    expect(screen.queryByText(openHandsSummary.name)).toBeNull();
  });

  it("says what a runtime profile is for when there are none", async () => {
    // Arrange
    vi.mocked(AgentProfilesService.listProfiles).mockResolvedValue({
      profiles: [openHandsSummary],
      active_agent_profile_id: "id-openhands",
    });

    // Act
    renderWithProviders(<AgentRuntimeProfilesManager />);

    // Assert
    expect(
      await screen.findByTestId("agent-runtime-profiles-empty"),
    ).toBeInTheDocument();
  });

  it("names the runtime's own choice when a profile pins no model", async () => {
    // Arrange: `acp_model: null` lets the runtime pick, which is a real
    // setting rather than a missing one.
    vi.mocked(AgentProfilesService.getProfile).mockResolvedValue({
      name: "codex-high",
      profile: { ...storedCodex, acp_model: null } as StoredAcpProfile,
    });

    // Act
    renderWithProviders(<AgentRuntimeProfilesManager />);

    // Assert
    const model = await screen.findByTestId("agent-runtime-profile-model");
    expect(model).toHaveTextContent(
      "SETTINGS$RUNTIME_PROFILE_RUNTIME_DEFAULT_MODEL",
    );
  });
});
