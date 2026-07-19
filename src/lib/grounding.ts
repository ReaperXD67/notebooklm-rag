import { queryTermCoverage, tokenize } from "./scoring";
import type {
  ChatTurn,
  CitationAudit,
  CitationSource,
  EvidenceAssessment,
  SearchCandidate
} from "./types";

export type LlmSufficiency = {
  sufficient: boolean;
  confidence: number;
  missingEvidence?: string;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function buildRetrievalQuery(question: string, history: ChatTurn[] = []): string {
  const recentQuestions = history
    .filter((turn) => turn.role === "user")
    .slice(-2)
    .map((turn) => turn.content.trim())
    .filter(Boolean);
  const looksLikeFollowUp =
    tokenize(question).length < 9 || /\b(it|its|that|those|this|they|them|previous|above|earlier)\b/i.test(question);

  if (!looksLikeFollowUp || recentQuestions.length === 0) return question.trim();
  return `Conversation topic: ${recentQuestions.join(" | ")}\nCurrent question: ${question.trim()}`;
}

export function assessEvidence(
  query: string,
  candidates: SearchCandidate[],
  llmAssessment?: LlmSufficiency
): EvidenceAssessment {
  if (candidates.length === 0) {
    return {
      status: "insufficient",
      confidence: 0,
      retrievalStrength: 0,
      queryCoverage: 0,
      sourceAgreement: 0,
      llmSufficiency: llmAssessment?.sufficient,
      reason: "No source passages were retrieved.",
      missingEvidence: llmAssessment?.missingEvidence
    };
  }

  const top = candidates[0];
  const retrievalStrength = clamp(0.6 * top.rerankScore + 0.4 * clamp((top.rawVectorScore + 0.1) / 0.8));
  const combinedText = candidates.slice(0, 4).map((candidate) => candidate.retrievalText).join("\n");
  const coverage = queryTermCoverage(query, combinedText);
  const identifiers = query.match(/\b[A-Z0-9]{2,}(?:[-_][A-Z0-9]{2,})+\b/g) ?? [];
  const missingIdentifiers = identifiers.filter(
    (identifier) => !combinedText.toLowerCase().includes(identifier.toLowerCase())
  );
  const scoreAverage =
    candidates.slice(0, 3).reduce((total, candidate) => total + candidate.rerankScore, 0) /
    Math.max(1, Math.min(3, candidates.length));
  const pageDiversity = new Set(candidates.slice(0, 4).map((candidate) => candidate.pageNumber)).size;
  const sourceAgreement = clamp(0.75 * scoreAverage + 0.25 * Math.min(1, pageDiversity / 2));
  const llmScore = llmAssessment ? (llmAssessment.sufficient ? llmAssessment.confidence : 0) : 0.55;
  let confidence = clamp(
    0.38 * retrievalStrength + 0.34 * coverage + 0.16 * sourceAgreement + 0.12 * llmScore
  );
  if (missingIdentifiers.length > 0) confidence = Math.min(confidence, 0.36);
  const status =
    llmAssessment?.sufficient === false || missingIdentifiers.length > 0 || confidence < 0.42
      ? "insufficient"
      : confidence < 0.62
        ? "limited"
        : "sufficient";

  return {
    status,
    confidence: Number(confidence.toFixed(3)),
    retrievalStrength: Number(retrievalStrength.toFixed(3)),
    queryCoverage: Number(coverage.toFixed(3)),
    sourceAgreement: Number(sourceAgreement.toFixed(3)),
    llmSufficiency: llmAssessment?.sufficient,
    reason:
      missingIdentifiers.length > 0
        ? `The document does not contain the requested identifier ${missingIdentifiers[0]}.`
        : status === "sufficient"
        ? "Retrieved passages cover the query with strong, mutually supporting evidence."
        : status === "limited"
          ? "The document contains partial evidence; the answer is constrained to what is supported."
          : "The retrieved passages do not contain enough evidence for a reliable answer.",
    missingEvidence: llmAssessment?.missingEvidence
  };
}

export function auditCitations(answer: string, sources: CitationSource[]): CitationAudit {
  const validLabels = new Set(sources.map((source) => source.citation));
  const citationGroups = answer.match(/\[S\d+(?:\s*,\s*S\d+)*\]/g) ?? [];
  const usedCitations = [
    ...new Set(
      citationGroups.flatMap((group) => (group.match(/S\d+/g) ?? []).map((label) => `[${label}]`))
    )
  ];
  const invalidCitations = usedCitations.filter((citation) => !validLabels.has(citation));
  const claims = answer
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((claim) => claim.trim())
    .filter((claim) => claim.length >= 24 && !/^I (?:do not|don't|cannot|can't)/i.test(claim));
  const citedClaims = claims.filter((claim) => /\[S\d+(?:\s*,\s*S\d+)*\]/.test(claim)).length;
  const coverage = claims.length === 0 ? 1 : citedClaims / claims.length;

  return {
    valid: invalidCitations.length === 0 && (sources.length === 0 || coverage >= 0.7),
    coverage: Number(coverage.toFixed(3)),
    citedClaims,
    totalClaims: claims.length,
    usedCitations,
    invalidCitations
  };
}

export function abstentionAnswer(evidence: EvidenceAssessment): string {
  const missing = evidence.missingEvidence ? ` Missing evidence: ${evidence.missingEvidence}` : "";
  return `I do not have enough evidence in this document to answer reliably.${missing}`;
}
