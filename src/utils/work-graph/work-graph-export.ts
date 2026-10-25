/**
 * The work graph as something a reader can keep, check, and compare.
 *
 * Milestone 3 asks for an export that is "canonical, sorted, byte-reproducible,
 * with a digest anyone can recompute and a mandatory omissions list", and that
 * across backends "is a bundle of independent attestations, and must say so".
 * The graph itself, its key grammar and its omissions were all built; this is
 * the part that lets somebody else check them.
 *
 * Four properties, and each one is a decision:
 *
 * **Byte-reproducible.** Everything is sorted by a total order and written with
 * a fixed field order, so two exports of the same graph are the same bytes. A
 * digest over a document whose key order depends on insertion order says only
 * that the same program ran twice.
 *
 * **Nothing from the moment of export.** No export timestamp, no caller, no
 * host. Those would change the digest on every call, which would make it
 * useless for the one question it exists to answer: is this the same graph.
 * `generatedAt` comes from the backends' own answers and is part of the
 * attested content.
 *
 * **Omissions are mandatory.** The field is always present, empty array and
 * all. An export whose omissions key is missing when there were none is
 * indistinguishable from one written by a build that did not record them.
 *
 * **A bundle, and it says so.** Several deployments cannot attest to one
 * another's work: each answered for itself and none of them can see the
 * others. So a multi-backend export is labelled `bundle` and lists what each
 * one contributed — including the ones that did not answer, because an absent
 * backend and a backend with no work are the same empty space otherwise.
 */

import type {
  MergedWorkGraph,
  WorkGraphContribution,
} from "./work-graph-merge";

/** The export format's own version, independent of the wire schema's. */
export const WORK_GRAPH_EXPORT_VERSION = 1;

/** What one deployment contributed, as the export records it. */
export interface WorkGraphAttestation {
  backendKey: string;
  backendName: string;
  state: WorkGraphContribution["state"];
  /** The deployment's own id for itself, when it answered. */
  serviceId: string | null;
  /** When that deployment assembled its answer. */
  generatedAt: string | null;
  nodes: number;
  edges: number;
  /** Why it could not be asked. Present only when it could not. */
  error: string | null;
}

export interface WorkGraphExport {
  exportVersion: number;
  /**
   * `attestation` for one deployment, `bundle` for several. The word is in the
   * document because the difference is what a reader is allowed to conclude:
   * one deployment attesting to its own work, or several separate claims that
   * nobody has reconciled.
   */
  form: "attestation" | "bundle";
  attestations: WorkGraphAttestation[];
  generatedAt: string | null;
  inFlight: number;
  nodes: MergedWorkGraph["nodes"];
  edges: MergedWorkGraph["edges"];
  omissions: MergedWorkGraph["omissions"];
  findings: MergedWorkGraph["findings"];
}

/** Compare two strings by code unit, so sorting does not follow a locale. */
function byCodeUnit(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * The export, with every list in a total order.
 *
 * Keys are unique among nodes, so one comparison orders them. Edges are not —
 * the same kind can run between the same pair from two deployments — so the
 * backend keys break the tie and the result is still total.
 */
export function workGraphExport(
  graph: MergedWorkGraph,
  contributions: readonly WorkGraphContribution[],
): WorkGraphExport {
  const attestations = contributions
    .map((contribution) => ({
      backendKey: contribution.backendKey,
      backendName: contribution.backendName,
      state: contribution.state,
      serviceId: contribution.response?.service_id ?? null,
      generatedAt: contribution.response?.generated_at ?? null,
      nodes: contribution.response?.nodes.length ?? 0,
      edges: contribution.response?.edges.length ?? 0,
      error: contribution.error ?? null,
    }))
    .sort((left, right) => byCodeUnit(left.backendKey, right.backendKey));

  return {
    exportVersion: WORK_GRAPH_EXPORT_VERSION,
    // One deployment attests; several only bundle. Counted over everything
    // asked rather than everything that answered: a bundle whose second
    // backend failed is still a bundle, and calling it an attestation would
    // claim a completeness nobody has.
    form: attestations.length > 1 ? "bundle" : "attestation",
    attestations,
    generatedAt: graph.generatedAt,
    inFlight: graph.inFlight,
    nodes: [...graph.nodes]
      .map((node) => ({
        ...node,
        backendKeys: [...node.backendKeys].sort(byCodeUnit),
      }))
      .sort((left, right) => byCodeUnit(left.key, right.key)),
    edges: [...graph.edges]
      .map((edge) => ({
        ...edge,
        backendKeys: [...edge.backendKeys].sort(byCodeUnit),
      }))
      .sort(
        (left, right) =>
          byCodeUnit(left.kind, right.kind) ||
          byCodeUnit(left.from, right.from) ||
          byCodeUnit(left.to, right.to) ||
          byCodeUnit(
            left.backendKeys.join("\u0000"),
            right.backendKeys.join("\u0000"),
          ),
      ),
    omissions: [...graph.omissions].sort(
      (left, right) =>
        byCodeUnit(left.backendKey, right.backendKey) ||
        byCodeUnit(left.kind, right.kind) ||
        byCodeUnit(left.key ?? "", right.key ?? "") ||
        byCodeUnit(left.detail ?? "", right.detail ?? ""),
    ),
    findings: [...graph.findings].sort((left, right) =>
      byCodeUnit(
        JSON.stringify(sortedValue(left)),
        JSON.stringify(sortedValue(right)),
      ),
    ),
  };
}

/**
 * The same value with every object's keys in code-unit order, recursively.
 *
 * `JSON.stringify` writes keys in insertion order, which is a property of how
 * an object was built rather than of what it holds. Two runs that assembled
 * the same node differently would otherwise digest differently.
 */
function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    (left, right) => byCodeUnit(left[0], right[0]),
  );
  return Object.fromEntries(
    entries.map(([key, held]) => [key, sortedValue(held)]),
  );
}

/**
 * The canonical text of an export: the bytes a digest is taken over.
 *
 * Two spaces of indentation and a trailing newline, so the thing a person
 * saves is the thing that was hashed — a pretty-printer run over a compact
 * document would silently change the digest.
 */
export function canonicalWorkGraphDocument(exported: WorkGraphExport): string {
  return `${JSON.stringify(sortedValue(exported), null, 2)}\n`;
}

/**
 * The digest of a canonical document, as `sha256:<hex>`.
 *
 * Prefixed with its algorithm so a reader recomputing it knows which one to
 * use, and so a later change of algorithm cannot be mistaken for a changed
 * graph. Web Crypto, which both the browser and Node have, so the published
 * instruction for recomputing it is the same everywhere:
 *
 *     sha256 of the file's bytes, as lowercase hex
 */
export async function workGraphDigest(document: string): Promise<string> {
  const bytes = new TextEncoder().encode(document);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}
