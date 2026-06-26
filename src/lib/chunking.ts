import { randomUUID } from "node:crypto";
import type { ChunkStrategy, DocumentChunk, SourcePage } from "./types";

export const DEFAULT_CHUNK_STRATEGY: ChunkStrategy = {
  name: "page-aware recursive semantic windows",
  targetTokens: 720,
  overlapTokens: 90,
  description:
    "The parser keeps page boundaries for citations, detects simple headings, splits oversized paragraphs into sentence windows, and adds overlap so answers retain local context."
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

      chunks.push({
        id: randomUUID(),
        documentId,
        chunkIndex,
        sourceName,
        pageNumber: page.pageNumber,
        heading: activeHeading,
        text,
        tokenEstimate: estimateTokens(text),
        charStart: chunkStart,
        charEnd: chunkStart + text.length
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

  return chunks;
}
