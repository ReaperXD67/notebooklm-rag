import { createHash } from "node:crypto";
import type { ChunkStrategy, DocumentChunk, SourcePage } from "./types";

export const DEFAULT_CHUNK_STRATEGY: ChunkStrategy = {
  name: "contextual page-aware semantic windows",
  targetTokens: 640,
  overlapTokens: 80,
  description:
    "Page boundaries and headings stay citation-safe while deterministic neighbor context is added only to the retrieval representation. Exact duplicate chunks are removed before embedding."
};

const HEADING_MAX_WORDS = 16;

export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.32));
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function splitParagraphs(text: string): string[] {
  return normalizeText(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isLikelyHeading(text: string): boolean {
  const compact = text.replace(/\s+/g, " ").trim();
  const words = compact.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > HEADING_MAX_WORDS) return false;
  if (/^#{1,4}\s+\S/.test(compact)) return true;
  if (/^\d+(\.\d+)*\.?\s+[A-Z]/.test(compact)) return true;
  const alpha = compact.replace(/[^A-Za-z]/g, "");
  if (alpha.length < 4) return false;
  const upper = alpha.replace(/[^A-Z]/g, "").length;
  return upper / alpha.length > 0.72;
}

function splitSentences(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  return sentences?.map((sentence) => sentence.trim()).filter(Boolean) ?? [text];
}

function splitOversizedParagraph(text: string, targetTokens: number): string[] {
  const sentences = splitSentences(text);
  const windows: string[] = [];
  let buffer: string[] = [];

  for (const sentence of sentences) {
    const candidate = [...buffer, sentence].join(" ");
    if (estimateTokens(candidate) > targetTokens && buffer.length > 0) {
      windows.push(buffer.join(" "));
      buffer = [sentence];
    } else if (estimateTokens(sentence) > targetTokens) {
      const words = sentence.split(/\s+/);
      for (let i = 0; i < words.length; i += Math.max(80, Math.floor(targetTokens / 1.32))) {
        windows.push(words.slice(i, i + Math.floor(targetTokens / 1.32)).join(" "));
      }
      buffer = [];
    } else {
      buffer.push(sentence);
    }
  }

  if (buffer.length > 0) windows.push(buffer.join(" "));
  return windows;
}

function lastWords(text: string, tokenBudget: number): string {
  const wordBudget = Math.max(20, Math.floor(tokenBudget / 1.32));
  return text.split(/\s+/).filter(Boolean).slice(-wordBudget).join(" ");
}

function firstWords(text: string, tokenBudget: number): string {
  const wordBudget = Math.max(16, Math.floor(tokenBudget / 1.32));
  return text.split(/\s+/).filter(Boolean).slice(0, wordBudget).join(" ");
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function uuidFromHash(hash: string): string {
  const value = hash.slice(0, 32).split("");
  value[12] = "4";
  value[16] = ((Number.parseInt(value[16], 16) & 0x3) | 0x8).toString(16);
  const compact = value.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export function createDocumentIdentity(content: Buffer): { documentId: string; fingerprint: string } {
  const fingerprint = createHash("sha256").update(content).digest("hex");
  return { documentId: uuidFromHash(fingerprint), fingerprint };
}

function contextualizeChunks(chunks: DocumentChunk[]): DocumentChunk[] {
  return chunks.map((chunk, index) => {
    const previous = chunks[index - 1];
    const next = chunks[index + 1];
    const context = [
      `Document: ${chunk.sourceName}`,
      `Location: page ${chunk.pageNumber}${chunk.heading ? `, section ${chunk.heading}` : ""}`,
      previous?.pageNumber === chunk.pageNumber
        ? `Previous passage: ${lastWords(previous.text, 42)}`
        : undefined,
      next?.pageNumber === chunk.pageNumber ? `Following passage: ${firstWords(next.text, 30)}` : undefined
    ]
      .filter(Boolean)
      .join("\n");

    return {
      ...chunk,
      id: uuidFromHash(hashText(`${chunk.documentId}:${chunk.pageNumber}:${chunk.chunkIndex}:${chunk.contentHash}`)),
      retrievalText: `${context}\n\nPassage:\n${chunk.text}`
    };
  });
}

export function deduplicateChunks(chunks: DocumentChunk[]): {
  chunks: DocumentChunk[];
  removed: number;
} {
  const seen = new Set<string>();
  const unique = chunks.filter((chunk) => {
    const signature = hashText(normalizeText(chunk.text).toLowerCase());
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });

  const reindexed = unique.map((chunk, chunkIndex) => ({ ...chunk, chunkIndex }));
  return {
    chunks: contextualizeChunks(reindexed),
    removed: chunks.length - unique.length
  };
}

export function chunkPages(
  pages: SourcePage[],
  documentId: string,
  sourceName: string,
  strategy: ChunkStrategy = DEFAULT_CHUNK_STRATEGY
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  for (const page of pages) {
    const paragraphs = splitParagraphs(page.text);
    let activeHeading: string | undefined;
    let buffer: string[] = [];
    let charCursor = 0;
    let chunkStart = 0;

    const flush = (force = false) => {
      const text = normalizeText(buffer.join("\n\n"));
      if (!text || (!force && estimateTokens(text) < 80)) return;

      const contentHash = hashText(text);
      chunks.push({
        id: uuidFromHash(hashText(`${documentId}:${page.pageNumber}:${chunkIndex}:${contentHash}`)),
        documentId,
        chunkIndex,
        sourceName,
        pageNumber: page.pageNumber,
        heading: activeHeading,
        text,
        retrievalText: text,
        tokenEstimate: estimateTokens(text),
        charStart: chunkStart,
        charEnd: chunkStart + text.length,
        contentHash
      });
      chunkIndex += 1;

      const overlap = lastWords(text, strategy.overlapTokens);
      buffer = overlap ? [overlap] : [];
      chunkStart = Math.max(0, charCursor - overlap.length);
    };

    for (const paragraph of paragraphs) {
      const cleaned = normalizeText(paragraph);
      charCursor += cleaned.length + 2;

      if (isLikelyHeading(cleaned)) {
        flush(true);
        activeHeading = cleaned.replace(/^#{1,4}\s+/, "");
        chunkStart = charCursor;
        continue;
      }

      const pieces =
        estimateTokens(cleaned) > strategy.targetTokens
          ? splitOversizedParagraph(cleaned, strategy.targetTokens)
          : [cleaned];

      for (const piece of pieces) {
        const candidate = normalizeText([...buffer, piece].join("\n\n"));
        if (estimateTokens(candidate) > strategy.targetTokens && buffer.length > 0) {
          flush(true);
        }
        if (buffer.length === 0) chunkStart = Math.max(0, charCursor - piece.length);
        buffer.push(piece);
      }
    }

    flush(true);
  }

  return contextualizeChunks(chunks);
}
