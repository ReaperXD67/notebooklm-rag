import { describe, expect, it } from "vitest";
import { assessEvidence, auditCitations } from "@/lib/grounding";
import { evaluateGrounding } from "@/lib/evaluation";
import type { CitationSource, SearchCandidate } from "@/lib/types";

function candidate(text: string): SearchCandidate {
  return {
    id: "a",
    documentId: "doc",
    chunkIndex: 0,
    sourceName: "guide",
    pageNumber: 1,
    text,
    retrievalText: text,
    tokenEstimate: 12,
    charStart: 0,
    charEnd: text.length,
    contentHash: "hash",
    rawVectorScore: 0.82,
    vectorScore: 1,
    lexicalScore: 1,
    rrfScore: 1,
    hybridScore: 1,
    rerankScore: 0.95,
    originalRank: 1
  };
}

describe("grounding guardrails", () => {
  it("rejects a missing exact identifier even when related text is retrieved", () => {
    const evidence = assessEvidence(
      "What does AX9E7-NEVER-PRESENT mean?",
      [candidate("This section documents other AtlasLM benchmark identifiers.")]
    );
    expect(evidence.status).toBe("insufficient");
    expect(evidence.confidence).toBeLessThan(0.42);
  });

  it("audits citation labels and claim coverage", () => {
    const source: CitationSource = {
      citation: "[S1]",
      id: "a",
      sourceName: "guide",
      pageNumber: 1,
      chunkIndex: 0,
      text: "Breakpoints pause execution.",
      rawVectorScore: 0.8,
      vectorScore: 1,
      lexicalScore: 1,
      rrfScore: 1,
      hybridScore: 1,
      rerankScore: 1,
      originalRank: 1,
      finalRank: 1
    };
    const audit = auditCitations("Breakpoints pause execution so variables can be inspected. [S1]", [source]);
    expect(audit.valid).toBe(true);
    const trace = {
      traceId: "trace",
      totalMs: 10,
      cacheHit: false,
      retrievalQuery: "breakpoints",
      model: "test",
      spans: Array.from({ length: 5 }, (_, index) => ({
        name: `stage-${index}`,
        label: `Stage ${index}`,
        durationMs: 1,
        status: "ok" as const
      }))
    };
    expect(
      evaluateGrounding({ audit, evidence: assessEvidence("breakpoints", [candidate(source.text)]), abstained: false, trace })
        .passed
    ).toBe(true);
  });
});
