export type LispManifestProposal = {
  resourceId: string;
  resourceName?: string;
  pathLabel?: string;
  baseRevision: string;
  summary?: string;
  analysisCoverage?: "full-source" | "partial-source" | "metadata-only" | "unknown";
  manifest: Record<string, unknown>;
  state?: "pending" | "applying" | "approved" | "rejected" | "superseded" | "error";
  error?: string;
};

const PROPOSAL_RE = /<lisp-manifest-proposal>\s*([\s\S]*?)\s*<\/lisp-manifest-proposal>/;
const MAX_PROPOSAL_TEXT_CHARS = 700_000;

/** Parse only a complete proposal tag; streaming fragments remain inert. */
export function readLispProposal(text: string): LispManifestProposal | undefined {
  if (text.length > MAX_PROPOSAL_TEXT_CHARS) return undefined;
  const match = text.match(PROPOSAL_RE);
  if (!match || match[1].length > MAX_PROPOSAL_TEXT_CHARS) return undefined;
  try {
    const value = JSON.parse(match[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    if (typeof value.resourceId !== "string" || typeof value.baseRevision !== "string") return undefined;
    if (!value.manifest || typeof value.manifest !== "object" || Array.isArray(value.manifest)) return undefined;
    return {
      resourceId: value.resourceId,
      resourceName: typeof value.resourceName === "string" ? value.resourceName : undefined,
      pathLabel: typeof value.pathLabel === "string" ? value.pathLabel : undefined,
      baseRevision: value.baseRevision,
      summary: typeof value.summary === "string" ? value.summary : undefined,
      analysisCoverage:
        value.analysisCoverage === "full-source" ||
        value.analysisCoverage === "partial-source" ||
        value.analysisCoverage === "metadata-only"
          ? value.analysisCoverage
          : "unknown",
      manifest: value.manifest,
      state: "pending",
    };
  } catch {
    return undefined;
  }
}

/** Hide machine-readable UI protocols while preserving the agent's explanation. */
export function shownAssistantText(text: string): string {
  return text
    .split("<question-form")[0]
    .split("<lisp-manifest-proposal>")[0]
    .trim();
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
}

export async function proposalFingerprint(
  proposal: Pick<LispManifestProposal, "resourceId" | "baseRevision" | "manifest">,
): Promise<string> {
  const payload = JSON.stringify(canonicalJson({
    resourceId: proposal.resourceId,
    baseRevision: proposal.baseRevision,
    manifest: proposal.manifest,
  }));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The server owns the top-level review attestation, so it is deliberately
 * excluded when reconciling a saved manifest with an old chat proposal.
 */
export function sameLispManifest(
  saved: unknown,
  proposed: Record<string, unknown>,
): boolean {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return false;
  const { review: _savedReview, ...savedBody } = saved as Record<string, unknown>;
  const { review: _proposalReview, ...proposalBody } = proposed;
  return JSON.stringify(canonicalJson(savedBody)) === JSON.stringify(canonicalJson(proposalBody));
}
