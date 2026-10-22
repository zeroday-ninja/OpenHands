import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ACPModelDiscovery } from "@openhands/typescript-client";
import { renderWithProviders } from "test-utils";
import AgentProfilesService, {
  type AgentProfileSummary,
  type StoredAcpProfile,
} from "#/api/agent-profiles-service/agent-profiles-service.api";
import AcpService from "#/api/acp-service/acp-service.api";
import { SecretsService } from "#/api/secrets-service";
import { AgentRuntimeProfileEditor } from "#/components/features/settings/llm-profiles/agent-runtime-profile-editor";

// The services the editor and its model discovery reach through; the hooks on
// top of them stay real so this exercises the production data path.
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
        renameProfile: vi.fn(),
        activateProfile: vi.fn(),
      },
    };
  },
);
vi.mock("#/api/acp-service/acp-service.api", () => ({
  __esModule: true,
  default: { discoverModels: vi.fn() },
}));
vi.mock("#/api/secrets-service", () => ({
  SecretsService: { getSecrets: vi.fn() },
}));
vi.mock("#/utils/custom-toast-handlers");

vi.mock("#/contexts/active-backend-context", () => ({
  useActiveBackend: () => ({
    backend: { id: "backend-1", kind: "local" },
    orgId: null,
  }),
}));

const CODEX_MODELS = {
  agent_name: "codex-acp",
  agent_version: "2.2.2",
  supports_runtime_model_switch: true,
  error: null,
  available_models: [
    { model_id: "gpt-5.5-codex", name: "GPT-5.5 Codex" },
    { model_id: "gpt-5.5", name: "GPT-5.5" },
  ],
  current_model_id: "gpt-5.5-codex",
  // Effort levels ship on agent-servers with ACP effort support, which the
  // pinned client types predate.
  efforts_by_model: { "gpt-5.5-codex": ["low", "medium", "high", "xhigh"] },
} as unknown as ACPModelDiscovery;

/**
 * A stored profile carrying values for everything the LLM-tab editor does not
 * model, so a save that resets them to server defaults is visible. The
 * failover fields ride untyped on the pinned client, hence the cast.
 */
const storedClaude = {
  schema_version: 1,
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  name: "claude",
  revision: 2,
  agent_kind: "acp",
  acp_server: "claude-code",
  acp_model: "claude-opus-5/high",
  acp_session_mode: "bypassPermissions",
  acp_prompt_timeout: 900,
  acp_startup_timeout: 120,
  acp_command: null,
  acp_args: null,
  acp_fallback_server: "codex",
  acp_fallback_model: "gpt-5.5-codex",
  mcp_server_refs: ["linear"],
  secret_refs: ["CLAUDE_CODE_OAUTH_TOKEN"],
} as unknown as StoredAcpProfile;

const claudeSummary: AgentProfileSummary = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  name: "claude",
  agent_kind: "acp",
  revision: 2,
  llm_profile_ref: null,
  mcp_server_refs: ["linear"],
};

beforeEach(() => {
  vi.mocked(SecretsService.getSecrets).mockResolvedValue([]);
  vi.mocked(AcpService.discoverModels).mockResolvedValue(CODEX_MODELS);
  vi.mocked(AgentProfilesService.listProfiles).mockResolvedValue({
    profiles: [claudeSummary],
    active_agent_profile_id: claudeSummary.id,
  });
  vi.mocked(AgentProfilesService.saveProfile).mockResolvedValue({
    name: "x",
    message: "saved",
  });
  vi.mocked(AgentProfilesService.renameProfile).mockResolvedValue({
    name: "x",
    message: "renamed",
  });
});

