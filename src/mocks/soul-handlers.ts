import { http, HttpResponse, delay } from "msw";
import {
  MAX_IDENTITY_DOCUMENT_LENGTH,
  MAX_SOUL_LENGTH,
  type IdentityDocumentResponse,
  type IdentitySetResponse,
  type SoulResponse,
} from "#/api/soul-service/soul.types";
import { DEFAULT_MOCK_SOUL, MOCK_IDENTITY_DOCUMENTS } from "#/fixtures/soul";

const IDENTITY_DIRECTORY = "/home/user/.openhands/soul";
const SOUL_FILE_PATH = `${IDENTITY_DIRECTORY}/SOUL.md`;

/**
 * What has been written, keyed by document name. A missing entry means the
 * document does not exist, as on a fresh server — writing blank content
 * removes the entry rather than storing an empty string, which is what the
 * agent server does with the file.
 */
let writtenDocuments = new Map<string, string>();

export const resetMockSoul = () => {
  writtenDocuments = new Map();
};

/**
 * `/api/soul` serves the same file as the set's first document, so both read
 * one piece of mock state: a save on either page must be visible on the
 * other, which is the behavior worth mocking.
 */
function soulResponse(): SoulResponse {
  const written = writtenDocuments.get("soul");
  const content = written ?? DEFAULT_MOCK_SOUL;
  return {
    content,
    exists: written !== undefined,
    path: SOUL_FILE_PATH,
    size_bytes: new TextEncoder().encode(content).length,
  };
}

function documentResponse(
  document: (typeof MOCK_IDENTITY_DOCUMENTS)[number],
): IdentityDocumentResponse {
  const content = writtenDocuments.get(document.name) ?? "";
  return {
    ...document,
    content,
    exists: writtenDocuments.has(document.name),
    path: `${IDENTITY_DIRECTORY}/${document.relative_path}`,
    size_bytes: new TextEncoder().encode(content).length,
  };
}

function identitySetResponse(): IdentitySetResponse {
  return {
    documents: MOCK_IDENTITY_DOCUMENTS.map(documentResponse),
    directory: IDENTITY_DIRECTORY,
  };
}

async function readContent(request: Request): Promise<string> {
  const body = (await request.clone().json()) as { content?: unknown };
  return typeof body.content === "string" ? body.content : "";
}

export const SOUL_HANDLERS = [
  http.get("*/api/soul", async () => {
    await delay(100);
    return HttpResponse.json(soulResponse());
  }),

  http.put("*/api/soul", async ({ request }) => {
    await delay(100);

    const content = await readContent(request);
    if (content.length > MAX_SOUL_LENGTH) {
      return HttpResponse.json(
        { detail: "content is too long" },
        { status: 422 },
      );
    }

    // Empty or whitespace-only content deletes the file and reverts the agent
    // to its built-in default — the server has no DELETE for this resource.
    if (content.trim()) {
      writtenDocuments.set("soul", `${content.trim()}\n`);
    } else {
      writtenDocuments.delete("soul");
    }
    return HttpResponse.json(soulResponse());
  }),

  http.get("*/api/soul/documents", async () => {
    await delay(100);
    return HttpResponse.json(identitySetResponse());
  }),

  http.put("*/api/soul/documents/:name", async ({ params, request }) => {
    await delay(100);

    const document = MOCK_IDENTITY_DOCUMENTS.find(
      (candidate) => candidate.name === params.name,
    );
    // A name this build does not declare is a 404, the same as an agent
    // server that serves no identity documents at all.
    if (!document) {
      return HttpResponse.json(
        { detail: `No identity document named '${String(params.name)}'` },
        { status: 404 },
      );
    }

    const content = await readContent(request);
    if (content.length > MAX_IDENTITY_DOCUMENT_LENGTH) {
      return HttpResponse.json(
        { detail: "content is too long" },
        { status: 422 },
      );
    }

    // Blank content deletes the document, so "never written" and "written,
    // then emptied" stay one state.
    if (content.trim()) {
      writtenDocuments.set(document.name, `${content.trim()}\n`);
    } else {
      writtenDocuments.delete(document.name);
    }
    return HttpResponse.json(documentResponse(document));
  }),
];
