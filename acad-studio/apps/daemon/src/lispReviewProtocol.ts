const PROPOSAL_SOURCE =
  String.raw`<lisp-manifest-proposal>\s*([\s\S]*?)\s*<\/lisp-manifest-proposal>`;
const MAX_PROPOSAL_BYTES = 600 * 1024;

export function validLispProposal(
  text: string,
  resourceId: unknown,
  revision: unknown,
): boolean {
  const match = new RegExp(PROPOSAL_SOURCE).exec(text);
  if (!match || Buffer.byteLength(match[1]) > MAX_PROPOSAL_BYTES) return false;
  try {
    const proposal = JSON.parse(match[1]);
    return (
      proposal &&
      typeof proposal === "object" &&
      proposal.resourceId === String(resourceId ?? "") &&
      proposal.baseRevision === String(revision ?? "") &&
      proposal.manifest &&
      typeof proposal.manifest === "object" &&
      !Array.isArray(proposal.manifest)
    );
  } catch {
    return false;
  }
}

export function withoutLispProposal(text: string): string {
  return text.replace(new RegExp(PROPOSAL_SOURCE, "g"), "").trim();
}

export function bindLispProposalMetadata(
  text: string,
  resourceId: unknown,
  revision: unknown,
  coverage: "full-source" | "partial-source" | "metadata-only",
): string | null {
  const expression = new RegExp(PROPOSAL_SOURCE);
  const match = expression.exec(text);
  if (!match || Buffer.byteLength(match[1]) > MAX_PROPOSAL_BYTES) return null;
  try {
    const proposal = JSON.parse(match[1]);
    if (
      !proposal ||
      typeof proposal !== "object" ||
      proposal.resourceId !== String(resourceId ?? "") ||
      proposal.baseRevision !== String(revision ?? "")
    ) {
      return null;
    }
    proposal.resourceId = String(resourceId);
    proposal.baseRevision = String(revision);
    proposal.analysisCoverage = coverage;
    const replacement =
      `<lisp-manifest-proposal>${JSON.stringify(proposal)}</lisp-manifest-proposal>`;
    return text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
  } catch {
    return null;
  }
}
