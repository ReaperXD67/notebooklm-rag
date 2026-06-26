import { describe, expect, it } from "vitest";
import { bm25Scores, mmrSelect } from "@/lib/scoring";
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
        tokenEstimate: 12,
        charStart: 0,
        charEnd: 20
      },
      {
        id: "b",
        documentId: "doc",
        chunkIndex: 1,
        sourceName: "guide",
        pageNumber: 2,
        text: "Package publishing requires semantic versioning.",
        tokenEstimate: 8,
        charStart: 21,
        charEnd: 40
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
      tokenEstimate: 10,
      charStart: 0,
      charEnd: 10,
      vectorScore: 1 - index * 0.1,
      lexicalScore: 1 - index * 0.1,
      hybridScore: 1 - index * 0.1
    }));

    const selected = mmrSelect(candidates, 2);
    expect(selected).toHaveLength(2);
    expect(selected[0].id).toBe("a");
  });
});
