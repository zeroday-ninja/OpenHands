import i18n from "#/i18n";
import { I18nKey } from "#/i18n/declaration";
import AgentServerGitService from "#/api/git-service/agent-server-git-service.api";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "#/mocks/node";
import {
  setRegisteredBackends,
  setActiveSelection,
} from "#/api/backend-registry/active-store";
import { clearCachedAgentServerInfo } from "#/api/agent-server-compatibility";
import { clearAgentServerHomeDirCache } from "#/api/agent-server-home";
import { resolveNewConversationWorkspace } from "#/api/conversation-workspace";
import GitService from "#/api/git-service/git-service.api";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import AgentServerRuntimeService from "#/api/runtime-service/agent-server-runtime-service";
import ProjectMapService from "#/api/project-map-service/project-map-service.api";
import { PROJECT_MAP_FILE_PATH } from "#/types/project-map";

const host = "http://localhost:9876";
const cid = "11111111-1111-4111-8111-111111111111";
const paths: string[] = [];
let isolated = true;
let capabilities = true;

beforeEach(() => {
  isolated = true;
  capabilities = true;
  paths.length = 0;
  clearCachedAgentServerInfo();
  clearAgentServerHomeDirCache();
  setRegisteredBackends([
    {
      id: "boundary",
      name: "Boundary",
      kind: "local",
      host,
      apiKey: "boundary-test-key",
    },
  ]);
  setActiveSelection({ backendId: "boundary" });
  // Only the HTTP server is substituted; frontend services and SDK clients run unchanged.
  server.use(
    http.all(`${host}/*`, ({ request }) => {
      const url = new URL(request.url);
      paths.push(url.pathname + url.search);
      expect(request.headers.get("X-Session-API-Key")).toBe(
        "boundary-test-key",
      );
      if (url.pathname === "/server_info")
        return HttpResponse.json({
          version: "1.45.0",
          uptime: 0,
          idle_time: 0,
          capabilities: capabilities ? ["conversation_runtime_routes_v1"] : [],
          conversation_runtime: isolated ? "docker" : "local",
          runtime_services: { mode: isolated ? "dev:automation" : "docker" },
        });
      if (url.pathname === "/api/file/home")
        return HttpResponse.json({ home: "/home/agent" });
      if (url.pathname === "/api/conversations")
        return HttpResponse.json([
          {
            id: cid,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            execution_status: "idle",
            workspace: { working_dir: "/workspace" },
          },
        ]);
      if (url.pathname.endsWith("/git/changes"))
        return HttpResponse.json([{ path: "file.txt", status: "M" }]);
      if (url.pathname.endsWith("/git/diff"))
        return HttpResponse.json({ original: "before", modified: "after" });
      if (url.pathname.endsWith("/file/download"))
        return HttpResponse.text("plan contents");
      if (url.pathname.endsWith("/file/upload"))
        return HttpResponse.json({ success: true });
      if (url.pathname.endsWith("/bash/execute_bash_command"))
        return HttpResponse.json({
          exit_code: 0,
          stdout: "/workspace",
          stderr: "",
        });
      return HttpResponse.json(
        { error: "Unexpected endpoint" },
        { status: 500 },
      );
    }),
  );
});

