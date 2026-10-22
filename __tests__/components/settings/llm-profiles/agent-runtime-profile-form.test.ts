import { describe, expect, it } from "vitest";
import type { StoredAcpProfile } from "#/api/agent-profiles-service/agent-profiles-service.api";
import { mergeAgentProfileSaveInput } from "#/components/features/settings/agent-profiles/merge-agent-profile-save-input";
import {
  buildRuntimeProfileEdits,
  deriveRuntimeProfileName,
  runtimeProfileAcpModel,
  runtimeProfileDraft,
} from "#/components/features/settings/llm-profiles/agent-runtime-profile-form";

/**
 * A profile whose fields the LLM-tab runtime editor does NOT model all carry
 * non-default values, so a save that wipes them to server defaults is visible.
 * The failover fields ride untyped on the pinned client, hence the cast.
 */
const storedCodex = {
  schema_version: 1,
  id: "22222222-2222-2222-2222-222222222222",
  name: "codex",
  revision: 4,
  agent_kind: "acp",
  acp_server: "codex",
  acp_model: "gpt-5.5-codex/high",
  acp_session_mode: "bypassPermissions",
  acp_prompt_timeout: 900,
  acp_startup_timeout: 120,
  acp_command: null,
  acp_args: null,
  acp_fallback_server: "claude-code",
  acp_fallback_model: "claude-opus-5/high",
  mcp_server_refs: ["linear"],
  secret_refs: ["CODEX_AUTH_JSON"],
} as unknown as StoredAcpProfile;

describe("runtimeProfileDraft", () => {
  it("splits a stored model and effort into separate fields", () => {
    // Arrange / Act
    const draft = runtimeProfileDraft(storedCodex, "claude-code");

    // Assert
    expect(draft).toEqual({
      server: "codex",
      modelId: "gpt-5.5-codex",
      effort: "high",
    });
  });

  it("starts a new profile on the fallback runtime with no model", () => {
    // Arrange / Act
    const draft = runtimeProfileDraft(null, "claude-code");

    // Assert
    expect(draft).toEqual({
      server: "claude-code",
      modelId: "",
      effort: null,
    });
  });

  it("keeps a custom-command profile's model whole", () => {
    // Arrange: a slash in a custom wrapper's model is part of the id.
    const stored = {
      ...storedCodex,
      acp_server: "custom",
      acp_model: "my-wrapper/some-model",
    } as unknown as StoredAcpProfile;

    // Act
    const draft = runtimeProfileDraft(stored, "claude-code");

    // Assert
    expect(draft).toEqual({
      server: "custom",
      modelId: "my-wrapper/some-model",
      effort: null,
    });
  });
});

describe("runtimeProfileAcpModel", () => {
  it("round-trips a model and effort through the combined id", () => {
    // Arrange
    const draft = runtimeProfileDraft(storedCodex, "claude-code");

    // Act
    const combined = runtimeProfileAcpModel(draft);

    // Assert
    expect(combined).toBe("gpt-5.5-codex/high");
    expect(
      runtimeProfileDraft({ ...storedCodex, acp_model: combined }, "codex"),
    ).toEqual(draft);
  });

  it("saves no model when the user left it to the runtime", () => {
    // Arrange / Act / Assert
    expect(
      runtimeProfileAcpModel({
        server: "codex",
        modelId: "  ",
        effort: "high",
      }),
    ).toBeNull();
  });

  it("adds no effort suffix when the runtime's own default is chosen", () => {
    // Arrange / Act / Assert
    expect(
      runtimeProfileAcpModel({
        server: "codex",
        modelId: "gpt-5.5-codex",
        effort: null,
      }),
    ).toBe("gpt-5.5-codex");
  });
});