/** Pick `option` from the HeroUI autocomplete labelled `label`. */
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("AgentRuntimeProfileEditor", () => {
  it("saves a new runtime profile as an ACP agent profile", async () => {
    // Arrange
    const user = userEvent.setup();
    renderWithProviders(
      <AgentRuntimeProfileEditor
        stored={null}
        summary={null}
        onClose={vi.fn()}
      />,
    );

    // Act: Codex on a named model, at a named effort.
    await pick(user, "SETTINGS$RUNTIME_PROFILE_RUNTIME", "Codex");
    await pick(user, "SETTINGS$AGENT_MODEL", "GPT-5.5 Codex");
    await pick(user, "MODEL$EFFORT", "High");
    await user.click(screen.getByTestId("save-runtime-profile-btn"));

    // Assert: the agent-profile store owns it, and the model and effort travel
    // as the one combined id the agent-server reads.
    await waitFor(() =>
      expect(AgentProfilesService.saveProfile).toHaveBeenCalledWith(
        "codex-gpt-5.5-codex",
        {
          agent_kind: "acp",
          acp_server: "codex",
          acp_model: "gpt-5.5-codex/high",
        },
      ),
    );
  });

  it("opens an existing profile on its saved runtime, model and effort", async () => {
    // Arrange / Act
    renderWithProviders(
      <AgentRuntimeProfileEditor
        stored={storedClaude}
        summary={claudeSummary}
        onClose={vi.fn()}
      />,
    );

    // Assert: the combined `claude-opus-5/high` id is shown as two choices.
    expect(
      await screen.findByLabelText("SETTINGS$RUNTIME_PROFILE_RUNTIME"),
    ).toHaveValue("Claude Code");
    expect(screen.getByLabelText("SETTINGS$AGENT_MODEL")).toHaveValue(
      "claude-opus-5",
    );
    expect(screen.getByTestId("runtime-profile-name-input")).toHaveValue(
      "claude",
    );
  });

  it("keeps the fields it does not model when editing a profile", async () => {
    // Arrange
    const user = userEvent.setup();
    renderWithProviders(
      <AgentRuntimeProfileEditor
        stored={storedClaude}
        summary={claudeSummary}
        onClose={vi.fn()}
      />,
    );
    await screen.findByLabelText("SETTINGS$AGENT_MODEL");

    // Act: change only the model.
    await pick(user, "SETTINGS$AGENT_MODEL", "SETTINGS$AGENT_PRESET_CUSTOM");
    await user.type(
      screen.getByTestId("runtime-profile-model-input"),
      "claude-sonnet-5",
    );
    await user.click(screen.getByTestId("save-runtime-profile-btn"));

    // Assert
    await waitFor(() =>
      expect(AgentProfilesService.saveProfile).toHaveBeenCalled(),
    );
    const [name, payload] = vi.mocked(AgentProfilesService.saveProfile).mock
      .calls[0];
    expect(name).toBe("claude");
    expect(payload).toMatchObject({
      acp_server: "claude-code",
      acp_model: "claude-sonnet-5",
      acp_session_mode: "bypassPermissions",
      acp_prompt_timeout: 900,
      acp_startup_timeout: 120,
      acp_fallback_server: "codex",
      acp_fallback_model: "gpt-5.5-codex",
      mcp_server_refs: ["linear"],
      secret_refs: ["CLAUDE_CODE_OAUTH_TOKEN"],
    });
  });

  it("renames before saving so the profile keeps its id", async () => {
    // Arrange
    const user = userEvent.setup();
    renderWithProviders(
      <AgentRuntimeProfileEditor
        stored={storedClaude}
        summary={claudeSummary}
        onClose={vi.fn()}
      />,
    );
    const nameInput = await screen.findByTestId("runtime-profile-name-input");

    // Act
    await user.clear(nameInput);
    await user.type(nameInput, "claude-opus");
    await user.click(screen.getByTestId("save-runtime-profile-btn"));

    // Assert
    await waitFor(() =>
      expect(AgentProfilesService.renameProfile).toHaveBeenCalledWith(
        "claude",
        "claude-opus",
      ),
    );
    expect(AgentProfilesService.saveProfile).toHaveBeenCalledWith(
      "claude-opus",
      expect.anything(),
    );
  });

  it("drops the old runtime's model when the runtime changes", async () => {
    // Arrange
    const user = userEvent.setup();
    renderWithProviders(
      <AgentRuntimeProfileEditor
        stored={storedClaude}
        summary={claudeSummary}
        onClose={vi.fn()}
      />,
    );
    await screen.findByLabelText("SETTINGS$AGENT_MODEL");

    // Act
    await pick(user, "SETTINGS$RUNTIME_PROFILE_RUNTIME", "Codex");
    await user.click(screen.getByTestId("save-runtime-profile-btn"));

    // Assert: a Claude model id means nothing to Codex, so it must not ride
    // along; the runtime picks its own until the user names one.
    await waitFor(() =>
      expect(AgentProfilesService.saveProfile).toHaveBeenCalled(),
    );
    const [, payload] = vi.mocked(AgentProfilesService.saveProfile).mock
      .calls[0];
    expect(payload).toMatchObject({
      acp_server: "codex",
      acp_model: null,
      // The fallback was Codex, which the profile now runs itself.
      acp_fallback_server: null,
      acp_fallback_model: null,
    });
  });
});