describe("conversation runtime boundaries", () => {
  it("scopes live unified git calls even before conversation URL hydration", async () => {
    expect(
      await AgentServerGitService.getGitChanges(cid, null, null, "/workspace"),
    ).toHaveLength(1);
    expect(
      await AgentServerGitService.getGitChangeDiff(cid, null, null, "file.txt"),
    ).toEqual({ original: "before", modified: "after" });
    expect(paths).toContain(
      `/api/conversations/${cid}/git/changes?path=%2Fworkspace`,
    );
    expect(paths).toContain(`/api/conversations/${cid}/git/diff?path=file.txt`);
  });

  it("uses a new isolated workspace without reading host home or hooks", async () => {
    expect(
      await resolveNewConversationWorkspace({ conversationId: cid }),
    ).toEqual({
      workingDir: "/workspace",
      hooksProjectDir: null,
      isolated: true,
    });
    expect(paths).toEqual(["/server_info"]);
  });

  it("lists no hooks for an isolated conversation without reading host hooks", async () => {
    expect(await AgentServerConversationService.getHooks(cid)).toEqual({
      hooks: [],
    });
    expect(paths).toEqual(["/server_info"]);
  });

  it.each([
    ["/home/user/project", "/home/user/project"],
    ["relative/project", "/home/agent/relative/project"],
  ])(
    "mounts host folder %s into the sandbox rather than refusing it",
    async (workingDir, mounted) => {
      // The Docker runtime binds any working dir other than its own
      // `/workspace` at `/workspace` inside the container, so a folder a
      // person chose reaches the sandbox as its working directory. It is
      // resolved against the host's home, since the runtime insists on an
      // absolute path; hooks still come from inside the sandbox, never from
      // the host's view of the folder.
      expect(
        await resolveNewConversationWorkspace({
          conversationId: cid,
          workingDir,
        }),
      ).toEqual({ workingDir: mounted, hooksProjectDir: null, isolated: true });
      expect(paths[0]).toBe("/server_info");
      expect(paths.some((path) => path.includes("/hooks"))).toBe(false);
    },
  );

  it("keeps the sandbox's own directory when that is what is asked for", async () => {
    expect(
      await resolveNewConversationWorkspace({
        conversationId: cid,
        workingDir: "/workspace",
      }),
    ).toEqual({
      workingDir: "/workspace",
      hooksProjectDir: null,
      isolated: true,
    });
    expect(paths).toEqual(["/server_info"]);
  });

  it("rejects selected host repository metadata", async () => {
    await expect(
      resolveNewConversationWorkspace({
        conversationId: cid,
        selectedRepository: "owner/project",
      }),
    ).rejects.toThrow(i18n.t(I18nKey.HOME$ISOLATED_WORKSPACE_NOTICE));
  });

  it("uses the active language for workspace rejection errors", async () => {
    const originalLanguage = i18n.language;
    const notice = "Ce backend utilise des espaces de travail isolés.";
    i18n.addResourceBundle("fr", "openhands", {
      [I18nKey.HOME$ISOLATED_WORKSPACE_NOTICE]: notice,
    });
    try {
      await i18n.changeLanguage("fr");
      await expect(
        resolveNewConversationWorkspace({
          conversationId: cid,
          selectedRepository: "owner/project",
        }),
      ).rejects.toThrow(notice);
    } finally {
      await i18n.changeLanguage(originalLanguage);
    }
  });

  it("preserves a Docker child conversation's parent workspace", async () => {
    expect(
      await resolveNewConversationWorkspace({
        conversationId: cid,
        parentConversationId: "parent",
        workingDir: "/workspace",
      }),
    ).toMatchObject({ workingDir: "/workspace", isolated: true });
  });

  it("uses host metadata rather than runtime_services deployment mode", async () => {
    isolated = false;
    expect(
      await resolveNewConversationWorkspace({
        conversationId: cid,
        workingDir: "/home/user/project",
      }),
    ).toEqual({
      workingDir: "/home/user/project",
      hooksProjectDir: "/home/user/project",
      isolated: false,
    });
  });

  it("routes legacy git service changes and diff to the conversation", async () => {
    expect(await GitService.getGitChanges(cid)).toHaveLength(1);
    expect(await GitService.getGitChangeDiff(cid, "file.txt")).toEqual({
      original: "before",
      modified: "after",
    });
    expect(paths).toContain(
      `/api/conversations/${cid}/git/changes?path=%2Fworkspace`,
    );
    expect(paths).toContain(`/api/conversations/${cid}/git/diff?path=file.txt`);
  });

  it("routes plan downloads and runtime bash to the same conversation", async () => {
    expect(await AgentServerConversationService.readConversationFile(cid)).toBe(
      "plan contents",
    );
    expect(
      await AgentServerRuntimeService.executeCommand(
        `${host}/api/conversations/${cid}`,
        null,
        "pwd",
        "/workspace",
      ),
    ).toMatchObject({ stdout: "/workspace" });
    expect(paths).toContain(
      `/api/conversations/${cid}/file/download?path=%2Fworkspace%2F.agents_tmp%2FPLAN.md`,
    );
    expect(paths).toContain(
      `/api/conversations/${cid}/bash/execute_bash_command`,
    );
  });

  it("routes the project map to the conversation's own workspace", async () => {
    // A repository cloned inside this conversation's container is invisible to
    // a host-level file call, so both legs have to be conversation-scoped and
    // anchored on the conversation's own working dir — which is also the only
    // directory the runtime routes accept a path inside.
    const read = await ProjectMapService.readProjectMap({
      conversationId: cid,
    });

    expect(read.workspace).toEqual({
      conversationId: cid,
      workingDir: "/workspace",
    });
    expect(read.absolutePath).toBe(`/workspace/${PROJECT_MAP_FILE_PATH}`);
    expect(paths).toContain(
      `/api/conversations/${cid}/file/download?path=${encodeURIComponent(read.absolutePath)}`,
    );

    await ProjectMapService.writeProjectMap("{}\n", { conversationId: cid });
    expect(paths).toContain(
      `/api/conversations/${cid}/file/upload?path=${encodeURIComponent(read.absolutePath)}`,
    );
    // Nothing was asked of the agent server's own filesystem.
    expect(paths).not.toContain(
      `/api/file/download?path=${encodeURIComponent(read.absolutePath)}`,
    );
  });

  it("reads the host workspace for a map with no conversation", async () => {
    // The `/map` page opened from the sidebar has no conversation to follow,
    // so it reads the backend's configured working directory — host-level,
    // with no conversation prefix and no `cid`.
    const read = await ProjectMapService.readProjectMap();

    expect(read.workspace.conversationId).toBeNull();
    expect(read.absolutePath.startsWith("/home/agent/")).toBe(true);
    expect(paths).toContain(
      `/api/file/download?path=${encodeURIComponent(read.absolutePath)}`,
    );
  });

  it("retains cid for legacy servers without canonical capability", async () => {
    capabilities = false;
    await GitService.getGitChangeDiff(cid, "file.txt");
    expect(paths).toContain(`/api/git/diff?path=file.txt&cid=${cid}`);
  });
});
