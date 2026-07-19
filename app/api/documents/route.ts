import { NextResponse } from "next/server";
import { z } from "zod";
import { chunkPages, createDocumentIdentity, deduplicateChunks, normalizeText } from "@/lib/chunking";
import { indexChunks } from "@/lib/rag";
import type { SourcePage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 4 * 1024 * 1024;

const fileSchema = z.object({
  name: z.string().min(1),
  type: z.string()
});

async function parsePdf(buffer: Buffer): Promise<SourcePage[]> {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default ?? pdfParseModule;
  const pageTexts: string[] = [];

  const parsed = await pdfParse(buffer, {
    pagerender: async (pageData: {
      getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[] }> }>;
    }) => {
      const content = await pageData.getTextContent();
      const lines: string[] = [];
      let currentLine = "";
      let previousY: number | undefined;
      for (const item of content.items) {
        const value = item.str?.trim();
        if (!value) continue;
        const y = item.transform?.[5];
        if (previousY !== undefined && y !== undefined && Math.abs(y - previousY) > 2.5) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = value;
        } else {
          currentLine = `${currentLine} ${value}`.trim();
        }
        previousY = y;
      }
      if (currentLine.trim()) lines.push(currentLine.trim());
      const text = lines.join("\n");
      pageTexts.push(text);
      return text;
    }
  });

  const fallbackPages = String(parsed.text ?? "")
    .split(/\f|\n\s*\n\s*Page\s+\d+\s*\n/gi)
    .map((text) => text.trim())
    .filter(Boolean);

  const pages = pageTexts.length > 0 ? pageTexts : fallbackPages;
  return pages.map((text, index) => ({ pageNumber: index + 1, text }));
}

function removeRepeatedMargins(pages: SourcePage[]): SourcePage[] {
  if (pages.length < 3) return pages.map((page) => ({ ...page, text: normalizeText(page.text) }));
  const signatures = new Map<string, number>();
  const pageLines = pages.map((page) => normalizeText(page.text).split("\n").filter(Boolean));

  for (const lines of pageLines) {
    const margins = [...lines.slice(0, 2), ...lines.slice(-2)];
    for (const line of new Set(margins.map((value) => value.toLowerCase().trim()))) {
      if (line.length >= 4) signatures.set(line, (signatures.get(line) ?? 0) + 1);
    }
  }

  const repeated = new Set(
    [...signatures.entries()]
      .filter(([, count]) => count / pages.length >= 0.6)
      .map(([signature]) => signature)
  );
  return pages.map((page, index) => ({
    ...page,
    text: pageLines[index].filter((line) => !repeated.has(line.toLowerCase().trim())).join("\n")
  }));
}

function parseText(buffer: Buffer): SourcePage[] {
  const text = buffer.toString("utf-8");
  const sections = text.split(/\n\s*---page---\s*\n/i).filter(Boolean);
  return (sections.length > 1 ? sections : [text]).map((pageText, index) => ({
    pageNumber: index + 1,
    text: pageText
  }));
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload a PDF or plain text file." }, { status: 400 });
    }

    const parsedFile = fileSchema.parse({ name: file.name, type: file.type });
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File is larger than the 4 MB live-demo limit." }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const lowerName = parsedFile.name.toLowerCase();
    const isPdf = parsedFile.type === "application/pdf" || lowerName.endsWith(".pdf");
    const isText =
      parsedFile.type.startsWith("text/") || lowerName.endsWith(".txt") || lowerName.endsWith(".md");

    if (!isPdf && !isText) {
      return NextResponse.json({ error: "Only PDF, TXT, and Markdown files are supported." }, { status: 415 });
    }

    const { documentId, fingerprint } = createDocumentIdentity(buffer);
    const parsedPages = isPdf ? await parsePdf(buffer) : parseText(buffer);
    const pages = removeRepeatedMargins(parsedPages);
    const rawChunks = chunkPages(pages, documentId, parsedFile.name);
    const { chunks, removed } = deduplicateChunks(rawChunks);
    const document = await indexChunks({
      documentId,
      contentFingerprint: fingerprint,
      duplicateChunksRemoved: removed,
      name: parsedFile.name,
      mimeType: parsedFile.type || (isPdf ? "application/pdf" : "text/plain"),
      pageCount: pages.length,
      chunks
    });

    return NextResponse.json({
      document,
      previewChunks: chunks.slice(0, 3).map((chunk) => ({
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text.slice(0, 420)
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected upload failure.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
