import { describe, expect, it } from "vitest";
import { chunkPages, estimateTokens } from "@/lib/chunking";

describe("chunkPages", () => {
  it("keeps page metadata and creates bounded chunks", () => {
    const text = Array.from({ length: 80 }, (_, index) => {
      return `Paragraph ${index}. Debugging Node.js requires reading stack traces, inspecting variables, and reproducing the failing input.`;
    }).join("\n\n");

    const chunks = chunkPages([{ pageNumber: 3, text }], "doc-1", "node.pdf");

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.pageNumber === 3)).toBe(true);
    expect(chunks.every((chunk) => estimateTokens(chunk.text) <= 850)).toBe(true);
  });

  it("captures simple section headings", () => {
    const chunks = chunkPages(
      [{ pageNumber: 1, text: "DEBUGGING BASICS\n\nUse the inspector when breakpoints are needed." }],
      "doc-2",
      "guide.txt"
    );

    expect(chunks[0].heading).toBe("DEBUGGING BASICS");
  });
});
