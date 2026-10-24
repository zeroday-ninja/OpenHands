/**
 * What the terminal can do to a stack.
 *
 * Plain HTTP and one WebSocket, against the same Agent Server surface the
 * browser uses. Not the typed client: that is an ESM TypeScript package built
 * for the bundler, and this runs as a plain Node script with no build step —
 * the same reason the launchers talk HTTP directly.
 *
 * Every call reports its own failure with the method and path. A terminal that
 * prints "request failed" has told the reader nothing they can act on.
 */

export class StackRequestFailed extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} → ${status}${body ? `: ${body}` : ""}`);
    this.name = "StackRequestFailed";
    this.status = status;
  }
}

export function createClient(stack) {
  const headers = {
    "Content-Type": "application/json",
    ...(stack.apiKey ? { "X-Session-API-Key": stack.apiKey } : {}),
  };

  async function request(method, path, body) {
    const response = await fetch(new URL(path, stack.baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new StackRequestFailed(
        method,
        path,
        response.status,
        text.slice(0, 300),
      );
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    stack,
    request,

    serverInfo: () => request("GET", "/server_info"),

    /**
     * Conversations, newest first.
     *
     * `/search`, not `/api/conversations` — the latter takes an explicit
     * `ids` list and answers 422 without one, which is a lookup rather than a
     * listing.
     */
    listConversations: (limit = 20) =>
      request(
        "GET",
        `/api/conversations/search?limit=${encodeURIComponent(limit)}`,
      ),

    /** Start a conversation. `agentProfileId` picks which runtime answers. */
    createConversation: (body) => request("POST", "/api/conversations", body),

    conversation: (id) => request("GET", `/api/conversations/${id}`),

    sendMessage: (id, text) =>
      request("POST", `/api/conversations/${id}/events`, {
        role: "user",
        content: [{ type: "text", text }],
      }),

    /**
     * The secrets a profile is allowed, as lookup references.
     *
     * References rather than values: the agent server resolves each one
     * lazily at its own endpoint, so a raw credential never passes through
     * this process. This is the same shape `workspace.get_secrets()` builds
     * in the SDK, and without it an ACP conversation started from here fails
     * with `ACPAuthRequired` — the runtime's login is a secret.
     */
    async secretsFor(agentProfileId) {
      const query = agentProfileId
        ? `?agent_profile_id=${encodeURIComponent(agentProfileId)}`
        : "";
      const payload = await request("GET", `/api/settings/secrets${query}`);
      const secrets = {};
      (payload?.secrets ?? []).forEach((item) => {
        if (!item?.name) return;
        secrets[item.name] = {
          // The discriminator is the class name, like `LocalWorkspace`
          // above. "lookup" is rejected as an invalid payload.
          kind: "LookupSecret",
          url: new URL(
            `/api/settings/secrets/${encodeURIComponent(item.name)}`,
            stack.baseUrl,
          ).toString(),
          headers: stack.apiKey ? { "X-Session-API-Key": stack.apiKey } : {},
          description: item.description ?? null,
        };
      });
      return secrets;
    },

    setSecrets: (id, secrets) =>
      request("POST", `/api/conversations/${id}/secrets`, { secrets }),

    /**
     * Start the agent on what it has been sent.
     *
     * Separate from sending, because they are separate acts: a message sits
     * in the conversation until something runs it, and the web client's
     * socket is what does that there. A terminal that only sent would leave
     * the conversation idle with the question in it — which is what it did
     * before this existed.
     */
    run: (id) => request("POST", `/api/conversations/${id}/run`),

    /** Stop the agent mid-turn. The conversation survives; the turn does not. */
    pause: (id) => request("POST", `/api/conversations/${id}/pause`),
    /** Stop it now, rather than at the next safe point. */
    interrupt: (id) => request("POST", `/api/conversations/${id}/interrupt`),
    // There is no conversation-level resume: `run` is what resumes a paused
    // one. `goal/resume` is a different thing, for a goal.

    /** Answer a tool call the agent is waiting on. */
    respondToConfirmation: (id, accept, reason) =>
      request("POST", `/api/conversations/${id}/confirmation`, {
        accept,
        ...(reason ? { reason } : {}),
      }),

    /**
     * A page of a conversation's events, oldest first.
     *
     * `sort_order` is explicit because the default is the server's choice and
     * a transcript printed backwards is worse than no transcript.
     */
    events: (id, { limit = 100, pageId = null } = {}) => {
      const query = new URLSearchParams({
        limit: String(limit),
        sort_order: "TIMESTAMP",
      });
      if (pageId) query.set("page_id", pageId);
      return request("GET", `/api/conversations/${id}/events/search?${query}`);
    },

    /** Everything, in order, following the cursor. Bounded by `maxPages`. */
    async allEvents(id, { maxPages = 20 } = {}) {
      const collected = [];
      let pageId = null;
      for (let page = 0; page < maxPages; page += 1) {
        // eslint-disable-next-line no-await-in-loop
        const payload = await this.events(id, { pageId });
        const items = Array.isArray(payload?.items) ? payload.items : [];
        collected.push(...items);
        pageId = payload?.next_page_id ?? null;
        if (!pageId) return { events: collected, truncated: false };
      }
      // Said out loud rather than quietly stopping: a transcript missing its
      // tail reads as a conversation that ended there.
      return { events: collected, truncated: true };
    },

    /**
     * What has changed in a working tree, and the diff itself.
     *
     * The agent server's own git surface rather than shelling out: the work
     * happens in a sandbox, so the files are not on this machine, and a
     * terminal that could only diff local checkouts would be lying about
     * which tree it is showing.
     */
    gitChanges: (path, ref) =>
      request(
        "GET",
        `/api/git/changes?path=${encodeURIComponent(path)}` +
          (ref ? `&ref=${encodeURIComponent(ref)}` : ""),
      ),

    gitDiff: (path, { ref, commit } = {}) =>
      request(
        "GET",
        `/api/git/diff?path=${encodeURIComponent(path)}` +
          (ref ? `&ref=${encodeURIComponent(ref)}` : "") +
          (commit ? `&commit=${encodeURIComponent(commit)}` : ""),
      ),

    /**
     * The automation service, through the same ingress.
     *
     * A 404 here usually means the running service is older than the path
     * being asked for — the automation service is versioned separately from
     * this repository — so the caller is given that reading rather than a
     * bare status code.
     */
    async automation(method, path, body) {
      try {
        return await request(method, `/api/automation/v1${path}`, body);
      } catch (error) {
        if (error?.status === 404) {
          throw new Error(
            `The automation service has no ${path}. It is versioned ` +
              "separately from this app, so this usually means it is running " +
              "a build from before that endpoint landed; restart the stack.",
          );
        }
        throw error;
      }
    },

    /**
     * The event socket for one conversation.
     *
     * `/sockets/session/{id}`, which is the envelope protocol the web client
     * uses; `/sockets/events` is frozen. `after_seq=-1` asks for the whole
     * log, so a terminal that attaches mid-conversation sees the history
     * rather than only what happens next.
     */
    webSocketUrl(id, afterSeq = -1) {
      const url = new URL(`/sockets/session/${id}`, stack.baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("after_seq", String(afterSeq));
      return url.toString();
    },

    /**
     * The first frame the socket expects when the stack has a session key.
     *
     * Sent as a frame rather than a query parameter, matching the web client:
     * a key in a URL ends up in logs and in shell history.
     */
    webSocketAuthFrame() {
      if (!stack.apiKey) return null;
      return JSON.stringify({ type: "auth", session_api_key: stack.apiKey });
    },
  };
}
