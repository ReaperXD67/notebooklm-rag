import { describe, expect, it } from "vitest";
import { bm25Scores, featureRerank, mmrSelect, reciprocalRankFusion } from "@/lib/scoring";
import type { SearchCandidate } from "@/lib/types";

describe("retrieval scoring", () => {
  it("gives lexical weight to matching chunks", () => {
    const chunks = [
      {
        id: "a",
        documentId: "doc",
        chunkIndex: 0,
        sourceName: "guide",
        pageNumber: 1,
        text: "Node debugging uses breakpoints, stack traces, and the inspector.",
        retrievalText: "Document guide. Node debugging uses breakpoints, stack traces, and the inspector.",
        tokenEstimate: 12,
        charStart: 0,
        charEnd: 20,
        contentHash: "a"
      },
      {
        id: "b",
        documentId: "doc",
        chunkIndex: 1,
        sourceName: "guide",
        pageNumber: 2,
        text: "Package publishing requires semantic versioning.",
        retrievalText: "Document guide. Package publishing requires semantic versioning.",
        tokenEstimate: 8,
        charStart: 21,
        charEnd: 40,
        contentHash: "b"
      }
    ];

    const scores = bm25Scores("How do I debug with stack traces?", chunks);
    expect(scores.get("a") ?? 0).toBeGreaterThan(scores.get("b") ?? 0);
  });

  it("selects diverse candidates with MMR", () => {
    const candidates: SearchCandidate[] = ["a", "b", "c"].map((id, index) => ({
      id,
      documentId: "doc",
      chunkIndex: index,
      sourceName: "guide",
      pageNumber: index + 1,
      text:
        id === "c"
          ? "A different section explains deployment and environment variables."
          : "Debugging Node applications uses stack traces and inspector breakpoints.",
      retrievalText:
        id === "c"
          ? "A different section explains deployment and environment variables."
          : "Debugging Node applications uses stack traces and inspector breakpoints.",
      tokenEstimate: 10,
      charStart: 0,
      charEnd: 10,
      contentHash: id,
      rawVectorScore: 0.8 - index * 0.1,
      vectorScore: 1 - index * 0.1,
      lexicalScore: 1 - index * 0.1,
      rrfScore: 1 - index * 0.1,
      hybridScore: 1 - index * 0.1,
      rerankScore: 1 - index * 0.1,
      originalRank: index + 1
    }));

    const selected = mmrSelect(candidates, 2);
    expect(selected).toHaveLength(2);
    expect(selected[0].id).toBe("a");
  });

  it("fuses dense and lexical ranks before feature reranking", () => {
    const chunks = [
      {
        id: "dense",
        documentId: "doc",
        chunkIndex: 0,
        sourceName: "guide",
        pageNumber: 1,
        text: "General runtime debugging guidance.",
        retrievalText: "General runtime debugging guidance.",
        tokenEstimate: 5,
        charStart: 0,
        charEnd: 10,
        contentHash: "dense"
      },
      {
        id: "exact",
        documentId: "doc",
        chunkIndex: 1,
        sourceName: "guide",
        pageNumber: 2,
        text: "Error AX-104 is fixed with the inspector.",
        retrievalText: "Error AX-104 is fixed with the inspector.",
        tokenEstimate: 8,
        charStart: 11,
        charEnd: 30,
        contentHash: "exact"
      }
    ];
    const lexical = bm25Scores("AX-104 inspector", chunks);
    const fused = reciprocalRankFusion({
      dense: [{ ...chunks[0], vectorScore: 0.92 }, { ...chunks[1], vectorScore: 0.7 }],
      allChunks: chunks,
      lexicalScores: lexical
    });
    const reranked = featureRerank("AX-104 inspector", fused);
    expect(reranked[0].id).toBe("exact");
    expect(reranked[0].rrfScore).toBeGreaterThan(0);
  });
});
