import type {
  CitationAudit,
  EvidenceAssessment,
  GroundingEvaluation,
  RagTrace
} from "./types";

export function evaluateGrounding({
  audit,
  evidence,
  abstained,
  trace
}: {
  audit: CitationAudit;
  evidence: EvidenceAssessment;
  abstained: boolean;
  trace: RagTrace;
}): GroundingEvaluation {
  const checks = [
    {
      name: "Citation validity",
      passed: audit.invalidCitations.length === 0,
      value: audit.invalidCitations.length === 0 ? "All labels resolve" : audit.invalidCitations.join(", ")
    },
    {
      name: "Claim coverage",
      passed: abstained || audit.coverage >= 0.7,
      value: `${Math.round(audit.coverage * 100)}% of factual claims cited`
    },
    {
      name: "Evidence gate",
      passed: evidence.status !== "insufficient" || abstained,
      value: `${evidence.status} at ${Math.round(evidence.confidence * 100)}%`
    },
    {
      name: "Trace completeness",
      passed: trace.spans.length >= 4,
      value: `${trace.spans.length} pipeline stages recorded`
    }
  ];
  const score = checks.filter((check) => check.passed).length / checks.length;
  return { passed: checks.every((check) => check.passed), score: Number(score.toFixed(3)), checks };
}
