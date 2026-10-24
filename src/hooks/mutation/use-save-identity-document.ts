import { useMutation, useQueryClient } from "@tanstack/react-query";
import SoulService from "#/api/soul-service/soul-service.api";
import type {
  IdentityDocumentResponse,
  IdentitySetResponse,
} from "#/api/soul-service/soul.types";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { SOUL_QUERY_KEYS } from "#/hooks/query/query-keys";

/** The first document of the set is the file `/api/soul` also serves. */
const SOUL_DOCUMENT_NAME = "soul";

export interface SaveIdentityDocumentVariables {
  name: string;
  content: string;
}

/**
 * Write one identity document. Empty or whitespace-only content deletes it,
 * which is how the page's "clear" action is expressed.
 *
 * The response is the document as it now stands, so it replaces its entry in
 * the cached set: the editor then reflects the server's own normalization
 * (stripped, single trailing newline) rather than what was typed, and the
 * other five documents are left untouched by a write to one of them.
 */
export function useSaveIdentityDocument() {
  const queryClient = useQueryClient();
  const { backend, orgId } = useActiveBackend();

  return useMutation({
    mutationFn: ({ name, content }: SaveIdentityDocumentVariables) =>
      SoulService.saveIdentityDocument(name, content),
    onSuccess: async (saved: IdentityDocumentResponse) => {
      const queryKey = SOUL_QUERY_KEYS.documents(backend.id, orgId);
      // Cancel first: a read that started before this save would resolve
      // after it and overwrite the response we just seeded.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<IdentitySetResponse>(queryKey, (previous) =>
        previous
          ? {
              ...previous,
              documents: previous.documents.map((doc) =>
                doc.name === saved.name ? saved : doc,
              ),
            }
          : previous,
      );

      // SOUL.md is also served on its own at `/api/soul`, which the
      // improvement-program suggestions read and append to. Writing it here
      // would otherwise leave that view holding the text this save replaced.
      if (saved.name === SOUL_DOCUMENT_NAME) {
        await queryClient.invalidateQueries({
          queryKey: SOUL_QUERY_KEYS.byBackend(backend.id),
        });
      }
    },
    // The page reports success and failure itself, so the global mutation
    // toast would only stack a raw one on top.
    meta: { disableToast: true },
  });
}
