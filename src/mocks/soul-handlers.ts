import { http, HttpResponse, delay } from "msw";
import {
  MAX_SOUL_LENGTH,
  type SoulResponse,
} from "#/api/soul-service/soul.types";
import { DEFAULT_MOCK_SOUL } from "#/fixtures/soul";

const SOUL_FILE_PATH = "/home/user/.openhands/SOUL.md";

/** Null means "the user has no SOUL.md", as on a fresh server. */
let userSoul: string | null = null;

export const resetMockSoul = () => {
  userSoul = null;
};

function soulResponse(): SoulResponse {
  const content = userSoul ?? DEFAULT_MOCK_SOUL;
  return {
    content,
    exists: userSoul !== null,
    path: SOUL_FILE_PATH,
    size_bytes: new TextEncoder().encode(content).length,
  };
}

export const SOUL_HANDLERS = [
  http.get("*/api/soul", async () => {
    await delay(100);
    return HttpResponse.json(soulResponse());
  }),

  http.put("*/api/soul", async ({ request }) => {
    await delay(100);

    const body = (await request.clone().json()) as { content?: unknown };
    const content = typeof body.content === "string" ? body.content : "";
    if (content.length > MAX_SOUL_LENGTH) {
      return HttpResponse.json(
        { detail: "content is too long" },
        { status: 422 },
      );
    }

    // Empty or whitespace-only content deletes the file and reverts the agent
    // to its built-in default — the server has no DELETE for this resource.
    userSoul = content.trim() ? `${content.trim()}\n` : null;
    return HttpResponse.json(soulResponse());
  }),
];