describe("buildRuntimeProfileEdits", () => {
  it("leaves every field it does not model untouched on an edit", () => {
    // Arrange: change only the effort.
    const draft = {
      ...runtimeProfileDraft(storedCodex, "codex"),
      effort: "xhigh",
    };

    // Act
    const payload = mergeAgentProfileSaveInput(
      storedCodex,
      buildRuntimeProfileEdits(storedCodex, draft),
    ) as Record<string, unknown>;

    // Assert
    expect(payload).toMatchObject({
      agent_kind: "acp",
      acp_server: "codex",
      acp_model: "gpt-5.5-codex/xhigh",
      acp_session_mode: "bypassPermissions",
      acp_prompt_timeout: 900,
      acp_startup_timeout: 120,
      acp_fallback_server: "claude-code",
      acp_fallback_model: "claude-opus-5/high",
      mcp_server_refs: ["linear"],
      secret_refs: ["CODEX_AUTH_JSON"],
    });
    // The server owns identity: the path name is authoritative and it keeps
    // the namesake's id while bumping the revision.
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("name");
    expect(payload).not.toHaveProperty("revision");
  });

  it("drops the previous runtime's launch command when the runtime changes", () => {
    // Arrange: a profile Agents saved with an explicit codex command.
    const stored = {
      ...storedCodex,
      acp_command: "npx -y @agentclientprotocol/codex-acp",
      acp_args: ["--verbose"],
    } as unknown as StoredAcpProfile;

    // Act
    const payload = mergeAgentProfileSaveInput(
      stored,
      buildRuntimeProfileEdits(stored, {
        server: "gemini-cli",
        modelId: "gemini-2.5-pro",
        effort: null,
      }),
    ) as Record<string, unknown>;

    // Assert: left in place, the codex command would spawn codex under a
    // profile that now claims to be gemini-cli.
    expect(payload).toMatchObject({
      acp_server: "gemini-cli",
      acp_model: "gemini-2.5-pro",
      acp_command: null,
      acp_args: null,
    });
  });

  it("clears a failover target that the new runtime now is", () => {
    // Arrange: codex fails over to claude-code; switch the primary to it.
    // Act
    const payload = mergeAgentProfileSaveInput(
      storedCodex,
      buildRuntimeProfileEdits(storedCodex, {
        server: "claude-code",
        modelId: "claude-opus-5",
        effort: "high",
      }),
    ) as Record<string, unknown>;

    // Assert
    expect(payload).toMatchObject({
      acp_server: "claude-code",
      acp_fallback_server: null,
      acp_fallback_model: null,
    });
  });

  it("omits failover fields a backend without them never sent", () => {
    // Arrange: an agent-server without `acp_runtime_failover_v1` rejects
    // unknown profile fields, so the payload must not mention them.
    const stored = {
      schema_version: 1,
      id: "33333333-3333-3333-3333-333333333333",
      name: "claude",
      revision: 1,
      agent_kind: "acp",
      acp_server: "claude-code",
      acp_model: null,
      acp_session_mode: null,
      acp_prompt_timeout: 1800,
      acp_command: null,
      acp_args: null,
      mcp_server_refs: null,
    } as unknown as StoredAcpProfile;

    // Act
    const payload = buildRuntimeProfileEdits(stored, {
      server: "codex",
      modelId: "gpt-5.5-codex",
      effort: null,
    }) as Record<string, unknown>;

    // Assert
    expect(payload).not.toHaveProperty("acp_fallback_server");
    expect(payload).not.toHaveProperty("acp_fallback_model");
  });

  it("creates a profile with only the runtime and its model", () => {
    // Arrange / Act
    const payload = mergeAgentProfileSaveInput(
      null,
      buildRuntimeProfileEdits(null, {
        server: "codex",
        modelId: "gpt-5.5-codex",
        effort: "high",
      }),
    );

    // Assert: everything else takes the agent-server's own default, including
    // `secret_refs: null` so the runtime receives its saved credential.
    expect(payload).toEqual({
      agent_kind: "acp",
      acp_server: "codex",
      acp_model: "gpt-5.5-codex/high",
    });
  });
});

describe("deriveRuntimeProfileName", () => {
  it("names a new profile after its runtime and model", () => {
    // Arrange / Act / Assert
    expect(
      deriveRuntimeProfileName({
        server: "codex",
        modelId: "gpt-5.5-codex",
        effort: "high",
      }),
    ).toBe("codex-gpt-5.5-codex");
  });

  it("flattens a provider-prefixed model instead of keeping its last segment", () => {
    // Arrange / Act / Assert
    expect(
      deriveRuntimeProfileName({
        server: "claude-code",
        modelId: "anthropic/claude-opus-5",
        effort: null,
      }),
    ).toBe("claude-code-anthropic-claude-opus-5");
  });

  it("falls back to the runtime when no model is chosen", () => {
    // Arrange / Act / Assert
    expect(
      deriveRuntimeProfileName({
        server: "claude-code",
        modelId: "",
        effort: null,
      }),
    ).toBe("claude-code");
  });
});
